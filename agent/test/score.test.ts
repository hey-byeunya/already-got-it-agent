/**
 * 검사: 자동 채점기 (EVAL.md)
 *
 * 채점기에 버그가 있으면 숫자가 무의미해진다. 특히 **과탐지**가 위험하다 —
 * 정상 서술을 환각으로 세면 지표가 쓸모없어지고, 그걸 근거로 개선을 주장하게 된다.
 * 그래서 "잡아야 할 것"마다 "잡으면 안 되는 것"을 짝지었다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  findHallucinations, findMissingMisreads, checkMustInclude, resolveNumbers, collectIdentifiers, score,
  type Fixture,
} from '../src/eval/score.js';

const FX_DIR = resolve(import.meta.dirname, '../../../fixtures/snapshots');
const load = (id: string): Fixture => JSON.parse(readFileSync(resolve(FX_DIR, `${id}.json`), 'utf8')) as Fixture;

const f2 = load('f2-deploy-fail');
const f4 = load('f4-sparse');

test('채점기 — 경로 해석과 식별자 수집', async (t) => {
  await t.test('a.b[].c 경로에서 숫자를 모은다', () => {
    assert.deepEqual(resolveNumbers(f2, 'get_system_health.summary.total'), [3]);
    assert.deepEqual(resolveNumbers(f2, 'get_user_metrics.series[].signups'), [3, 2, 3, 1, 3, 2, 3]);
    assert.deepEqual(resolveNumbers(f2, 'get_user_metrics.없는필드'), []);
  });

  await t.test('배포 ID · 커밋 SHA · 이슈 번호를 모은다', () => {
    const ids = collectIdentifiers(f2);
    assert.ok(ids.deploys.has('dpl_b2'));
    assert.ok(ids.shas.has('44cc55d'));
    assert.deepEqual([...ids.issues].sort(), [11, 13]);
  });
});

test('채점기 — 환각 탐지', async (t) => {
  await t.test('없는 배포 ID 를 잡는다', () => {
    // 실제 환각은 형태가 그럴듯하다 — 픽스처에 없는 dpl_c9 같은 값
    const h = [...findHallucinations('배포 `dpl_c9` 가 실패했다', f2).identifiers, ...findHallucinations('배포 `dpl_c9` 가 실패했다', f2).metricCandidates];
    assert.equal(h.filter((x) => x.kind === 'deploy_id').length, 1);
    assert.equal(h[0]!.value, 'dpl_c9');
  });

  await t.test('형태가 이상한 배포 ID 도 놓치지 않는다', () => {
    // 처음에는 ASCII 만 보는 정규식이라 이런 값을 조용히 놓쳤다
    const h = [...findHallucinations('배포 dpl_없는것 이 실패했다', f2).identifiers, ...findHallucinations('배포 dpl_없는것 이 실패했다', f2).metricCandidates];
    assert.equal(h.filter((x) => x.kind === 'deploy_id').length, 1);
  });

  await t.test('없는 이슈 번호를 잡는다', () => {
    const h = [...findHallucinations('이슈 #999 가 열려 있다', f2).identifiers, ...findHallucinations('이슈 #999 가 열려 있다', f2).metricCandidates];
    assert.equal(h.find((x) => x.kind === 'issue_number')?.value, '999');
  });

  await t.test('지표 낱말 옆의 틀린 숫자를 잡는다', () => {
    const h = [...findHallucinations('이번 주 가입 500명', f2).identifiers, ...findHallucinations('이번 주 가입 500명', f2).metricCandidates];
    const m = h.find((x) => x.kind === 'metric_value');
    assert.equal(m?.metric, '가입');
    assert.equal(m?.value, '500');
  });

  // ── 경계: 잡으면 안 되는 것 ─────────────────────────────────
  await t.test('경계 — 실제 값은 잡지 않는다', () => {
    const text = '배포 3건 중 1건 실패 (`dpl_b2`, commit `44cc55d`). 이슈 #11 과 #13 이 열려 있다.'
      + ' 가입 17명, 활성 사용자 41명, 함수 오류 47건.';
    const r0 = findHallucinations(text, f2);
    assert.deepEqual([...r0.identifiers, ...r0.metricCandidates], []);
  });

  await t.test('경계 — 파생 숫자(경과 분·백분율·날짜)를 환각으로 세지 않는다', () => {
    // 지표 낱말과 무관한 숫자는 대조 대상이 아니다
    const text = '09-05 18:05 에 실패했고 75분 뒤 복구됐다. 성공률 66.7%. 카드 5장으로 구성한다.';
    const r0 = findHallucinations(text, f2);
    assert.deepEqual([...r0.identifiers, ...r0.metricCandidates], []);
  });

  await t.test('경계 — 승인해 만든 이슈 번호는 허용한다', () => {
    const h = [...findHallucinations('이슈 #9001 을 만들었다', f2, { allowIssues: [9001] }).identifiers, ...findHallucinations('이슈 #9001 을 만들었다', f2, { allowIssues: [9001] }).metricCandidates];
    assert.deepEqual(h, []);
  });

  await t.test('경계 — #번호를 식별자와 지표로 두 번 세지 않는다', () => {
    // 처음에는 ③(식별자)과 ④(지표 낱말)가 같은 #999 를 각각 세어
    // 한 번의 잘못이 두 건으로 잡혔다
    const h = [...findHallucinations('이슈 #999 가 열려 있다', f2).identifiers, ...findHallucinations('이슈 #999 가 열려 있다', f2).metricCandidates];
    assert.equal(h.length, 1, `두 번 세면 안 된다: ${JSON.stringify(h)}`);
    assert.equal(h[0]!.kind, 'issue_number');
  });

  await t.test('경계 — 픽스처에 없는 지표는 대조하지 않는다', () => {
    // f4-sparse 에는 개발 활동이 실패로 들어 있어 이슈 값이 없다 → 이슈 숫자를 대조하지 않는다
    const h = [...findHallucinations('커밋 12건', f4).identifiers, ...findHallucinations('커밋 12건', f4).metricCandidates];
    assert.equal(h.filter((x) => x.metric === '커밋').length, 0);
  });
});

test('채점기 — 결측 오독 탐지', async (t) => {
  await t.test('결측을 0 으로 서술하면 후보로 잡는다', () => {
    const { candidates } = findMissingMisreads('함수 오류 0건으로 문제 없었다.', f4);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]!.field, 'function_errors.count');
  });

  await t.test('경계 — 부정문 안의 "없" 을 오독으로 세지 않는다 (첫 시행에서 나온 경우)', () => {
    // 모델이 실제로 쓴 문장. 규칙이 "문제 없"만 보고 올바른 서술에 벌점을 줬다.
    const real = '함수 오류를 못 봤으므로 "이번 주 문제 없다"고 말할 수 없다.';
    const { candidates, cleared } = findMissingMisreads(real, f4);
    assert.deepEqual(candidates, [], `후보로 잡히면 안 된다: ${JSON.stringify(candidates)}`);
    assert.equal(cleared.length, 1, '규칙에 걸렸지만 올바른 서술로 판정한 기록이 남아야 한다');
    assert.equal(cleared[0]!.marker, '못');
  });

  await t.test('경계 — 문장을 넘어간 부정은 끌어오지 않는다', () => {
    // 앞 문장이 오독이면, 뒤 문장의 "못" 이 그것을 지워 주지 않아야 한다
    const text = '함수 오류 0건이었다. 다른 문제는 못 찾았다.';
    const { candidates } = findMissingMisreads(text, f4);
    assert.equal(candidates.length, 1, '앞 문장의 오독은 그대로 잡혀야 한다');
  });

  await t.test('비교값이 없는데 증감을 말하면 후보로 잡는다', () => {
    const { candidates } = findMissingMisreads('전주 대비 가입이 증가했다.', f4);
    assert.ok(candidates.some((e) => e.field === 'previous_period_totals'));
  });

  // ── 경계 ────────────────────────────────────────────────────
  await t.test('경계 — 결측을 결측으로 밝히면 잡지 않는다', () => {
    const text = '함수 오류 수는 조회하지 못했다 (available: false). 전주 비교값이 없어 증감을 말할 수 없다.';
    const { candidates } = findMissingMisreads(text, f4);
    assert.deepEqual(candidates, []);
  });

  await t.test('경계 — 결측이 없는 픽스처에서는 아무것도 잡지 않는다', () => {
    const { candidates } = findMissingMisreads('함수 오류 47건이었다. 전주 대비 소폭 감소.', f2);
    assert.deepEqual(candidates, []);
  });

  await t.test('규칙이 없는 결측 필드는 미확인으로 남긴다 (통과로 세지 않는다)', () => {
    const { unchecked } = findMissingMisreads('아무 말', f4);
    assert.ok(unchecked.some((f) => f.includes('series')), `미확인 목록: ${unchecked.join(', ')}`);
  });
});

test('채점기 — 필수 신호 토큰 대리 지표', async (t) => {
  await t.test('정답의 식별자·숫자가 원고에 있으면 충족으로 본다', () => {
    const rs = checkMustInclude('dpl_b2 가 실패했고 used_up_at 타입 오류다. app/items/[id]/page.tsx:42', f2);
    const target = rs.find((r) => r.item.includes('dpl_b2'));
    assert.ok(target);
    assert.ok(target!.found.includes('dpl_b2'));
  });

  await t.test('토큰이 없는 정답은 자동 판정에서 뺀다', () => {
    const fake: Fixture = { id: 'x', expected: { must_include: ['숫자가 없는 서술적 정답'] } };
    const rs = checkMustInclude('아무 말', fake);
    assert.deepEqual(rs[0]!.tokens, []);
    assert.equal(rs[0]!.ok, false);
    const s = score('아무 말', fake);
    assert.equal(s.must_include_auto_judgeable, 0, '판정 불가는 분모에서 뺀다');
  });
});

test('채점기 — 수동 항목을 자동으로 재지 않는다', () => {
  const s = score('아무 말', f2);
  assert.deepEqual(s.manual, ['근거 미표기율', '과잉 단정률', '우선순위 적중', '결측 오독 후보 확인', '지표 값 환각 후보 확인']);
});

/**
 * 검사: 첫 평가 시행에서 나온 과탐지 두 개 (관측된 실패 하나당 검사 하나)
 *
 * f1-normal(정상 주간) 한 시행에서 환각 4건이 잡혔는데 **네 건 모두 허수**였다.
 * 채점기가 정상 서술에 벌점을 주면 그 숫자로 개선을 주장할 수 없다.
 */
