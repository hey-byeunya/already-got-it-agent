/**
 * 검사: live 모드의 불변식 — **네트워크 없이** 확인할 수 있는 것만 본다.
 *
 * 실제 API 호출은 `npm run smoke-live` 로 따로 확인한다. 여기 섞으면
 * 검사 결과가 네트워크와 사람이 발급한 토큰에 따라 흔들린다.
 *
 * 각 항목은 실제로 관측한 문제 하나에 붙은 회귀 검사다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withTempRuns } from './helpers.js';
import * as runlog from '../src/runlog.js';
import { requireEnv, request, pageMayBeTruncated } from '../src/live/http.js';
import { systemHealth } from '../src/live/vercel.js';
import { toDate } from '../src/live/supabase.js';

/** OPS_MODE 를 바꿔 놓고 되돌린다. 앞선 검사로 새어 나가지 않게. */
function withMode<T>(mode: 'live' | 'fixture', fn: () => T): T {
  const prev = process.env.OPS_MODE;
  process.env.OPS_MODE = mode;
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.OPS_MODE; else process.env.OPS_MODE = prev;
  }
}

test('live 모드 불변식', async (t) => {

  t.test('live 모드에서 fixture_id 는 거절된다', () => {
    withTempRuns(() => withMode('live', () => {
      assert.throws(
        () => runlog.openRun('r-live', 'f1-normal'),
        (e: any) => e.code === 'fixture_in_live_mode',
      );
    }));
  });

  // 관측한 문제: 모드 검사가 "실행을 새로 여는" 분기에만 있어서, 첫 호출로 실행이
  // 열린 뒤에는 fixture_id 를 넘겨도 조용히 통과했다 (live 스모크 10번이 잡았다).
  t.test('이미 열린 live 실행에도 검사가 돈다 — 열린 뒤에 섞어 넣지 못한다', () => {
    withTempRuns(() => withMode('live', () => {
      const meta = runlog.openRun('r-live2');           // 먼저 실행을 연다
      assert.equal(meta.mode, 'live');
      assert.equal(meta.fixture_id, null);
      assert.throws(
        () => runlog.openRun('r-live2', 'f1-normal'),   // 그 뒤에 픽스처를 밀어넣는다
        (e: any) => e.code === 'fixture_in_live_mode',
      );
    }));
  });

  t.test('경계 — fixture 모드에서는 fixture_id 가 정상이다', () => {
    withTempRuns(() => withMode('fixture', () => {
      const meta = runlog.openRun('r-fx', 'f1-normal');
      assert.equal(meta.mode, 'fixture');
      assert.equal(meta.fixture_id, 'f1-normal');
    }));
  });

  t.test('live 실행 기록에 mode=live 가 남는다 — 사후에 어느 데이터였는지 알 수 있다', () => {
    withTempRuns(() => withMode('live', () => {
      assert.equal(runlog.openRun('r-live3').mode, 'live');
    }));
  });
});

test('자격증명 확인', async (t) => {

  t.test('없는 변수는 이름으로 알린다', () => {
    const prev = process.env.OPS_TEST_ABSENT_KEY;
    delete process.env.OPS_TEST_ABSENT_KEY;
    try {
      assert.throws(
        () => requireEnv('어떤도구', ['OPS_TEST_ABSENT_KEY']),
        (e: any) => e.code === 'credentials_missing'
          && (e.extra.missing as string[]).includes('OPS_TEST_ABSENT_KEY'),
      );
    } finally {
      if (prev !== undefined) process.env.OPS_TEST_ABSENT_KEY = prev;
    }
  });

  // 이 검사가 핵심이다 — 오류 payload 는 실행 기록에 그대로 저장된다.
  // 값이 한 글자라도 섞이면 토큰이 파일로 남는다.
  t.test('오류에 토큰 **값**이 담기지 않는다', () => {
    process.env.OPS_TEST_SECRET_KEY = 'sk-매우비밀-9f3a2b';
    try {
      let payload = '';
      try { requireEnv('어떤도구', ['OPS_TEST_SECRET_KEY', 'OPS_TEST_ABSENT_KEY2']); }
      catch (e: any) { payload = JSON.stringify(e.asResult()); }
      assert.ok(payload.includes('OPS_TEST_ABSENT_KEY2'), '없는 변수 이름은 있어야 한다');
      assert.ok(!payload.includes('sk-매우비밀'), '설정된 변수의 값이 새어 나갔다');
      assert.ok(!payload.includes('9f3a2b'), '설정된 변수의 값이 새어 나갔다');
    } finally {
      delete process.env.OPS_TEST_SECRET_KEY;
    }
  });

  t.test('전부 있으면 값을 돌려준다', () => {
    process.env.OPS_TEST_PRESENT = '있음';
    try {
      assert.deepEqual(requireEnv('어떤도구', ['OPS_TEST_PRESENT']), { OPS_TEST_PRESENT: '있음' });
    } finally { delete process.env.OPS_TEST_PRESENT; }
  });

  t.test('빈 문자열은 없는 것으로 본다 — .env.local 에 이름만 적힌 경우', () => {
    process.env.OPS_TEST_BLANK = '   ';
    try {
      assert.throws(
        () => requireEnv('어떤도구', ['OPS_TEST_BLANK']),
        (e: any) => e.code === 'credentials_missing',
      );
    } finally { delete process.env.OPS_TEST_BLANK; }
  });
});

