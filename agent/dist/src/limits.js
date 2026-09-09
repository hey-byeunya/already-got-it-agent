export const DEFAULT_LIMITS = {
    maxTurns: 20,
    maxBudgetUsd: 1.0,
    maxToolCalls: 40,
    maxInputTokens: 200_000,
    maxElapsedSeconds: 600,
    maxSameToolStreak: 3,
};
export class LimitTracker {
    limits;
    toolCalls = 0;
    /** 도구 이름 + 인자를 합친 지문. 인자가 다르면 다른 호출로 본다. */
    lastCallFingerprint = null;
    lastTool = null;
    sameToolStreak = 0;
    startedAt = Date.now();
    /** 사람을 기다린 누적 시간. 실행 시간에서 뺀다. */
    waitingMs = 0;
    waitStartedAt = null;
    constructor(limits = DEFAULT_LIMITS) {
        this.limits = limits;
    }
    /**
     * 도구 호출을 센다.
     *
     * 연속 카운터는 **같은 도구를 같은 인자로** 부를 때만 올라간다.
     * 인자가 다르면 진전이 있는 것이다 — 검색어를 바꿔 가며 web_search 를 네 번 부르는 것은
     * 막힌 게 아니라 일하는 중이다. (첫 실제 실행에서 이걸 막아 버렸다.)
     */
    noteToolCall(toolName, input) {
        this.toolCalls += 1;
        const fingerprint = `${toolName}::${stableStringify(input)}`;
        if (fingerprint === this.lastCallFingerprint) {
            this.sameToolStreak += 1;
        }
        else {
            this.lastCallFingerprint = fingerprint;
            this.sameToolStreak = 1;
        }
        this.lastTool = toolName;
    }
    beginWaiting() {
        if (this.waitStartedAt === null)
            this.waitStartedAt = Date.now();
    }
    endWaiting() {
        if (this.waitStartedAt !== null) {
            this.waitingMs += Date.now() - this.waitStartedAt;
            this.waitStartedAt = null;
        }
    }
    /** 대기 시간을 제외한 실행 경과 초. */
    elapsedSeconds() {
        const pendingWait = this.waitStartedAt !== null ? Date.now() - this.waitStartedAt : 0;
        return (Date.now() - this.startedAt - this.waitingMs - pendingWait) / 1000;
    }
    get toolCallCount() { return this.toolCalls; }
    get waitingSeconds() { return this.waitingMs / 1000; }
    /** 하나라도 걸리면 이유를 돌려준다. 걸린 게 없으면 null. */
    /** @param freshInputTokens 캐시 읽기를 제외한 누적 신규 입력 토큰 */
    check(freshInputTokens) {
        if (this.toolCalls > this.limits.maxToolCalls) {
            return { limit: 'maxToolCalls', message: '도구 호출 상한에 닿았다',
                observed: this.toolCalls, allowed: this.limits.maxToolCalls };
        }
        if (this.sameToolStreak > this.limits.maxSameToolStreak) {
            return { limit: 'maxSameToolStreak',
                message: `같은 도구(${this.lastTool})를 **같은 인자로** 연속 호출해 진전이 없다고 본다`,
                observed: this.sameToolStreak, allowed: this.limits.maxSameToolStreak };
        }
        if (freshInputTokens > this.limits.maxInputTokens) {
            return { limit: 'maxInputTokens', message: '누적 신규 입력 토큰 상한에 닿았다 (캐시 읽기 제외)',
                observed: freshInputTokens, allowed: this.limits.maxInputTokens };
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
export function limitsFromEnv() {
    const num = (k, d) => {
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
/** 키 순서가 달라도 같은 지문이 나오게 한다. */
function stableStringify(v) {
    if (v === null || typeof v !== 'object')
        return JSON.stringify(v) ?? 'undefined';
    if (Array.isArray(v))
        return `[${v.map(stableStringify).join(',')}]`;
    const entries = Object.entries(v).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, val]) => `${JSON.stringify(k)}:${stableStringify(val)}`).join(',')}}`;
}
//# sourceMappingURL=limits.js.map