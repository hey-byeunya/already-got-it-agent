/**
 * opencode 엔진 — Claude 크레딧이 바닥나도 별도 인증·모델로 브리핑을 돌리는 경로.
 *
 * `opencode run <goal> --format json` 을 백그라운드로 돌리고 JSON 이벤트를
 * 화면 trace 로 옮긴다. MCP `ops` 서버는 OPENCODE_CONFIG_CONTENT 으로 그때그때
 * 붙인다 — 저장소에 opencode.json 을 두지 않아 경로가 기계에 묶이지 않게.
 *
 * claude 엔진과 다른 점 (정직하게 적는다):
 *   - 질문 대기·승인 대기가 없다. `question` 을 묻지 말고 끝까지 가라고 지시한다.
 *   - 쓰기 도구 2개는 tools 토글로 끈다. 이슈 제안은 최종 텍스트에 적힌다.
 *   - 사용량은 step_finish 합계다. 없으면 usage_known: false 로 남긴다.
 */
import 'server-only';
import { execFile } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { PROJECT_ROOT, RUNS_DIR, FIXTURES_DIR } from './paths';
import { opsMode } from './mode';
import * as store from './store';
import { parseOpencodeLine } from './opencode-events';

const OPENCODE_TIMEOUT_MS = 20 * 60 * 1000;

function opencodeBin(): string {
  return process.env.OPS_OPENCODE_BIN?.trim() || 'opencode';
}

/**
 * MCP `ops` 서버를 그때그때 붙이는 인라인 설정. 경로는 절대값으로 박는다.
 *
 * 모드는 claude 경로와 **같은 판정**을 쓴다. 전에는 'fixture' 를 박아 두어서,
 * 시작 화면이 LIVE 라고 말해도 opencode 실행만 조용히 픽스처로 돌았다.
 * 쓰기 도구 2개가 이미 꺼져 있으므로 live 라도 이 경로는 읽기 전용이다.
 */
function configContent(
  runsDir: string, fixturesDir: string, fixtureId: string | null, mode: 'fixture' | 'live',
): string {
  return JSON.stringify({
    $schema: 'https://opencode.ai/config.json',
    mcp: {
      ops: {
        type: 'local',
        command: ['node', 'mcp-server/dist/src/index.js'],
        enabled: true,
        environment: {
          OPS_MODE: mode,
          // live 모드에서 fixture_id 를 넘기면 서버가 fixture_in_live_mode 로 거절한다.
          ...(mode === 'fixture' && fixtureId ? { OPS_FIXTURE_ID: fixtureId } : {}),
          OPS_RUNS_DIR: runsDir,
          OPS_FIXTURES_DIR: fixturesDir,
          GITHUB_ALLOWED_REPOS: process.env.GITHUB_ALLOWED_REPOS ?? 'hey-byeunya/already-got-it',
        },
      },
    },
    // 쓰기 도구 2개는 끈다. 승인 UI 가 없는 경로에서 이슈가 생기면 안 된다.
    tools: { ops_create_github_issue: false, ops_revert_issue: false },
    permission: { edit: 'deny', bash: 'deny' },
  });
}

const short = (v: unknown, n = 2000) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
  return s.length > n ? `${s.slice(0, n)}\n…(${s.length - n}자 줄임)` : s;
};

export type OpencodeStartOptions = {
  runId: string;
  fixtureId: string | null;
  goal: string;
  model?: string;
};

