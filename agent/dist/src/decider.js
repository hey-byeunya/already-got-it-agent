import { shortName } from './tools.js';
export class ScriptedDecider {
    opts;
    constructor(opts = {}) {
        this.opts = opts;
    }
    log(s) { this.opts.onLog?.(s); }
    async answerQuestions(questions) {
        const map = this.opts.answers ?? {};
        const out = {};
        for (const q of questions) {
            const labels = q.options.map((o) => o.label);
            // header 정확 일치 → 질문 텍스트 부분 일치 순으로 찾는다.
            let chosen = map[q.header];
            if (chosen === undefined) {
                const key = Object.keys(map).find((k) => q.question.includes(k));
                if (key !== undefined)
                    chosen = map[key];
            }
            // 정해 둔 답이 없으면 첫 선택지를 고른다. 스크립트 실행이 멈추지 않게 하되 그 사실을 남긴다.
            if (chosen === undefined) {
                chosen = labels[0];
                this.log(`  (정해 둔 답이 없어 첫 선택지로: "${q.header}" → ${chosen})`);
            }
            else if (!labels.includes(chosen)) {
                this.log(`  (선택지에 없는 답 "${chosen}" — 자유 입력으로 전달한다)`);
            }
            out[q.question] = chosen;
        }
        return out;
    }
    async approveWrite(tool, input) {
        const name = shortName(tool);
        if (this.opts.approveOnly) {
            if (this.opts.approveOnly.includes(name))
                return { approved: true };
            return { approved: false, reason: `--approve-only 에 ${name} 이 없다` };
        }
        if (this.opts.approveWrites)
            return { approved: true };
        return { approved: false,
            reason: `승인하지 않았다. 실행할 때 --approve 를 붙이면 승인한다 (대상: ${JSON.stringify(input).slice(0, 120)})` };
    }
}
//# sourceMappingURL=decider.js.map