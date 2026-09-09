/**
 * 엔진을 백그라운드로 돌리고, Decider 를 화면으로 갈아 끼운다.
 *
 * agent/ 의 engine.ts 는 그대로 쓴다. 바뀌는 것은 "누가 결정하는가" 하나다 —
 * CLI 에서는 스크립트가, 여기서는 사람이 화면에서 결정한다.
 */
import 'server-only';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { runBriefing } from 'already-got-it-ops-agent/engine';
import type { Decider, QuestionSpec } from 'already-got-it-ops-agent/gate';
import { limitsFromEnv } from 'already-got-it-ops-agent/limits';
import { FIXTURES_DIR, MCP_ENTRY, PROJECT_ROOT, RUNS_DIR } from './paths';
import * as store from './store';

let envLoaded = false;
/** .env.local 을 읽는다. 이미 설정된 환경변수는 덮어쓰지 않는다. */
function loadEnvLocal(): void {
  if (envLoaded) return;
  envLoaded = true;
  const p = resolve(PROJECT_ROOT, '.env.local');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    const [, k, v] = m;
    if (k && process.env[k] === undefined) process.env[k] = (v ?? '').replace(/^["']|["']$/g, '');
  }
}

export function hasEngineKey(): boolean {
  loadEnvLocal();
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

const short = (v: unknown, n = 2000) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
  return s.length > n ? `${s.slice(0, n)}\n…(${s.length - n}자 줄임)` : s;
};

/** 화면이 결정하는 Decider. 약속을 걸어 두고 사람이 누를 때까지 기다린다. */
function webDecider(runId: string): Decider {
  return {
    async answerQuestions(questions: QuestionSpec[]) {
      const version = (store.readState(runId)?.answered.length ?? 0) + 1;
      return store.parkQuestion(runId, {
        question_id: `q-${version}-${Date.now().toString(36)}`,
        version,
        questions,
      });
    },
    async approveWrite(tool, input) {
      const version = (store.readState(runId)?.decisions.length ?? 0) + 1;
      return store.parkApproval(runId, {
        approval_id: `a-${version}-${Date.now().toString(36)}`,
        version,
        tool,
        summary: input,
      });
    },
  };
}

export type StartOptions = {
  runId: string;
  fixtureId: string | null;
  goal: string;
  resumeSessionId?: string;
};

/** 실행을 백그라운드로 시작한다. 응답은 기다리지 않는다. */
export function start(opts: StartOptions): void {
  loadEnvLocal();
  const { runId, fixtureId, goal, resumeSessionId } = opts;

  const childEnv: Record<string, string> = {
    OPS_MODE: process.env.OPS_MODE ?? 'fixture',
    OPS_RUNS_DIR: RUNS_DIR,
    OPS_FIXTURES_DIR: FIXTURES_DIR,
    GITHUB_ALLOWED_REPOS: process.env.GITHUB_ALLOWED_REPOS ?? 'hey-byeunya/already-got-it',
    ...(fixtureId ? { OPS_FIXTURE_ID: fixtureId } : {}),
  };
  // 승인 토큰을 이 프로세스가 쓰고 MCP 서버가 읽는다. 같은 경로를 봐야 한다.
  process.env.OPS_RUNS_DIR = RUNS_DIR;

  store.markLive(runId, {});
  store.update(runId, (s) => { s.status = 'planning'; });

  void runBriefing({
    runId,
    goal,
    decider: webDecider(runId),
    ...(resumeSessionId ? { resumeSessionId } : {}),
    mcpServerCommand: { command: process.execPath, args: [MCP_ENTRY], env: childEnv },
    limits: limitsFromEnv(),
    onEvent: (e) => {
      switch (e.kind) {
        case 'started':
          store.appendTrace(runId, { kind: e.kind, label: '실행 시작',
            detail: `상한: 반복 ${e.limits.maxTurns} · 도구 ${e.limits.maxToolCalls}`
              + ` · 비용 $${e.limits.maxBudgetUsd} · 시간 ${e.limits.maxElapsedSeconds}s`
              + ` · 같은도구연속 ${e.limits.maxSameToolStreak}` });
          store.update(runId, (s) => { s.status = 'running'; });
          break;
        case 'assistant_text':
          if (e.text.trim()) {
            store.appendTrace(runId, { kind: e.kind, label: '에이전트', detail: e.text });
          }
          break;
        case 'tool_use':
          store.appendTrace(runId, { kind: e.kind, label: `도구 호출 — ${e.tool}`, detail: short(e.input) });
          break;
        case 'tool_result':
          store.appendTrace(runId, { kind: e.kind,
            label: e.isError ? '도구 결과 — 오류' : '도구 결과', detail: e.preview, isError: e.isError });
          break;
        case 'gate':
          handleGateEvent(runId, e.event);
          break;
        case 'stopped':
          store.update(runId, (s) => {
            s.status = 'stopped';
            s.stop_reason = e.reason;
            s.trace.push({ seq: s.trace.length + 1, at: new Date().toISOString(), kind: 'stopped',
              label: `종료 조건 — ${e.reason.limit}`,
              detail: `${e.reason.message}\n관측 ${e.reason.observed} / 허용 ${e.reason.allowed}`,
              isError: true });
          });
          break;
        case 'finished':
          store.appendTrace(runId, { kind: e.kind, label: `종료 — ${e.status}${e.subtype ? ` (${e.subtype})` : ''}` });
          break;
      }
    },
  })
    .then((result) => {
      store.update(runId, (s) => {
        // 종료 조건이 걸린 실행을 done 으로 덮지 않는다.
        s.status = s.status === 'stopped' ? 'stopped' : result.status;
        s.usage = result.usage;
        s.session_id = result.sessionId;
        s.final_text = result.finalText;
        if (result.stopReason) s.stop_reason = result.stopReason;
        s.charts = collectCharts(runId);
      });
    })
    .catch((err: unknown) => {
      store.update(runId, (s) => {
        s.status = 'failed';
        s.trace.push({ seq: s.trace.length + 1, at: new Date().toISOString(), kind: 'error',
          label: '실행 실패', detail: err instanceof Error ? err.message : String(err), isError: true });
      });
    })
    .finally(() => store.clearLive(runId));
}

function handleGateEvent(runId: string, ev: { kind: string } & Record<string, unknown>): void {
  switch (ev.kind) {
    case 'question_waiting':
      store.appendTrace(runId, { kind: ev.kind, label: '질문 대기 — 사람의 답을 기다린다',
        detail: short(ev.questions) });
      break;
    case 'question_answered':
      store.appendTrace(runId, { kind: ev.kind, label: '답변 받음', detail: short(ev.answers) });
      break;
    case 'question_declined':
      store.appendTrace(runId, { kind: ev.kind, label: '답하지 않음 — 다음 단계로 넘어가지 않는다', isError: true });
      break;
    case 'approval_waiting':
      store.appendTrace(runId, { kind: ev.kind, label: `승인 대기 — ${String(ev.tool)}`,
        detail: short(ev.input) });
      break;
    case 'approval_granted':
      store.appendTrace(runId, { kind: ev.kind,
        label: `승인됨 — ${String(ev.tool)} (대상 ${String(ev.target)})`,
        detail: '승인 시점에 1회용 토큰을 주입해 실행한다. 모델은 토큰을 받지 않는다.' });
      break;
    case 'approval_denied':
      store.appendTrace(runId, { kind: ev.kind, label: `거절됨 — ${String(ev.tool)}`,
        detail: String(ev.reason), isError: true });
      break;
  }
}

function collectCharts(runId: string): { card_no: number; svg_path: string }[] {
  try {
    const dir = resolve(RUNS_DIR, runId, 'charts');
    if (!existsSync(dir)) return [];
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { readdirSync } = require('node:fs') as typeof import('node:fs');
    return readdirSync(dir).filter((f) => f.endsWith('.svg')).sort()
      .map((f) => ({ card_no: Number(f.replace('.svg', '')), svg_path: `charts/${f}` }));
  } catch { return []; }
}
