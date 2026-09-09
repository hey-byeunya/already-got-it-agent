/**
 * 디스크에 이미 있는 것을 화면 모양으로 바꾼다. **새로 수집하지 않는다.**
 *
 *  - runs/{id}/toolcalls.jsonl — MCP 서버가 남긴 도구 입출력 전문 → [ AXES ] 4축 타일
 *  - runs/{id}/cards/NN.json   — compose_card 가 남긴 카드 → [ CARDS ] 목록
 *  - RunState.trace            — → [ PROGRESS ] 6단계
 *
 * 실행에 따라 이 파일들이 **없을 수 있다** (도구를 부르기 전에 실패한 실행 등).
 * 그때는 조용히 빈 값을 돌려준다 — 화면이 깨지는 것보다 «아직 없다»가 낫다.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { RUNS_DIR } from './paths';
import type { AxesView, AxisTile, CardView, Step, TraceEvent } from './types';

const EMPTY_AXES: AxesView = {
  tiles: [
    { key: 'system', value: null, note: 'deploy', tone: 'mut' },
    { key: 'users', value: null, note: 'active', tone: 'mut' },
    { key: 'dev', value: null, note: 'commits', tone: 'mut' },
    { key: 'trend', value: null, note: 'hit', tone: 'mut' },
  ],
  unavailable_fields: [],
  collected: false,
};

type ToolCall = { seq: number; tool: string; output: unknown; ok: boolean };

function readToolCalls(runId: string): ToolCall[] {
  const path = join(RUNS_DIR, runId, 'toolcalls.jsonl');
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter((l) => l.trim())
      .flatMap((l) => {
        // 한 줄이 깨져도 나머지는 읽는다. 기록 하나 때문에 화면이 비면 안 된다.
        try { return [JSON.parse(l) as ToolCall]; } catch { return []; }
      });
  } catch { return []; }
}

const obj = (v: unknown): Record<string, unknown> =>
  (v && typeof v === 'object' ? v as Record<string, unknown> : {});

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** 그 도구가 성공적으로 돌려준 마지막 결과. */
function lastOutput(calls: ToolCall[], tool: string): Record<string, unknown> | null {
  for (let i = calls.length - 1; i >= 0; i -= 1) {
    if (calls[i]!.tool === tool && calls[i]!.ok) return obj(calls[i]!.output);
  }
  return null;
}

/** 증감 꼬리표. 비교값이 없으면 붙이지 않는다 — 없는 비교를 지어내지 않는다. */
function delta(now: number | null, prev: number | null): { text: string; tone: AxisTile['tone'] } {
  if (now === null || prev === null) return { text: '', tone: 'mut' };
  const d = now - prev;
  if (d === 0) return { text: ' · ±0', tone: 'mut' };
  return { text: ` · ${d > 0 ? '+' : '−'}${Math.abs(d)}`, tone: d > 0 ? 'ok' : 'warn' };
}

export function readAxes(runId: string): AxesView {
  const calls = readToolCalls(runId);
  if (!calls.length) return EMPTY_AXES;

  const sys = lastOutput(calls, 'get_system_health');
  const met = lastOutput(calls, 'get_user_metrics');
  const dev = lastOutput(calls, 'get_dev_activity');
  const web = lastOutput(calls, 'web_search');

  const sysSum = obj(sys?.summary);
  const sysErr = num(sysSum.error);
  const totals = obj(met?.totals);
  const prev = obj(met?.previous_period_totals);
  const devSum = obj(dev?.summary);
  const commits = num(obj(dev?.commits).count);
  const issues = num(devSum.open_issue_count);
  const hits = Array.isArray(web?.results) ? (web!.results as unknown[]).length : null;

  const active = num(totals.active_users);
  const activeDelta = delta(active, num(prev.active_users));

  const tiles: AxisTile[] = [
    {
      key: 'system',
      value: num(sysSum.total),
      note: `deploy${sysErr !== null && sysErr > 0 ? ` · err ${sysErr}` : sysErr === 0 ? ' · err 0' : ''}`,
      tone: sysErr !== null && sysErr > 0 ? 'bad' : sys ? 'ok' : 'mut',
    },
    {
      key: 'users',
      value: active,
      note: `active${activeDelta.text}`,
      tone: activeDelta.tone,
    },
    {
      key: 'dev',
      value: commits,
      note: `commits${issues !== null ? ` · iss ${issues}` : ''}`,
      tone: 'mut',
    },
    { key: 'trend', value: hits, note: 'hit · 의존성', tone: 'mut' },
  ];

  // 결측은 각 도구가 스스로 알린다. 화면은 그것을 모아 보여줄 뿐이다.
  const unavailable = new Set<string>();
  for (const src of [sys, met, dev, web]) {
    const fields = src?.unavailable_fields;
    if (Array.isArray(fields)) for (const f of fields) unavailable.add(String(f));
  }

  return { tiles, unavailable_fields: [...unavailable], collected: true };
}