test('입력 검증 — 네트워크에 닿기 전에 거절한다', async (t) => {

  // 관측한 문제: get_user_metrics 는 invalid_period(Fatal)인데
  // get_system_health 는 일반 Error → unexpected_error 로 떨어졌다.
  t.test('날짜가 아닌 period 는 invalid_period 로 거절된다', async () => {    const saved = { token: process.env.VERCEL_API_TOKEN, project: process.env.VERCEL_PROJECT_ID };
    process.env.VERCEL_API_TOKEN = 'dummy';
    process.env.VERCEL_PROJECT_ID = 'dummy';
    try {
      await assert.rejects(
        () => systemHealth({ since: 'not-a-date', until: 'also-not-a-date' }),
        (e: any) => e.code === 'invalid_period' && e.name === 'FatalToolError',
      );
    } finally {
      if (saved.token === undefined) delete process.env.VERCEL_API_TOKEN;
      else process.env.VERCEL_API_TOKEN = saved.token;
      if (saved.project === undefined) delete process.env.VERCEL_PROJECT_ID;
      else process.env.VERCEL_PROJECT_ID = saved.project;
    }
  });

  // 관측한 문제: TIMEOUT·RETRIES 를 모듈 로드 때 읽어서, 검사에서 값을 바꿔도
  // 앞선 검사의 상태가 뒤로 새어 나갔다 (config.ts 가 같은 이유로 getter 로 읽는다).
  t.test('재시도 횟수는 호출 시점에 읽는다 — 닫힌 포트로 1회·3회 시도를 확인한다', async () => {    const saved = process.env.OPS_HTTP_RETRIES;
    const url = 'http://127.0.0.1:1/닫힌포트';
    try {
      process.env.OPS_HTTP_RETRIES = '0';
      await assert.rejects(
        () => request({ source: '검사', url }),
        (e: any) => e.code === 'network_error' && /1회 시도/.test(e.message),
      );
      process.env.OPS_HTTP_RETRIES = '2';
      await assert.rejects(
        () => request({ source: '검사', url }),
        (e: any) => e.code === 'network_error' && /3회 시도/.test(e.message),
      );
    } finally {
      if (saved === undefined) delete process.env.OPS_HTTP_RETRIES;
      else process.env.OPS_HTTP_RETRIES = saved;
    }
  });

  // 관측한 문제: HTML 에러 페이지가 {raw} 로 파싱돼 빈 목록으로 둔갑하면
  // "배포 0건" 같은 거짓 사실이 카드에 올라간다 (결측-0 구별 위반).
  t.test('형태가 어긋난 정상 응답은 빈 값으로 뭉개지 않고 오류로 올린다', async () => {
    await assert.rejects(
      () => request({
        source: '검사',
        url: 'data:application/json,%3Chtml%3E%EC%97%90%EB%9F%AC%3C%2Fhtml%3E',
        validate: Array.isArray,
      }),
      (e: any) => e.code === 'upstream_error',
    );
    // validate 를 선언하지 않으면 그대로 돌려준다 — 검사는 호출자가 선언한 경우에만 돈다.
    const raw = await request({ source: '검사', url: 'data:application/json,%7B%22a%22%3A1%7D' });
    assert.deepEqual(raw, { a: 1 });
  });

  t.test('상한과 같은 길이가 잘림의 신호다 (>, >= 경계)', () => {
    assert.equal(pageMayBeTruncated(99, 100), false);
    assert.equal(pageMayBeTruncated(100, 100), true);
    assert.equal(pageMayBeTruncated(101, 100), true);
  });

  // 관측한 문제: "2026-13-99" 가 정규식을 통과해 RPC 까지 갔다. 달력 대조를 둔다.
  t.test('달력에 없는 날짜는 invalid_period 로 거절된다', () => {
    assert.equal(toDate('2026-09-02T00:00:00+09:00', 'since'), '2026-09-02');
    assert.equal(toDate('2026-09-09', 'until'), '2026-09-09');
    assert.throws(
      () => toDate('2026-13-99', 'since'),
      (e: any) => e.code === 'invalid_period',
    );
    assert.throws(
      () => toDate('2026-02-30', 'since'),
      (e: any) => e.code === 'invalid_period',
    );
  });
});
