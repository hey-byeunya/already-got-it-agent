/**
 * 종료 조건 (DECISIONS.md D7).
 *
 * SDK 가 검사하는 것 두 개(maxTurns · maxBudgetUsd)는 옵션으로 넘긴다.
 * 나머지 네 개는 여기서 내가 검사한다.
 *
 * 종료는 **코드가 검사**한다. 모델의 "다 했다" 한 마디에 맡기지 않는다.
 * waiting_for_user 로 보낸 시간은 실행 시간에 넣지 않는다 — 사람을 기다리는 건 정상이다.
 */
export type LimitConfig = {
  maxTurns: number;
  maxBudgetUsd: number;
  maxToolCalls: number;
  maxInputTokens: number;
  maxElapsedSeconds: number;
  maxSameToolStreak: number;
};

export const DEFAULT_LIMITS: LimitConfig = {
  maxTurns: 20,
  maxBudgetUsd: 1.0,
  maxToolCalls: 40,
  maxInputTokens: 200_000,
  maxElapsedSeconds: 600,
  maxSameToolStreak: 3,
};

export type StopReason = {
  limit: keyof LimitConfig;
  message: string;
  observed: number;
  allowed: number;
};

export class LimitTracker {
  private toolCalls = 0;
  private lastTool: string | null = null;
  private sameToolStreak = 0;
  private startedAt = Date.now();
  /** 사람을 기다린 누적 시간. 실행 시간에서 뺀다. */
  private waitingMs = 0;
  private waitStartedAt: number | null = null;

  constructor(private readonly limits: LimitConfig = DEFAULT_LIMITS) {}

  noteToolCall(toolName: string): void {
    this.toolCalls += 1;
    if (toolName === this.lastTool) this.sameToolStreak += 1;
    else { this.lastTool = toolName; this.sameToolStreak = 1; }
  }

  beginWaiting(): void {
    if (this.waitStartedAt === null) this.waitStartedAt = Date.now();
  }

  endWaiting(): void {
    if (this.waitStartedAt !== null) {
      this.waitingMs += Date.now() - this.waitStartedAt;
      this.waitStartedAt = null;
    }
  }

  /** 대기 시간을 제외한 실행 경과 초. */
  elapsedSeconds(): number {
    const pendingWait = this.waitStartedAt !== null ? Date.now() - this.waitStartedAt : 0;
    return (Date.now() - this.startedAt - this.waitingMs - pendingWait) / 1000;
  }

  get toolCallCount(): number { return this.toolCalls; }
  get waitingSeconds(): number { return this.waitingMs / 1000; }

  /** 하나라도 걸리면 이유를 돌려준다. 걸린 게 없으면 null. */
  check(accumulatedInputTokens: number): StopReason | null {
    if (this.toolCalls > this.limits.maxToolCalls) {
      return { limit: 'maxToolCalls', message: '도구 호출 상한에 닿았다',
        observed: this.toolCalls, allowed: this.limits.maxToolCalls };
    }
    if (this.sameToolStreak > this.limits.maxSameToolStreak) {
      return { limit: 'maxSameToolStreak', message: `같은 도구(${this.lastTool})를 연속 호출해 진전이 없다고 본다`,
        observed: this.sameToolStreak, allowed: this.limits.maxSameToolStreak };
    }
    if (accumulatedInputTokens > this.limits.maxInputTokens) {
      return { limit: 'maxInputTokens', message: '누적 입력 토큰 상한에 닿았다',
        observed: accumulatedInputTokens, allowed: this.limits.maxInputTokens };
    }
    const elapsed = this.elapsedSeconds();
    if (elapsed > this.limits.maxElapsedSeconds) {
      return { limit: 'maxElapsedSeconds', message: '실행 시간 상한에 닿았다 (대기 시간 제외)',
        observed: Math.round(elapsed), allowed: this.limits.maxElapsedSeconds };
    }
    return null;
  }
}

/** 환경변수로 상한을 낮춰 실제로 걸어 볼 수 있게 한다 (캡처용). */
export function limitsFromEnv(): LimitConfig {
  const num = (k: string, d: number) => {
    const v = process.env[k];
    return v === undefined || v === '' ? d : Number(v);
  };
  return {
    maxTurns: num('OPS_MAX_TURNS', DEFAULT_LIMITS.maxTurns),
    maxBudgetUsd: num('OPS_MAX_BUDGET_USD', DEFAULT_LIMITS.maxBudgetUsd),
    maxToolCalls: num('OPS_MAX_TOOL_CALLS', DEFAULT_LIMITS.maxToolCalls),
    maxInputTokens: num('OPS_MAX_INPUT_TOKENS', DEFAULT_LIMITS.maxInputTokens),
    maxElapsedSeconds: num('OPS_MAX_ELAPSED_SECONDS', DEFAULT_LIMITS.maxElapsedSeconds),
    maxSameToolStreak: num('OPS_MAX_SAME_TOOL_STREAK', DEFAULT_LIMITS.maxSameToolStreak),
  };
}