test('채점기 — 첫 평가에서 나온 과탐지', async (t) => {
  await t.test('경계 — "이슈" 낱말이 없는 #N 은 이슈 번호로 세지 않는다', () => {
    // 실제로 잡혔던 것: 카드 번호·목록 표시로 쓰인 #1 #3 #5
    const text = '### #1 지금 손봐야 할 것\n#3 지켜볼 것\n#5 알아둘 것';
    const h = [...findHallucinations(text, f2).identifiers, ...findHallucinations(text, f2).metricCandidates];
    assert.deepEqual(h.filter((x) => x.kind === 'issue_number'), []);
  });

  await t.test('"이슈 #999" 처럼 낱말이 앞에 있으면 여전히 잡는다', () => {
    const h = [...findHallucinations('이슈 #999 가 열려 있다', f2).identifiers, ...findHallucinations('이슈 #999 가 열려 있다', f2).metricCandidates];
    assert.equal(h.filter((x) => x.kind === 'issue_number').length, 1);
  });

  await t.test('경계 — "이슈 생성 제안 1건" 을 지표 환각으로 세지 않는다', () => {
    // 실제로 잡혔던 것: '이슈' 낱말이 너무 넓어 정당한 개수 서술이 걸렸다
    const h = [...findHallucinations('이슈 생성 제안 1건을 남겼다', f2).identifiers, ...findHallucinations('이슈 생성 제안 1건을 남겼다', f2).metricCandidates];
    assert.deepEqual(h.filter((x) => x.kind === 'metric_value'), []);
  });

  await t.test('열린 이슈 수를 틀리게 말하면 잡는다', () => {
    // f2 의 open_issue_count 는 2
    const h = [...findHallucinations('열린 이슈 7건이 쌓여 있다', f2).identifiers, ...findHallucinations('열린 이슈 7건이 쌓여 있다', f2).metricCandidates];
    const m = h.find((x) => x.kind === 'metric_value');
    assert.equal(m?.metric, '열린 이슈 수');
    assert.equal(m?.value, '7');
  });

  await t.test('경계 — 실제 열린 이슈 수는 잡지 않는다', () => {
    const h = [...findHallucinations('열린 이슈 2건이다', f2).identifiers, ...findHallucinations('열린 이슈 2건이다', f2).metricCandidates];
    assert.deepEqual(h.filter((x) => x.kind === 'metric_value'), []);
  });
});

