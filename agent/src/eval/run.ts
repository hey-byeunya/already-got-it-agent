#!/usr/bin/env node
/**
 * 평가 실행기 (EVAL.md).
 *
 * 픽스처 × 시행 횟수를 돌려 채점하고 결과를 파일로 남긴다.
 * 시행마다 즉시 쓰므로 중간에 끊겨도 앞선 결과가 남는다.
 *
 *   node dist/src/eval/run.js --variant E0 --attempts 3
 *   node dist/src/eval/run.js --variant E0 --attempts 1 --fixtures f2-deploy-fail
 *
 * Day 38 교훈: 같은 코드·모델로 한 문항이 3회에 0~88점으로 흔들렸다.
 * 그래서 시행 횟수와 편차를 결과에 반드시 남기고, 1회 비교를 근거로 쓰지 않는다.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBriefing } from '../engine.js';
import { ScriptedDecider } from '../decider.js';
import { limitsFromEnv } from '../limits.js';
import { score, type Fixture, type Score } from './score.js';

const HERE = dirname(fileURLToPath(import.meta.url));
// dist/src/eval → dist/src → dist → agent → already-got-it-agent (네 단계)
const PROJECT_ROOT = resolve(HERE, '../../../..');
const FIXTURES_DIR = resolve(PROJECT_ROOT, 'fixtures/snapshots');
const RUNS_DIR = resolve(PROJECT_ROOT, 'runs');
const RESULTS_DIR = resolve(PROJECT_ROOT, 'eval-results');
const MCP_ENTRY = resolve(PROJECT_ROOT, 'mcp-server/dist/src/index.js');

const arg = (n: string): string | undefined => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

function loadEnvLocal(): void {
  const p = resolve(PROJECT_ROOT, '.env.local');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    const [, k, v] = m;
    if (k && process.env[k] === undefined) process.env[k] = (v ?? '').replace(/^["']|["']$/g, '');
  }
}

export type Trial = {
  variant: string;
  fixture_id: string;
  attempt: number;
  run_id: string;
  started_at: string;
  finished_at: string;
  status: string;
  subtype?: string;
  stop_reason?: unknown;
  tool_calls: number;
  elapsed_seconds: number;
  usage_known: boolean;
  total_cost_usd: number | null;
  input_tokens: number;
  output_tokens: number;
  credential_source: 'api_key' | 'stored_login';
  permission_denials: number;
  hook_denials: number;
  score: Score;
  final_text_length: number;
  /**
   * 브리핑 원고 전문.
   *
   * 이걸 안 남기면 **재채점도 수동 채점도 불가능하다.** 첫 평가에서 채점기 과탐지를
   * 발견했을 때 원고가 없어 시행을 버려야 했다. 근거 미표기율·과잉 단정률·우선순위 적중은
   * 사람이 이 글을 읽고 판정한다.
   */
  final_text: string;
};

const GOAL = (runId: string) =>
  `이번 주 「이미 있어」 운영 브리핑 카드뉴스를 만들어 줘. 기간은 최근 7일이다.`
  + ` run_id 는 "${runId}" 를 쓴다.`
  + ` 스토리보드를 제시한 뒤, 지표 카드는 render_chart 로 실제 SVG 까지 그려라.`
  + ` 손봐야 할 것이 있으면 create_github_issue 를 호출해 이슈 생성을 제안해라.`;

async function runTrial(variant: string, fixtureId: string, attempt: number): Promise<Trial> {
  const runId = `eval-${variant}-${fixtureId}-${attempt}`;
  const startedAt = new Date().toISOString();

  const childEnv: Record<string, string> = {
    OPS_MODE: 'fixture',
    OPS_RUNS_DIR: RUNS_DIR,
    OPS_FIXTURES_DIR: FIXTURES_DIR,
    OPS_FIXTURE_ID: fixtureId,
    GITHUB_ALLOWED_REPOS: process.env.GITHUB_ALLOWED_REPOS ?? 'hey-byeunya/already-got-it',
  };
  process.env.OPS_RUNS_DIR = RUNS_DIR;

  // 쓰기는 거절한다 — 평가 대상은 브리핑 내용이고, 기본값이 거절이라 실행도 싸다.
  const decider = new ScriptedDecider({ approveWrites: false });

  const result = await runBriefing({
    runId,
    goal: GOAL(runId),
    decider,
    mcpServerCommand: { command: process.execPath, args: [MCP_ENTRY], env: childEnv },
    limits: limitsFromEnv(),
  });

  const fx = JSON.parse(readFileSync(resolve(FIXTURES_DIR, `${fixtureId}.json`), 'utf8')) as Fixture;
  const s = score(result.finalText, fx);

  return {
    variant, fixture_id: fixtureId, attempt, run_id: runId,
    started_at: startedAt, finished_at: new Date().toISOString(),
    status: result.status,
    ...(result.subtype ? { subtype: result.subtype } : {}),
    ...(result.stopReason ? { stop_reason: result.stopReason } : {}),
    tool_calls: result.toolCalls,
    elapsed_seconds: result.elapsedSeconds,
    usage_known: result.usage.usage_known,
    // 모르는 것을 0 으로 적지 않는다 (D15)
    total_cost_usd: result.usage.usage_known ? result.usage.total_cost_usd : null,
    input_tokens: result.usage.input_tokens,
    output_tokens: result.usage.output_tokens,
    credential_source: process.env.ANTHROPIC_API_KEY ? 'api_key' : 'stored_login',
    permission_denials: result.permissionDenials.length,
    hook_denials: result.hookDenials.length,
    score: s,
    final_text_length: result.finalText.length,
    final_text: result.finalText,
  };
}

