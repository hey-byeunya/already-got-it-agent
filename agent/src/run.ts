#!/usr/bin/env node
/**
 * CLI 실행기 — 화면 없이 브리핑 한 편을 돌린다.
 *
 * 화면을 만들기 전에 루프·게이트·종료 조건·집계를 이걸로 확인한다.
 * 웹앱은 같은 engine.ts 를 쓰고 Decider 만 화면으로 바꿔 끼운다.
 *
 *   node dist/src/run.js --fixture f2-deploy-fail
 *   node dist/src/run.js --fixture f2-deploy-fail --approve
 *   OPS_MAX_TOOL_CALLS=2 node dist/src/run.js --fixture f1-normal   # 종료 조건 걸어 보기
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBriefing } from './engine.js';
import { ScriptedDecider } from './decider.js';
import { loadEnvLocal } from './env.js';
import { limitsFromEnv } from './limits.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const AGENT_ROOT = resolve(HERE, '../..');
const PROJECT_ROOT = resolve(AGENT_ROOT, '..');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

/** .env.local 을 읽는다. 공용 로더를 쓴다 — 파서는 agent/src/env.ts 한 곳에만 있다. */
function loadEnv(): void {
  loadEnvLocal(PROJECT_ROOT);
}

async function main(): Promise<void> {
  loadEnv();

  const fixture = arg('fixture') ?? process.env.OPS_FIXTURE_ID ?? 'f2-deploy-fail';
  const runId = arg('run-id') ?? `cli-${Date.now().toString(36)}`;
  const answersPath = arg('answers');
  const approveOnly = arg('approve-only')?.split(',').map((s) => s.trim()).filter(Boolean);

  // 환경변수 키가 없다고 자격증명이 없다는 뜻은 아니다 — SDK 는
  // ANTHROPIC_API_KEY → ANTHROPIC_AUTH_TOKEN → 저장된 구독 로그인 순으로 찾는다.
  // 그래서 여기서 막지 않고, 어느 경로로 갈지만 알린다.
  // (처음에는 여기서 exit 했는데, 그러면 구독으로 도는 경로를 코드가 닫아 버린다.)
  if (process.env.ANTHROPIC_API_KEY) {
    console.log('자격증명: ANTHROPIC_API_KEY (API 사용량 크레딧에서 빠진다)');
  } else if (process.env.ANTHROPIC_AUTH_TOKEN) {
    console.log('자격증명: ANTHROPIC_AUTH_TOKEN');
  } else {
    console.log('자격증명: 환경변수에 없음 — SDK 가 저장된 로그인(구독)으로 시도한다');
  }

  const runsDir = resolve(PROJECT_ROOT, 'runs');
  const mode = process.env.OPS_MODE ?? 'fixture';
  const live = mode === 'live';

  // MCP 서버에 넘기는 환경변수는 **명시한 것만**이다. 부모 환경을 그대로 물려주지 않는다.
  // 그래서 live 자격증명도 live 모드일 때만 넘어간다 — fixture 실행은 토큰을 아예 못 본다.
  const childEnv: Record<string, string> = {
    OPS_MODE: mode,
    OPS_RUNS_DIR: runsDir,
    OPS_FIXTURES_DIR: resolve(PROJECT_ROOT, 'fixtures/snapshots'),
    // live 모드에서 fixture_id 가 남아 있으면 서버가 fixture_in_live_mode 로 거절한다.
    ...(live ? {} : { OPS_FIXTURE_ID: fixture }),
    GITHUB_ALLOWED_REPOS: process.env.GITHUB_ALLOWED_REPOS ?? 'hey-byeunya/already-got-it',
  };
  if (live) {
    for (const k of ['VERCEL_API_TOKEN', 'VERCEL_PROJECT_ID', 'GITHUB_TOKEN',
      'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'OPS_METRICS_TOKEN',
      'OPS_ALLOW_LIVE_WRITES']) {
      const v = process.env[k];
      if (v) childEnv[k] = v;
    }
  }
  // 승인 토큰을 이 프로세스가 쓰고 MCP 서버가 읽는다. 같은 경로를 봐야 한다.
  process.env.OPS_RUNS_DIR = runsDir;

  const answers = answersPath
    ? JSON.parse(readFileSync(resolve(process.cwd(), answersPath), 'utf8')) as Record<string, string>
    : undefined;

  const decider = new ScriptedDecider({
    answers,
    approveWrites: has('approve'),
    approveOnly,
    onLog: (l) => console.log(l),
  });

  // 모델은 오늘 날짜를 모른다. 기간을 여기서 계산해 지시에 박는다.
  // (fixture 모드에서는 서버가 스냅샷을 돌려주므로 이 값이 결과를 바꾸지 않는다.)
  const periodUntil = new Date().toISOString();
  const periodSince = new Date(Date.now() - 7 * 86_400_000).toISOString();

  const limits = limitsFromEnv();
  console.log(`\n브리핑 실행 — ${live ? '⚡ live (실제 API)' : `픽스처 ${fixture}`} · run ${runId}`);
  if (live) {
    const writes = process.env.OPS_ALLOW_LIVE_WRITES === '1';
    console.log(`실제 쓰기: ${writes ? '⚠️ 허용 — 승인하면 진짜 이슈가 만들어진다' : '차단 (OPS_ALLOW_LIVE_WRITES=0)'}`);
  }
  console.log(`상한: 반복 ${limits.maxTurns} · 도구 ${limits.maxToolCalls} · 비용 $${limits.maxBudgetUsd}`
    + ` · 시간 ${limits.maxElapsedSeconds}s · 같은도구연속 ${limits.maxSameToolStreak}`);
  console.log(`쓰기 승인: ${has('approve') ? '허용' : approveOnly ? approveOnly.join(',') + ' 만' : '거절 (기본값)'}`);
  console.log('─'.repeat(70));

  const result = await runBriefing({
    runId,
    goal: arg('goal') ?? (
      `이번 주 「이미 있어」 운영 브리핑 카드뉴스를 만들어 줘.`
      + ` 기간은 ${periodSince.slice(0, 10)} 부터 ${periodUntil.slice(0, 10)} 까지다`
      + ` (도구의 since·until 에 이 값을 그대로 넘긴다).`
      + ` run_id 는 "${runId}" 를 쓴다.`
       + ` 스토리보드를 제시한 뒤, 지표 카드는 render_chart 로 실제 SVG 까지 그려라.`
       + ` 손봐야 할 것이 있으면 create_github_issue 로 이슈 생성을 제안해라 (승인은 사람이 한다).`
       + ` 앱 에러·배포 실패는 route·건수와 찾아갈 링크를 본문에 넣어라`
       + ` (errors_by_route[].url, deployments[]의 url·commit_url. null 이면 이름만).`
    ),
    decider,
    mcpServerCommand: {
      command: process.execPath,
      args: [resolve(PROJECT_ROOT, 'mcp-server/dist/src/index.js')],
      env: childEnv,
    },
    limits,
    onEvent: (e) => {
      switch (e.kind) {
        case 'tool_use':
          console.log(`🔧 ${e.tool}  ${JSON.stringify(e.input).slice(0, 160)}`);
          break;
        case 'tool_result':
          console.log(`   ${e.isError ? '✖' : '→'} ${e.preview.replace(/\s+/g, ' ').slice(0, 160)}`);
          break;
        case 'assistant_text':
          if (e.text.trim()) console.log(`💬 ${e.text.trim().slice(0, 400)}`);
          break;
        case 'gate':
          switch (e.event.kind) {
            case 'question_waiting':
              console.log(`❓ 질문 대기 — ${e.event.questions.map((q) => q.header).join(' / ')}`);
              break;
            case 'question_answered':
              console.log(`   답변: ${JSON.stringify(e.event.answers)}`);
              break;
            case 'approval_waiting':
              console.log(`⚠️  승인 대기 — ${e.event.tool}`);
              break;
            case 'approval_granted':
              console.log(`   ✅ 승인 (대상 ${e.event.target}) — 토큰을 주입해 실행한다`);
              break;
            case 'approval_denied':
              console.log(`   🛑 거절 — ${e.event.reason}`);
              break;
            default:
              break;
          }
          break;
        case 'hook_denied':
          console.log(`🚧 훅이 막음 (${e.denial.rule}) — ${e.denial.tool}`);
          console.log(`   ${e.denial.reason}`);
          break;
        case 'stopped':
          console.log(`🛑 종료 조건: ${e.reason.limit} — ${e.reason.message}`
            + ` (관측 ${e.reason.observed} / 허용 ${e.reason.allowed})`);
          break;
        default:
          break;
      }
    },
  });

  console.log('─'.repeat(70));
  console.log(`상태: ${result.status}${result.subtype ? ` (${result.subtype})` : ''}`);
  console.log(`도구 호출 ${result.toolCalls}회 · 실행 ${result.elapsedSeconds}s`
    + ` (대기 ${result.waitingSeconds}s 제외)`);
  const u = result.usage;
  if (u.usage_known) {
    console.log(`토큰 입력 ${u.input_tokens} (캐시읽기 ${u.cache_read_input_tokens})`
      + ` · 출력 ${u.output_tokens}`);
    const onApiKey = Boolean(process.env.ANTHROPIC_API_KEY);
    console.log(
      `비용 $${u.total_cost_usd.toFixed(4)} — 클라이언트 측 추정값이며 실제 청구액이 아니다`
      + (onApiKey ? ' (API 사용량 크레딧에서 차감)' : ' (구독 로그인 실행 — API 크레딧에서 차감되지 않는다)'),
    );
  } else {
    console.log(`토큰·비용: 확인 못 함 — ${u.unknown_reason}`);
  }
  if (result.permissionDenials.length) {
    console.log(`SDK 거절 기록 ${result.permissionDenials.length}건 (승인 게이트가 막은 근거)`);
  }
  if (result.hookDenials.length) {
    console.log(`PreToolUse 훅 거절 ${result.hookDenials.length}건 — `
      + result.hookDenials.map((d) => d.rule).join(', '));
  }
  console.log(`실행 기록: runs/${runId}/toolcalls.jsonl`);
  console.log(`세션 ID: ${result.sessionId ?? '(없음)'} — 이어가려면 이 값을 저장한다\n`);

  process.exitCode = result.status === 'done' ? 0 : 1;
}

main().catch((err) => {
  console.error('\n실행 실패:', err instanceof Error ? err.message : err);
  process.exit(1);
});