/**
 * 검사: 날짜·기간 숫자를 지표 값으로 세지 않는다 (두 번째 평가 시행에서 나온 과탐지)
 *
 * "낱말 뒤 첫 숫자" 규칙이 날짜와 기간을 집어왔다. 개수 단위(건·명·회·개)를 요구해 좁혔고,
 * 그 대가로 단위 없이 쓴 수치는 놓친다 — **과소 보고 쪽으로 기운다.**
 */
test('채점기 — 날짜·기간 숫자 배제', async (t) => {
  await t.test('경계 — "함수 오류 7일 3건" 에서 7 을 건수로 세지 않는다', () => {
    // f1-normal 의 function_errors.count 는 3
    const f1 = load('f1-normal');
    const h = [...findHallucinations('차트: 함수 오류 7일 3건, source: get_system_health', f1).identifiers, ...findHallucinations('차트: 함수 오류 7일 3건, source: get_system_health', f1).metricCandidates];
    assert.deepEqual(h.filter((x) => x.kind === 'metric_value'), [],
      `허수가 잡혔다: ${JSON.stringify(h)}`);
  });

  await t.test('경계 — 날짜가 뒤따라도 잡지 않는다', () => {
    const f1 = load('f1-normal');
    const h = [...findHallucinations('활성 사용자, 9월 2일부터 집계', f1).identifiers, ...findHallucinations('활성 사용자, 9월 2일부터 집계', f1).metricCandidates];
    assert.deepEqual(h.filter((x) => x.kind === 'metric_value'), []);
  });

  await t.test('경계 — "5일째 미해결입니다. 9월" 을 경과일 환각으로 세지 않는다', () => {
    const h = [...findHallucinations('#11 은 5일째 미해결입니다. 9월 현재.', f2).identifiers, ...findHallucinations('#11 은 5일째 미해결입니다. 9월 현재.', f2).metricCandidates];
    assert.deepEqual(h.filter((x) => x.kind === 'metric_value'), []);
  });

  await t.test('단위가 붙은 틀린 값은 여전히 잡는다', () => {
    const f1 = load('f1-normal');
    const h = [...findHallucinations('함수 오류 99건이 발생했다', f1).identifiers, ...findHallucinations('함수 오류 99건이 발생했다', f1).metricCandidates];
    const m = h.find((x) => x.kind === 'metric_value');
    assert.equal(m?.metric, '함수 오류');
    assert.equal(m?.value, '99');
  });

  await t.test('경계 — 단위가 붙은 실제 값은 잡지 않는다', () => {
    const f1 = load('f1-normal');
    const h = [...findHallucinations('함수 오류 3건. 가입 19명. 열린 이슈 2건.', f1).identifiers, ...findHallucinations('함수 오류 3건. 가입 19명. 열린 이슈 2건.', f1).metricCandidates];
    assert.deepEqual(h.filter((x) => x.kind === 'metric_value'), []);
  });

  await t.test('경계 — 창이 다음 지표의 숫자를 끌어오지 않는다', () => {
    // "함수 오류 3건. 가입 19명" 에서 19 를 함수 오류 값으로 보면 안 된다
    const f1 = load('f1-normal');
    const h = [...findHallucinations('함수 오류 3건. 가입 19명', f1).identifiers, ...findHallucinations('함수 오류 3건. 가입 19명', f1).metricCandidates];
    assert.deepEqual(h.filter((x) => x.metric === '함수 오류'), []);
  });

  await t.test('경계 — 여러 지표를 한 줄에 써도 각각 맞게 본다', () => {
    const h = [...findHallucinations('가입 17명, 활성 사용자 41명, 열린 이슈 2건', f2).identifiers, ...findHallucinations('가입 17명, 활성 사용자 41명, 열린 이슈 2건', f2).metricCandidates];
    assert.deepEqual(h.filter((x) => x.kind === 'metric_value'), []);
  });

  await t.test('알려 둔 한계 — 단위 없이 쓴 수치는 놓친다 (과소 보고)', () => {
    const f1 = load('f1-normal');
    // 999 는 틀린 값이지만 단위가 없어 잡히지 않는다. 의도한 절충이다.
    const h = [...findHallucinations('가입 999', f1).identifiers, ...findHallucinations('가입 999', f1).metricCandidates];
    assert.deepEqual(h.filter((x) => x.kind === 'metric_value'), [],
      '이 한계를 검사로 못 박아 둔다 — 나중에 규칙을 넓힐 때 근거가 된다');
  });
});

