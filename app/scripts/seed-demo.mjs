#!/usr/bin/env node
/**
 * 화면 확인용 상태 심기.
 *
 * ⚠️ 이것은 **실제 실행 기록이 아니다.** 모델을 부르지 않고 화면만 확인하기 위한 것이며,
 * run_id 에 `demo-` 접두어를 붙여 실제 실행과 구별한다. 평가나 증거로 쓰지 않는다.
 *
 * 확인할 수 있는 것: 질문 대기 · 승인 대기 · 중단 후 재개 · 비용 확인 못 함 · 차트 표시
 *
 *   node scripts/seed-demo.mjs
 */
import { mkdirSync, writeFileSync, copyFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const RUNS = join(ROOT, 'runs');

const now = new Date().toISOString();
const base = (id, extra) => ({
  run_id: id, fixture_id: 'f2-deploy-fail', created_at: now, updated_at: now,
  goal: '화면 확인용 상태. 실제 실행이 아니다.',
  trace: [
    { seq: 1, at: now, kind: 'started', label: '실행 시작',
      detail: '상한: 반복 20 · 도구 40 · 비용 $1 · 시간 600s · 같은도구연속 3' },
    { seq: 2, at: now, kind: 'tool_use', label: '도구 호출 — get_system_health',
      detail: '{\n  "run_id": "' + id + '",\n  "since": "2026-09-02",\n  "until": "2026-09-09"\n}' },
    { seq: 3, at: now, kind: 'tool_result', label: '도구 결과',
      detail: '{ "summary": { "total": 3, "ready": 2, "error": 1 }, "unavailable_fields": [] }' },
  ],
  pending_question: null, pending_approval: null, answered: [], decisions: [],
  usage: null, charts: [], live: false,
  ...extra,
});

function write(state) {
  const dir = join(RUNS, state.run_id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'ui-state.json'), JSON.stringify(state, null, 2));
  return dir;
}

// ① 질문 대기
write(base('demo-question', {
  status: 'waiting_for_user',
  pending_question: {
    question_id: 'q-1-demo', version: 1,
    questions: [{
      question: '이번 브리핑에서 어느 축을 깊게 볼까요?',
      header: '축 선택',
      options: [
        { label: '시스템', description: '배포 실패와 함수 오류를 중심으로 구성한다' },
        { label: '사용자', description: '가입·활성 사용자 추이를 중심으로 구성한다' },
        { label: '개발 활동', description: '쌓인 이슈와 멈춘 PR 을 중심으로 구성한다' },
      ],
    }],
  },
}));

// ② 승인 대기 (쓰기 도구)
write(base('demo-approval', {
  status: 'waiting_for_user',
  answered: [{ question_id: 'q-1-demo', version: 1,
    answers: { '이번 브리핑에서 어느 축을 깊게 볼까요?': '시스템' } }],
  pending_approval: {
    approval_id: 'a-1-demo', version: 1,
    tool: 'mcp__ops__create_github_issue',
    summary: {
      run_id: 'demo-approval',
      repo: 'hey-byeunya/already-got-it',
      title: '배포 실패: dpl_b2 — OwnedItem.used_up_at 타입 에러',
      body: '## 확인한 사실 (get_system_health → deployments[1])\n\n'
        + '- dpl_b2 (2026-09-05T18:05:00+09:00, commit 44cc55d) state: ERROR\n'
        + "- 빌드 에러: Type error: Property 'used_up_at' does not exist on type 'OwnedItem'."
        + ' app/items/[id]/page.tsx:42\n\n## 확인 못 함\n\n- 후속 커밋에서 고쳐졌는지 (diff 미확인)',
      labels: ['ops'],
      source: { tool: 'get_system_health', field: 'deployments[1]' },
    },
  },
}));

// ③ 중단 후 재개 — 서버 재시작으로 콜백이 사라진 상태
write(base('demo-interrupted', {
  status: 'waiting_for_user',   // 저장된 값. 화면에서는 live 가 아니라 interrupted 로 보인다
  session_id: '4b54ca9f-dcdd-4e28-b913-3327127b2a24',
  pending_question: {
    question_id: 'q-1-old', version: 1,
    questions: [{ question: '이 질문은 서버 재시작 전에 걸려 있었다', header: '중단',
      options: [{ label: 'A', description: '' }, { label: 'B', description: '' }] }],
  },
}));

// ④ 비용 확인 못 함 + 종료 조건 + 차트
const chartsFrom = join(RUNS, 'cap-approve', 'charts');
const done = base('demo-stopped', {
  status: 'stopped',
  session_id: 'a916023b-2db2-439d-8f89-f98b1aafeb53',
  stop_reason: { limit: 'maxToolCalls', message: '도구 호출 상한에 닿았다', observed: 3, allowed: 2 },
  usage: {
    usage_known: false, input_tokens: 6, output_tokens: 0,
    cache_read_input_tokens: 58094, cache_creation_input_tokens: 0,
    total_cost_usd: 0, cost_is_estimate: true,
    unknown_reason: '종료 조건(maxToolCalls)으로 중단해 결과 메시지를 받지 못했다',
  },
  decisions: [{ approval_id: 'a-0', tool: 'mcp__ops__create_github_issue',
    approved: false, reason: '화면에서 거절', at: now }],
});
const dir = write(done);
if (existsSync(chartsFrom)) {
  mkdirSync(join(dir, 'charts'), { recursive: true });
  const svgs = readdirSync(chartsFrom).filter((f) => f.endsWith('.svg'));
  for (const f of svgs) copyFileSync(join(chartsFrom, f), join(dir, 'charts', f));
  done.charts = svgs.sort().map((f) => ({ card_no: Number(f.replace('.svg', '')), svg_path: `charts/${f}` }));
  write(done);
}

console.log('심은 상태:');
for (const id of ['demo-question', 'demo-approval', 'demo-interrupted', 'demo-stopped']) {
  console.log(`  http://localhost:3010/runs/${id}`);
}
console.log('\n⚠️ 화면 확인용이며 실제 실행 기록이 아니다. 평가·증거로 쓰지 않는다.');
