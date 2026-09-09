/**
 * 엔진 호출부. Claude Agent SDK 를 이 파일 하나에서만 부른다.
 *
 * 화면·CLI 는 이 모듈의 이벤트만 보면 되고 SDK 를 직접 모른다.
 * (수업 4절의 "엔진 호출 부분은 분리해 줘" 를 이렇게 지킨다.)
 */
import { query } from '@anthropic-ai/claude-agent-sdk';
import { config as mcpConfig } from 'already-got-it-ops-mcp/config';
import { createGate } from './gate.js';
import { LimitTracker, limitsFromEnv } from './limits.js';
import { ShadowGuard } from './shadowguard.js';
import { systemPrompt } from './prompt.js';
import { BLOCKED_BUILTINS, MCP_SERVER_KEY, READ_TOOLS, shortName } from './tools.js';
import { UsageAccountant } from './usage.js';
export async function runBriefing(opts) {
    const limits = opts.limits ?? limitsFromEnv();
    const repo = opts.repo ?? (mcpConfig.allowedRepos[0] ?? 'hey-byeunya/already-got-it');
    const tracker = new LimitTracker(limits);
    const usage = new UsageAccountant();
    const guard = new ShadowGuard();
    const emit = (e) => opts.onEvent?.(e);
    const gate = createGate({
        runId: opts.runId,
        decider: opts.decider,
        limits: tracker,
        approvalTtlSeconds: mcpConfig.approvalTtlSeconds,
        onEvent: (event) => emit({ kind: 'gate', event }),
    });
    guard.arm();
    emit({ kind: 'started', runId: opts.runId, limits });
    let stopReason;
    /** result 메시지의 subtype. 성공 여부는 마지막에 stopReason 과 함께 판정한다. */
    let resultOk;
    let subtype;
    let sessionId;
    let finalText = '';
    let permissionDenials = [];
    let sawResult = false;
    const mcp = opts.mcpServerCommand ?? {
        command: process.execPath,
        args: ['mcp-server/dist/src/index.js'],
    };
    try {
        const stream = query({
            prompt: opts.goal,
            options: {
                systemPrompt: systemPrompt({ runId: opts.runId, repo }),
                model: opts.model,
                ...(opts.resumeSessionId ? { resume: opts.resumeSessionId } : {}),
                // 도구 표면 — 읽기 5개만 자동 승인한다.
                // 쓰기 2개를 여기 넣으면 canUseTool 이 건너뛰어져 게이트가 무력화된다 (D14).
                allowedTools: READ_TOOLS,
                disallowedTools: BLOCKED_BUILTINS,
                // dontAsk 는 canUseTool 을 부르지 않아 질문 대기와 승인이 거부된다. default 를 쓴다.
                permissionMode: 'default',
                canUseTool: gate,
                // SDK 가 검사하는 종료 조건 두 개. 나머지 넷은 내가 검사한다.
                maxTurns: limits.maxTurns,
                maxBudgetUsd: limits.maxBudgetUsd,
                mcpServers: {
                    [MCP_SERVER_KEY]: { type: 'stdio', command: mcp.command, args: mcp.args,
                        ...(mcp.env ? { env: mcp.env } : {}) },
                },
            },
        });
        // 게이트가 가려진 채로 실행이 이어지지 않게, 첫 메시지 전에 한 번 확인한다.
        guard.assertNotShadowed();
        for await (const msg of stream) {
            if (msg.type === 'assistant') {
                usage.observeAssistant(msg);
                const content = msg.message?.content ?? [];
                for (const block of content) {
                    if (block.type === 'text' && typeof block.text === 'string') {
                        finalText = block.text;
                        emit({ kind: 'assistant_text', text: block.text });
                    }
                    else if (block.type === 'tool_use') {
                        const tool = String(block.name);
                        tracker.noteToolCall(tool);
                        emit({ kind: 'tool_use', tool: shortName(tool), input: block.input });
                    }
                }
                const hit = tracker.check(usage.accumulatedInputTokens);
                if (hit) {
                    stopReason = hit;
                    emit({ kind: 'stopped', reason: hit });
                    await stream.interrupt?.();
                    break;
                }
            }
            else if (msg.type === 'user') {
                const content = msg.message?.content ?? [];
                for (const block of content) {
                    if (block.type === 'tool_result') {
                        const text = Array.isArray(block.content)
                            ? block.content
                                .map((c) => (typeof c.text === 'string' ? c.text : '')).join('')
                            : String(block.content ?? '');
                        emit({ kind: 'tool_result', tool: 'result', isError: block.is_error === true,
                            preview: text.slice(0, 400) });
                    }
                }
            }
            else if (msg.type === 'result') {
                sawResult = true;
                usage.observeResult(msg);
                subtype = typeof msg.subtype === 'string' ? msg.subtype : undefined;
                sessionId = typeof msg.session_id === 'string' ? msg.session_id : undefined;
                permissionDenials = Array.isArray(msg.permission_denials) ? msg.permission_denials : [];
                resultOk = subtype === 'success';
                if (typeof msg.result === 'string' && msg.result)
                    finalText = msg.result;
            }
            else if (msg.type === 'system' && typeof msg.session_id === 'string') {
                sessionId = msg.session_id;
            }
        }
        if (!sawResult && !stopReason) {
            usage.markNoResult('결과 메시지를 받지 못했다 (연결 또는 프로세스 실패)');
        }
        guard.assertNotShadowed();
    }
    finally {
        guard.disarm();
    }
    // 종료 조건에 걸린 것이 성공보다 우선한다. 상한에 닿아 멈춘 실행을 done 으로 부르지 않는다.
    const status = stopReason ? 'stopped' : resultOk === true ? 'done' : 'failed';
    const snapshot = usage.snapshot();
    emit({ kind: 'finished', status, subtype, usage: snapshot, sessionId });
    return {
        status, subtype, sessionId,
        usage: snapshot,
        stopReason,
        toolCalls: tracker.toolCallCount,
        elapsedSeconds: Math.round(tracker.elapsedSeconds() * 10) / 10,
        waitingSeconds: Math.round(tracker.waitingSeconds * 10) / 10,
        permissionDenials,
        finalText,
    };
}
//# sourceMappingURL=engine.js.map