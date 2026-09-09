/**
 * 검사: 종료 조건과 사용량 집계 (DECISIONS.md D7 · D15)
 *
 * 종료 조건은 **코드가** 검사한다. 모델의 "다 했다" 한 마디에 맡기지 않는다.
 * 사용량은 **모르는 것과 0 을 구별한다.** 0 으로 적으면 비용이 안 들었다고 거짓 보고하게 된다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LimitTracker, DEFAULT_LIMITS, limitsFromEnv } from '../src/limits.js';
import { UsageAccountant } from '../src/usage.js';

test('종료 조건', async (t) => {
  await t.test('도구 호출 상한에 닿으면 멈춘다', () => {
    const tr = new LimitTracker({ ...DEFAULT_LIMITS, maxToolCalls: 2 });
    tr.noteToolCall('a'); tr.noteToolCall('b');
    assert.equal(tr.check(0), null, '상한까지는 통과해야 한다');
    tr.noteToolCall('c');
    assert.equal(tr.check(0)?.limit, 'maxToolCalls');
  });

  await t.test('같은 도구를 연속 호출하면 진전 없음으로 멈춘다', () => {
    const tr = new LimitTracker({ ...DEFAULT_LIMITS, maxSameToolStreak: 2 });
    tr.noteToolCall('same'); tr.noteToolCall('same');
    assert.equal(tr.check(0), null);
    tr.noteToolCall('same');
    assert.equal(tr.check(0)?.limit, 'maxSameToolStreak');
  });

  await t.test('경계 — 다른 도구를 섞으면 연속 카운터가 초기화된다', () => {
    const tr = new LimitTracker({ ...DEFAULT_LIMITS, maxSameToolStreak: 2 });
    tr.noteToolCall('a'); tr.noteToolCall('a'); tr.noteToolCall('b'); tr.noteToolCall('a');
    assert.equal(tr.check(0), null, '번갈아 부르는 것은 진전이 있는 것이다');
  });

  await t.test('누적 입력 토큰 상한', () => {
    const tr = new LimitTracker({ ...DEFAULT_LIMITS, maxInputTokens: 100 });
    assert.equal(tr.check(100), null);
    assert.equal(tr.check(101)?.limit, 'maxInputTokens');
  });

  await t.test('대기 시간은 실행 시간에 넣지 않는다 — 사람을 기다리는 건 정상이다', async () => {
    const tr = new LimitTracker(DEFAULT_LIMITS);
    tr.beginWaiting();
    await new Promise((r) => setTimeout(r, 60));
    tr.endWaiting();
    assert.ok(tr.elapsedSeconds() < 0.05, `대기가 실행 시간에 들어갔다: ${tr.elapsedSeconds()}s`);
    assert.ok(tr.waitingSeconds >= 0.05, '대기 시간은 따로 세야 한다');
  });

  await t.test('환경변수로 상한을 낮출 수 있다 (종료 조건 캡처용)', () => {
    process.env.OPS_MAX_TOOL_CALLS = '3';
    try {
      assert.equal(limitsFromEnv().maxToolCalls, 3);
      assert.equal(limitsFromEnv().maxTurns, DEFAULT_LIMITS.maxTurns, '지정하지 않은 값은 기본값');
    } finally { delete process.env.OPS_MAX_TOOL_CALLS; }
  });
});

test('사용량 집계', async (t) => {
  const assistant = (id: string, usage: Record<string, number>, parent?: string) =>
    ({ type: 'assistant', parent_tool_use_id: parent ?? null, message: { id, usage } });

  await t.test('① 병렬 도구 호출은 메시지 id 가 같으니 한 번만 센다', () => {
    const a = new UsageAccountant();
    a.observeAssistant(assistant('m1', { input_tokens: 100 }));
    a.observeAssistant(assistant('m1', { input_tokens: 100 })); // 같은 응답의 다른 블록
    a.observeAssistant(assistant('m2', { input_tokens: 50 }));
    a.observeResult({ subtype: 'success', usage: { output_tokens: 7 } });
    assert.equal(a.snapshot().input_tokens, 150, '중복을 세면 240 이 된다');
  });

  await t.test('② 출력 토큰은 result 에서 읽는다 (per-step 은 placeholder)', () => {
    const a = new UsageAccountant();
    a.observeAssistant(assistant('m1', { input_tokens: 10, output_tokens: 999 })); // placeholder
    a.observeResult({ subtype: 'success', usage: { output_tokens: 42 } });
    assert.equal(a.snapshot().output_tokens, 42);
  });

  await t.test('③ 서브에이전트 메시지는 건너뛰고 전체는 modelUsage 로 센다', () => {
    const a = new UsageAccountant();
    a.observeAssistant(assistant('m1', { input_tokens: 10 }));
    a.observeAssistant(assistant('sub1', { input_tokens: 500 }, 'tool_use_1')); // 서브에이전트
    a.observeResult({ subtype: 'success',
      usage: { output_tokens: 5 },
      modelUsage: { 'claude-x': { costUSD: 0.5, outputTokens: 80 } } });
    const s = a.snapshot();
    assert.equal(s.input_tokens, 10, '서브에이전트 입력은 usage 집계에서 빠진다');
    assert.equal(s.output_tokens, 80, 'modelUsage 가 있으면 그쪽이 전체다');
    assert.equal(s.total_cost_usd, 0.5);
  });

  await t.test('④ 크래시 결과는 0 이 아니라 usage_known: false 다', () => {
    const a = new UsageAccountant();
    a.observeAssistant(assistant('m1', { input_tokens: 10 }));
    a.observeResult({ subtype: 'error_during_execution', total_cost_usd: 0, usage: {} });
    const s = a.snapshot();
    assert.equal(s.usage_known, false);
    assert.match(s.unknown_reason!, /크래시/);
  });

  await t.test('④ 예산 초과에서 비용을 못 읽으면 usage_known: false', () => {
    const a = new UsageAccountant();
    a.observeResult({ subtype: 'error_max_budget_usd', total_cost_usd: 0, usage: {} });
    assert.equal(a.snapshot().usage_known, false);
  });

  await t.test('결과 메시지를 아예 못 받으면 usage_known: false', () => {
    const a = new UsageAccountant();
    a.observeAssistant(assistant('m1', { input_tokens: 10 }));
    a.markNoResult('연결 실패');
    assert.equal(a.snapshot().usage_known, false);
  });

  // ── 경계 ────────────────────────────────────────────────────
  await t.test('경계 — 정상 결과는 usage_known: true 이고 비용을 그대로 쓴다', () => {
    const a = new UsageAccountant();
    a.observeAssistant(assistant('m1', { input_tokens: 100, cache_read_input_tokens: 20 }));
    a.observeResult({ subtype: 'success', total_cost_usd: 0.12, usage: { output_tokens: 30 } });
    const s = a.snapshot();
    assert.equal(s.usage_known, true);
    assert.equal(s.total_cost_usd, 0.12);
    assert.equal(s.cache_read_input_tokens, 20);
    assert.equal(s.cost_is_estimate, true, '항상 추정값임을 표시한다');
    assert.equal(s.unknown_reason, undefined);
  });

  await t.test('경계 — 예산 초과라도 비용을 읽었으면 known 이다', () => {
    const a = new UsageAccountant();
    a.observeResult({ subtype: 'error_max_budget_usd', total_cost_usd: 1.02, usage: {} });
    const s = a.snapshot();
    assert.equal(s.usage_known, true, '값이 있으면 모른다고 하지 않는다');
    assert.equal(s.total_cost_usd, 1.02);
  });
});