/** compose_card 가 남긴 카드. accent·chart_path 로 심각도를 정한다. */
export function readCards(runId: string): CardView[] {
  const dir = join(RUNS_DIR, runId, 'cards');
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((f) => /^\d+\.json$/.test(f))
      .sort()
      .flatMap((f) => {
        try {
          const c = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Record<string, unknown>;
          const kind = (c.kind === 'cover' || c.kind === 'metric' ? c.kind : 'text') as CardView['kind'];
          const chart = typeof c.chart_path === 'string' ? c.chart_path : undefined;
          const severity: CardView['severity'] =
            kind === 'cover' ? 'COVER'
              : c.accent === 'bad' ? 'FIX_NOW'
                : c.accent === 'warn' ? 'WATCH'
                  : chart ? 'METRICS' : 'FYI';
          return [{
            card_no: Number(f.replace('.json', '')),
            kind,
            title: String(c.title ?? ''),
            body: Array.isArray(c.body) ? c.body.map(String) : [],
            sources: Array.isArray(c.sources) ? c.sources.map(String) : [],
            ...(chart ? { chart_path: chart } : {}),
            severity,
          } satisfies CardView];
        } catch { return []; }
      })
      .sort((a, b) => a.card_no - b.card_no);
  } catch { return []; }
}

/**
 * [ PROGRESS ] 6단계. 트레이스의 kind 에서 유도한다.
 *
 * 단계 모델을 따로 저장하지 않는 이유: 저장하면 트레이스와 어긋날 수 있다.
 * 트레이스가 사실이고 이건 그 사실을 읽는 방식이다.
 */
export function steps(trace: TraceEvent[], status?: string): Step[] {
  const has = (pred: (e: TraceEvent) => boolean) => trace.some(pred);
  const toolNamed = (name: string) => (e: TraceEvent) =>
    e.kind === 'tool_use' && e.label.includes(name);

  const collected = has((e) => e.kind === 'tool_use'
    && ['get_system_health', 'get_user_metrics', 'get_dev_activity', 'web_search']
      .some((t) => e.label.includes(t)));
  const asked = has((e) => e.kind === 'question_waiting');
  const answered = has((e) => e.kind === 'question_answered' || e.kind === 'question_declined');
  const charted = has(toolNamed('render_chart'));
  const composed = has(toolNamed('compose_card'));
  const proposed = has((e) => e.kind === 'approval_waiting');
  const decided = has((e) => e.kind === 'approval_granted' || e.kind === 'approval_denied');
  // 실패·중단은 «끝냈다»가 아니다. finished 이벤트만 완료로 본다 —
  // 그러지 않으면 실패한 실행이 «finalize draft ✓» 로 보인다 (화면을 열어 보고 발견했다).
  const finished = has((e) => e.kind === 'finished');
  // 끝난 실행에는 «지금» 이 없다. 멈춘 자리를 진행 중으로 그리면 아직 도는 것처럼 읽힌다.
  const over = status !== undefined
    && ['done', 'failed', 'stopped', 'interrupted'].includes(status);

  // 대기 중인 게이트가 있으면 그 자리가 «지금»이다. 없으면 **끝나지 않은 첫 단계** 하나만.
  // 처음에는 «끝나지 않았고 앞이 끝났으면 지금» 으로 뒀는데, 그러면 ◆ 가 여러 개 켜져
  // 어디서 멈춰 있는지 알 수 없었다 (화면을 열어 보고 발견했다).
  const raw: { label: string; done: boolean; waiting?: boolean }[] = [
    { label: 'collect 4-axis', done: collected },
    {
      label: asked && !answered ? 'ask_user — 답을 기다린다' : 'pick axis',
      done: answered,
      waiting: asked && !answered,
    },
    { label: 'storyboard', done: composed },
    { label: 'render_chart', done: charted },
    {
      label: proposed && !decided ? 'propose issue — 승인 대기' : 'propose issue',
      done: decided,
      waiting: proposed && !decided,
    },
    { label: 'finalize draft', done: finished },
  ];

  const waitingAt = raw.findIndex((r) => r.waiting);
  // 중단된 실행은 «어디서 멈췄는지» 를 보여줘야 하므로 대기 자리는 남긴다.
  const currentAt = waitingAt >= 0 ? waitingAt : over ? -1 : raw.findIndex((r) => !r.done);

  return raw.map((r, i) => ({
    label: r.label,
    state: r.done ? 'done' : i === currentAt ? 'current' : 'pending',
  }));
}

/** 홈 목록의 결과 한 줄. 있는 것 중 가장 중요한 하나만 고른다. */
export function resultLine(s: {
  status: string;
  charts: { card_no: number }[];
  stop_reason?: { limit: string; message: string } | undefined;
  decisions: { approved: boolean; tool: string }[];
  trace: TraceEvent[];
  final_text?: string | undefined;
}, cardCount: number): string {
  if (s.status === 'failed') {
    const err = [...s.trace].reverse().find((e) => e.isError);
    return err?.detail?.split('\n')[0]?.slice(0, 80) ?? '실행 실패';
  }
  if (s.stop_reason) return `${s.stop_reason.limit} — 부분 결과 보존`;
  if (s.status === 'interrupted') return '중단 — 대기 콜백 소실';

  const parts: string[] = [];
  const cards = cardCount || s.charts.length;
  if (cards) parts.push(`카드 ${cards}장`);
  const approved = s.decisions.filter((d) => d.approved).length;
  const rejected = s.decisions.filter((d) => !d.approved).length;
  if (approved) parts.push(`이슈 ${approved}건 생성`);
  if (rejected) parts.push(`제안 ${rejected}건 거절`);
  if (s.status === 'waiting_for_user') parts.push('사람의 답 대기');
  if (!parts.length) return s.final_text ? '원고 작성됨' : '아직 결과 없음';
  return parts.join(' · ');
}