function summarize(trials: Trial[]): unknown {
  const byFixture = new Map<string, Trial[]>();
  for (const t of trials) {
    const arr = byFixture.get(t.fixture_id) ?? [];
    arr.push(t); byFixture.set(t.fixture_id, arr);
  }

  const rows = [...byFixture.entries()].map(([fixture, ts]) => {
    const hall = ts.map((t) => t.score.hallucinations.length);
    const miss = ts.map((t) => t.score.missing_misread_candidates.length);
    const cleared = ts.map((t) => t.score.missing_misread_cleared.length);
    const known = ts.filter((t) => t.usage_known);
    const costs = known.map((t) => t.total_cost_usd!);
    const mi = ts.map((t) => t.score.must_include_auto_judgeable > 0
      ? t.score.must_include_satisfied / t.score.must_include_auto_judgeable : null);
    const miKnown = mi.filter((v): v is number => v !== null);

    return {
      fixture,
      attempts: ts.length,
      완주: `${ts.filter((t) => t.status === 'done').length}/${ts.length}`,
      환각_건수: { min: Math.min(...hall), max: Math.max(...hall),
        평균: +(hall.reduce((a, b) => a + b, 0) / hall.length).toFixed(2) },
      결측오독_후보: { min: Math.min(...miss), max: Math.max(...miss),
        비고: '사람 확인 필요 — 정규식이 문장 판단을 대신하지 못한다' },
      결측오독_규칙에걸렸으나_올바른서술: { min: Math.min(...cleared), max: Math.max(...cleared) },
      필수신호_충족률: miKnown.length
        ? { 평균: +(miKnown.reduce((a, b) => a + b, 0) / miKnown.length).toFixed(2),
            판정가능_정답수: ts[0]!.score.must_include_auto_judgeable }
        : '판정 불가',
      소요초: { min: Math.min(...ts.map((t) => t.elapsed_seconds)),
        max: Math.max(...ts.map((t) => t.elapsed_seconds)) },
      비용: costs.length
        ? { 평균: +(costs.reduce((a, b) => a + b, 0) / costs.length).toFixed(4),
            분모: `${known.length}/${ts.length}`, 비고: '추정값' }
        : { 평균: null, 분모: `0/${ts.length}`, 비고: 'usage_known=false 라 집계에서 뺐다' },
      결측_미확인필드: [...new Set(ts.flatMap((t) => t.score.missing_unchecked))],
    };
  });

  return {
    generated_at: new Date().toISOString(),
    trials: trials.length,
    usage_known_trials: trials.filter((t) => t.usage_known).length,
    credential_source: trials[0]?.credential_source ?? 'unknown',
    지표_정의: {
      환각: '배포ID·커밋SHA·이슈번호·지표낱말 옆 숫자가 픽스처에 없는 건수',
      결측오독_후보: 'unavailable_fields 항목을 0 이나 정상으로 서술한 것으로 규칙에 걸린 건수. '
        + '같은 문장에 불확실성 표시(못·미확인·말할 수 없 등)가 있으면 올바른 서술로 보고 뺀다. '
        + '남은 것은 후보이며 사람이 확인해야 한다',
      필수신호_충족률: '정답의 식별자·숫자 토큰이 원고에 나오는 비율 (토큰 대리 지표)',
      분모_규칙: 'usage_known=false 인 시행은 비용 집계 분모에서 빼고 그 수를 밝힌다',
    },
    수동_확인_항목: ['근거 미표기율', '과잉 단정률', '우선순위 적중', '결측 오독 후보 확인'],
    rows,
  };
}

async function main(): Promise<void> {
  loadEnvLocal();
  const variant = arg('variant') ?? 'E0';
  const attempts = Number(arg('attempts') ?? 3);
  const only = arg('fixtures')?.split(',').map((s) => s.trim()).filter(Boolean);
  const fixtures = only ?? readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', '')).sort();

  const outDir = resolve(RESULTS_DIR, variant);
  mkdirSync(outDir, { recursive: true });

  console.log(`평가 ${variant} — 픽스처 ${fixtures.length}개 × ${attempts}회 = ${fixtures.length * attempts}시행`);
  console.log(`자격증명: ${process.env.ANTHROPIC_API_KEY ? 'API 키' : '저장된 로그인(구독)'}`);
  console.log('─'.repeat(70));

  const trials: Trial[] = [];
  for (const fixtureId of fixtures) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const label = `${fixtureId} #${attempt}`;
      process.stdout.write(`${label} … `);
      try {
        const t = await runTrial(variant, fixtureId, attempt);
        trials.push(t);
        writeFileSync(resolve(outDir, `${fixtureId}__${attempt}.json`), JSON.stringify(t, null, 2));
        console.log(
          `${t.status} · 도구 ${t.tool_calls} · ${t.elapsed_seconds}s`
          + ` · 환각 ${t.score.hallucinations.length} · 결측오독후보 ${t.score.missing_misread_candidates.length}`
          + ` · 비용 ${t.usage_known ? `$${t.total_cost_usd!.toFixed(4)}` : '확인못함'}`,
        );
      } catch (err) {
        console.log(`실패 — ${err instanceof Error ? err.message : String(err)}`);
        writeFileSync(resolve(outDir, `${fixtureId}__${attempt}.error.json`),
          JSON.stringify({ fixtureId, attempt, error: String(err) }, null, 2));
      }
    }
  }

  const summary = summarize(trials);
  writeFileSync(resolve(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log('─'.repeat(70));
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\n결과: eval-results/${variant}/`);
}

main().catch((e) => { console.error('평가 실패:', e); process.exit(1); });
