#!/usr/bin/env node
/**
 * 스모크 — MCP 서버에 stdio 로 붙어 도구 흐름을 한 번 돌린다.
 *
 * 확인하는 것:
 *   1. 읽기 도구 3개가 픽스처를 돌려준다
 *   2. render_chart 가 근거 없는 값을 거절하고, 근거 있는 값은 그린다
 *   3. create_github_issue 가 승인 토큰 없이는 거절된다  ← 승인 게이트 ②
 *   4. 토큰을 발급하면 통과한다
 *   5. revert_issue 가 범위 밖 이슈를 거절하고, 자기 이슈는 되돌린다  ← 확장②
 *
 *   node scripts/smoke.mjs [fixture_id]
 */
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const FIXTURE = process.argv[2] ?? 'f2-deploy-fail';
const RUN_ID = `smoke-${Date.now().toString(36)}`;
const RUNS_DIR = mkdtempSync(resolve(tmpdir(), 'ops-smoke-'));
const REPO = 'hey-byeunya/already-got-it';

const env = {
  ...process.env,
  OPS_MODE: 'fixture',
  OPS_RUNS_DIR: RUNS_DIR,
  OPS_FIXTURES_DIR: resolve(ROOT, '../fixtures/snapshots'),
};

const child = spawn(process.execPath, [resolve(ROOT, 'dist/src/index.js')], { env, stdio: ['pipe', 'pipe', 'inherit'] });
let nextId = 1;
const pending = new Map();
let buf = '';
child.stdout.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    const r = pending.get(msg.id);
    if (r) { pending.delete(msg.id); r(msg); }
  }
});

function rpc(method, params) {
  const id = nextId++;
  return new Promise((res) => {
    pending.set(id, res);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

/** 도구를 부르고 결과 JSON 과 isError 를 돌려준다. */
async function call(name, args) {
  const r = await rpc('tools/call', { name, arguments: { run_id: RUN_ID, fixture_id: FIXTURE, ...args } });
  const text = r.result?.content?.[0]?.text ?? JSON.stringify(r.error ?? r);
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { isError: !!r.result?.isError, data: parsed };
}

const mintToken = (tool, target) =>
  execFileSync(process.execPath, [resolve(ROOT, 'scripts/mint-approval.mjs'), RUN_ID, tool, target], { env })
    .toString().trim();

let step = 0;
const ok = (label, cond, detail = '') => {
  step += 1;
  console.log(`${cond ? '✅' : '❌'} ${String(step).padStart(2)}. ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) process.exitCode = 1;
};

await rpc('initialize', {
  protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '0' },
});
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

console.log(`\n픽스처 ${FIXTURE} · run ${RUN_ID}\n${'─'.repeat(64)}`);

// 1. 읽기 도구
const sys = await call('get_system_health', { since: '2026-09-02', until: '2026-09-09' });
ok('get_system_health', !sys.isError,
  `배포 ${sys.data.summary?.total}건 (실패 ${sys.data.summary?.error}) · 결측 ${sys.data.unavailable_fields?.length ?? '?'}개`);

const met = await call('get_user_metrics', { since: '2026-09-02', until: '2026-09-09' });
ok('get_user_metrics', !met.isError,
  `가입 ${met.data.totals?.signups} (전주 ${met.data.previous_period_totals?.signups ?? '없음'})`);

const dev = await call('get_dev_activity', { since: '2026-09-02', until: '2026-09-09', repo: REPO });
ok('get_dev_activity', true, dev.isError ? `실패 재현: ${dev.data.error}` : `열린 이슈 ${dev.data.summary?.open_issue_count}건`);

const bad = await call('get_dev_activity', { since: '2026-09-02', until: '2026-09-09', repo: 'someone/else' });
ok('허용 목록 밖 저장소 거절', bad.isError && bad.data.error === 'repo_not_allowed', bad.data.error);

// 2. 차트 근거 대조
const invented = await call('render_chart', {
  card_no: 2, chart_type: 'bar', title: '지어낸 수치',
  source: { tool: 'get_user_metrics', field: 'series[].signups' },
  data: [{ label: 'x', value: 12345 }],
});
ok('근거 없는 수치로 차트 거절', invented.isError && invented.data.error === 'source_mismatch', invented.data.error);

const realValues = (met.data.series ?? []).map((r) => ({ label: r.date.slice(5), value: r.signups }));
const chart = realValues.length
  ? await call('render_chart', {
      card_no: 2, chart_type: 'bar', title: '일별 가입',
      source: { tool: 'get_user_metrics', field: 'series[].signups' }, data: realValues,
    })
  : { isError: true, data: { error: 'no_series' } };
ok('근거 있는 수치로 차트 생성', !chart.isError && chart.data.rendered_ok === true,
  chart.isError ? chart.data.error : `${chart.data.svg_path} (${chart.data.bytes}B, source_verified=${chart.data.source_verified})`);

// 3. 승인 게이트 — 토큰 없이
const noToken = await call('create_github_issue', {
  repo: REPO, title: '배포 실패 확인', body: '근거: get_system_health.deployments[1]',
  labels: ['ops'], source: { tool: 'get_system_health', field: 'deployments[1]' },
});
ok('승인 토큰 없이 이슈 생성 거절', noToken.isError && noToken.data.error === 'approval_required', noToken.data.error);

// 4. 승인 후
const t1 = mintToken('create_github_issue', REPO);
const created = await call('create_github_issue', {
  repo: REPO, title: '배포 실패 확인', body: '근거: get_system_health.deployments[1]',
  labels: ['ops'], source: { tool: 'get_system_health', field: 'deployments[1]' }, approval_token: t1,
});
ok('승인 후 이슈 생성', !created.isError && created.data.created === true,
  created.isError ? created.data.error : `#${created.data.number} (simulated=${created.data.simulated})`);

const reuse = await call('create_github_issue', {
  repo: REPO, title: '중복', body: 'x', labels: [], source: { tool: 'get_system_health', field: 'x' },
  approval_token: t1,
});
ok('같은 토큰 재사용 거절 (두 번 만들지 않음)', reuse.isError && reuse.data.error === 'token_already_used', reuse.data.error);

const badLabel = await call('create_github_issue', {
  repo: REPO, title: 'x', body: 'x', labels: ['아무라벨'],
  source: { tool: 'get_system_health', field: 'x' }, approval_token: mintToken('create_github_issue', REPO),
});
ok('허용 목록 밖 라벨 거절', badLabel.isError && badLabel.data.error === 'label_not_allowed', badLabel.data.error);

// 5. 되돌리기 (확장②)
const outOfScope = await call('revert_issue', {
  issue_number: 12345, reason: '범위 밖', approval_token: mintToken('revert_issue', '12345'),
});
ok('승인 기록에 없는 이슈 되돌리기 거절', outOfScope.isError && outOfScope.data.error === 'not_in_approval_log',
  outOfScope.data.error);

const num = created.data.number;
const reverted = await call('revert_issue', {
  issue_number: num, reason: '오탐이었음', approval_token: mintToken('revert_issue', String(num)),
});
ok('내가 만든 이슈는 되돌린다', !reverted.isError && reverted.data.reverted === true,
  reverted.isError ? reverted.data.error : `#${num} → ${reverted.data.state}`);

console.log(`${'─'.repeat(64)}`);
console.log(`실행 기록: ${RUNS_DIR}/${RUN_ID}/toolcalls.jsonl`);
console.log(`승인 기록: ${RUNS_DIR}/${RUN_ID}/approvals.json`);
console.log(process.exitCode ? '\n일부 항목 실패\n' : '\n전부 통과\n');
child.kill();
