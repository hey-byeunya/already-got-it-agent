export class UsageAccountant {
    /** ① 이미 센 assistant 메시지 id. 병렬 도구 호출은 같은 id 를 공유한다. */
    seenMessageIds = new Set();
    inputTokens = 0;
    cacheRead = 0;
    cacheCreate = 0;
    resultOutputTokens = 0;
    costUsd = 0;
    known = true;
    unknownReason;
    /** assistant 메시지에서 입력·캐시 토큰을 누적한다. 출력 토큰은 여기서 세지 않는다(②). */
    observeAssistant(msg) {
        const m = msg;
        // ③ 서브에이전트 메시지는 건너뛴다. 전체 합계는 modelUsage 에서 읽는다.
        if (m.parent_tool_use_id)
            return;
        const id = m.message?.id;
        const usage = m.message?.usage;
        if (!id || !usage)
            return;
        if (this.seenMessageIds.has(id))
            return; // ① 중복 제거
        this.seenMessageIds.add(id);
        this.inputTokens += usage.input_tokens ?? 0;
        this.cacheRead += usage.cache_read_input_tokens ?? 0;
        this.cacheCreate += usage.cache_creation_input_tokens ?? 0;
    }
    /** result 메시지에서 출력 토큰과 비용을 읽는다. */
    observeResult(msg) {
        const m = msg;
        // ③ modelUsage 가 있으면 그쪽이 서브에이전트까지 포함한 전체다.
        const models = m.modelUsage ? Object.values(m.modelUsage) : [];
        const costFromModels = models.reduce((s, u) => s + (u.costUSD ?? 0), 0);
        const outFromModels = models.reduce((s, u) => s + (u.outputTokens ?? 0), 0);
        this.resultOutputTokens = outFromModels || m.usage?.output_tokens || 0;
        this.costUsd = costFromModels || m.total_cost_usd || 0;
        // ④ 비용 필드를 신뢰할 수 없는 경우를 표시한다.
        if (m.subtype === 'error_during_execution') {
            // 크래시 결과는 모든 비용 필드가 0 일 수 있다.
            if (this.costUsd === 0) {
                this.known = false;
                this.unknownReason = '세션이 크래시로 끝나 비용 필드가 비었다 (error_during_execution)';
            }
        }
        else if (m.subtype === 'error_max_budget_usd') {
            // usage 는 예산을 넘긴 마지막 응답을 빼고 보고한다. cost 쪽이 더 정확하다.
            if (this.costUsd === 0) {
                this.known = false;
                this.unknownReason = '예산 초과로 끝났고 비용 필드를 읽지 못했다 (error_max_budget_usd)';
            }
        }
    }
    /** 결과 메시지를 아예 받지 못한 경우 (연결·프로세스 실패). */
    markNoResult(reason) {
        this.known = false;
        this.unknownReason = reason;
    }
    snapshot() {
        return {
            usage_known: this.known,
            input_tokens: this.inputTokens,
            output_tokens: this.resultOutputTokens,
            cache_read_input_tokens: this.cacheRead,
            cache_creation_input_tokens: this.cacheCreate,
            total_cost_usd: this.costUsd,
            cost_is_estimate: true,
            ...(this.known ? {} : { unknown_reason: this.unknownReason }),
        };
    }
    /** 내가 검사하는 종료 조건용. 누적 입력 토큰. */
    get accumulatedInputTokens() {
        return this.inputTokens + this.cacheRead + this.cacheCreate;
    }
}
//# sourceMappingURL=usage.js.map