/**
 * 검사: 창이 문장을 넘어가지 않는다 (본 평가 시행에서 나온 과탐지)
 *
 * "가장 가까운 개수 하나"로 좁혀도 창이 문장을 넘어가면 다음 지표의 숫자를 집어온다.
 * 두 사례 모두 f1-normal 실제 시행에서 나왔고, 둘 다 허수였다.
 */
test('채점기 — 문장 경계에서 창을 자른다', async (t) => {
  const f1 = load('f1-normal');

  await t.test('경계 — "배포·빌드는 정상. 함수 오류 3건" 에서 3 을 배포 수로 세지 않는다', () => {
    const h = [...findHallucinations('배포·빌드는 정상. 함수 오류 3건.', f1).identifiers, ...findHallucinations('배포·빌드는 정상. 함수 오류 3건.', f1).metricCandidates];
    assert.deepEqual(h.filter((x) => x.metric === '배포'), [],
      `허수가 잡혔다: ${JSON.stringify(h)}`);
  });

  await t.test('경계 — "…일째, bug). 커밋 14건" 에서 14 를 이슈 경과일로 세지 않는다', () => {
    const h = [...findHallucinations('#11 은 5일째, bug). 커밋 14건.', f1).identifiers, ...findHallucinations('#11 은 5일째, bug). 커밋 14건.', f1).metricCandidates];
    assert.deepEqual(h.filter((x) => x.metric === '이슈 경과일'), []);
  });

  await t.test('경계 — 같은 문장 안의 값은 여전히 본다', () => {
    // f1 의 function_errors.count 는 3 → 통과해야 한다
    const ok = [...findHallucinations('함수 오류 3건이었다.', f1).identifiers, ...findHallucinations('함수 오류 3건이었다.', f1).metricCandidates];
    assert.deepEqual(ok.filter((x) => x.kind === 'metric_value'), []);
    // 99 는 틀린 값 → 잡혀야 한다
    const bad = [...findHallucinations('함수 오류 99건이었다.', f1).identifiers, ...findHallucinations('함수 오류 99건이었다.', f1).metricCandidates];
    assert.equal(bad.filter((x) => x.metric === '함수 오류').length, 1);
  });

  await t.test('경계 — 쉼표는 문장 경계가 아니다 (한 줄에 여러 지표)', () => {
    const h = [...findHallucinations('가입 19명, 활성 사용자 44명', f1).identifiers, ...findHallucinations('가입 19명, 활성 사용자 44명', f1).metricCandidates];
    assert.deepEqual(h.filter((x) => x.kind === 'metric_value'), []);
  });
});