/** 백그라운드로 돌린다. 응답은 기다리지 않는다 — claude 쪽 start() 와 같은 약속이다. */
export function startOpencode(opts: OpencodeStartOptions): void {
  const { runId, fixtureId, goal } = opts;
  // 화면 입력이 없으면 환경변수 기본값, 그것도 없으면 opencode 기본 모델이다.
  const model = opts.model?.trim() || process.env.OPS_OPENCODE_MODEL?.trim() || undefined;
  const runsDir = RUNS_DIR;
  store.markLive(runId, {});
  store.update(runId, (s) => { s.status = 'running'; });

  const fullGoal = `${goal}\n\n이번 실행의 추가 규칙:\n`
    + `- MCP ops 도구의 run_id 에는 "${runId}" 를 반드시 넣는다.\n`
    + `- 사람에게 질문하지 말고 스스로 판단해 끝까지 진행한다.\n`
    + `- 이슈 생성·되돌리기 도구는 쓸 수 없다. 남길 만한 것은 최종 텍스트에 제안으로 적는다.\n`
    + `- 지표 카드는 render_chart 로 실제 SVG 까지 그리고, 카드는 compose_card 로 한 장씩 만든 뒤 export_cardnews 를 한 번 부른다.`;

  const env: NodeJS.ProcessEnv = { ...process.env };
  env.OPENCODE_CONFIG_CONTENT = configContent(runsDir, FIXTURES_DIR, fixtureId, opsMode());
  // 실측: GOOGLE_API_KEY 만 있고 GOOGLE_GENERATIVE_AI_API_KEY 가 없으면
  // google provider 가 인증 오류로 죽는다. 같은 값이면 이어 준다.
  if (!env.GOOGLE_GENERATIVE_AI_API_KEY && env.GOOGLE_API_KEY) {
    env.GOOGLE_GENERATIVE_AI_API_KEY = env.GOOGLE_API_KEY;
  }

  const args = ['run', fullGoal, '--format', 'json', '--dir', PROJECT_ROOT];
  if (model) args.push('-m', model);

  store.appendTrace(runId, { kind: 'started', label: 'opencode 실행 시작',
    detail: `엔진 opencode${model ? ` · 모델 ${model}` : ' · 기본 모델'}` });

  let inputTokens = 0;
  let outputTokens = 0;
  let cost = 0;
  let sawFinish = false;
  let finalText = '';
  let toolCalls = 0;
  const errors: string[] = [];

  // 상한은 execFile 의 timeout 대신 우리가 잰다.
  // execFile 이 끊으면 close 에는 SIGTERM 만 남아, 상한에 걸린 것인지 밖에서 죽인 것인지
  // 화면이 구별하지 못한다 — 실제로 「종료 코드 null (시그널 SIGTERM)」만 적혀 원인을 못 찾았다.
  let killedByTimeout = false;
  let sawAnyLine = false;

  // 콜백은 비워 둔다 — 결과는 'close'·'error' 이벤트로 받는다. 콜백 없이 부르면 타입이 안 맞는다.
  const child = execFile(opencodeBin(), args, {
    env, maxBuffer: 32 * 1024 * 1024,
  }, () => {});
  const deadline = setTimeout(() => { killedByTimeout = true; child.kill('SIGTERM'); },
    OPENCODE_TIMEOUT_MS);
  let stdout = '';
  child.stdout?.on('data', (chunk: Buffer | string) => {
    stdout += String(chunk);
    const lines = stdout.split('\n');
    stdout = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      sawAnyLine = true;
      const parsed = parseOpencodeLine(line);
      if (parsed.kind === 'text') {
        finalText = parsed.text;
        store.appendTrace(runId, { kind: 'assistant_text', label: '에이전트', detail: parsed.text });
      } else if (parsed.kind === 'tool') {
        toolCalls += 1;
        store.appendTrace(runId, { kind: 'tool_use',
          label: `도구 호출 — ${parsed.tool}`, detail: short(parsed.input) });
        store.appendTrace(runId, { kind: 'tool_result',
          label: parsed.isError ? '도구 결과 — 오류' : '도구 결과',
          detail: short(parsed.output, 2000), isError: parsed.isError });
      } else if (parsed.kind === 'usage') {
        sawFinish = true;
        inputTokens += parsed.input;
        outputTokens += parsed.output;
        cost += parsed.cost;
      } else if (parsed.kind === 'error') {
        errors.push(parsed.message);
        store.appendTrace(runId, { kind: 'error', label: 'opencode 오류', detail: parsed.message, isError: true });
      }
    }
  });

  child.on('error', (err) => {
    clearTimeout(deadline);
    store.update(runId, (s) => {
      s.status = 'failed';
      s.trace.push({ seq: s.trace.length + 1, at: new Date().toISOString(), kind: 'error',
        label: '실행 실패', detail: `opencode 를 띄우지 못했다: ${err.message}`, isError: true });
    });
    store.clearLive(runId);
  });

  child.on('close', (code, signal) => {
    clearTimeout(deadline);
    store.update(runId, (s) => {
      if (code === 0 && errors.length === 0) {
        s.status = 'done';
      } else {
        s.status = 'failed';
        s.trace.push({ seq: s.trace.length + 1, at: new Date().toISOString(), kind: 'error',
          label: '실행 실패',
          detail: (killedByTimeout
            ? `${OPENCODE_TIMEOUT_MS / 60000}분 상한에서 끊었다 (SIGTERM)`
              + (sawAnyLine ? '' : ' — opencode 가 그동안 한 줄도 내놓지 않았다.'
                + ' 모델·인증이 준비됐는지 opencode 쪽에서 먼저 본다: opencode auth list')
            : `종료 코드 ${code}${signal ? ` (시그널 ${signal})` : ''}`)
            + (errors.length ? `\n${errors.join('\n')}` : ''),
          isError: true });
      }
      s.usage = sawFinish || code === 0 ? {
        usage_known: sawFinish,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        total_cost_usd: Math.round(cost * 10000) / 10000,
        cost_is_estimate: true as const,
        ...(sawFinish ? {} : { unknown_reason: 'opencode 실행에서 사용량 집계를 받지 못했다' }),
      } : s.usage;
      s.final_text = finalText || undefined;
      try {
        const dir = resolve(RUNS_DIR, runId, 'charts');
        s.charts = existsSync(dir)
          ? readdirSync(dir).filter((f) => f.endsWith('.svg')).sort()
            .map((f) => ({ card_no: Number(f.replace('.svg', '')), svg_path: `charts/${f}` }))
          : [];
      } catch { s.charts = []; }
    });
    store.clearLive(runId);
  });
}
