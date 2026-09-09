/**
 * 결정하는 쪽의 구현.
 *
 * 웹앱에서는 화면이 이 역할을 한다. CLI 에서는 미리 정해 둔 답과 승인 정책이 대신한다.
 * **기본값은 거절이다.** 승인은 실행할 때 사람이 플래그로 명시해야 한다 —
 * 스크립트가 조용히 승인해 버리면 게이트가 있으나 마나가 된다.
 */
import type { Decider, QuestionSpec } from './gate.js';
import { shortName } from './tools.js';

export type ScriptedDeciderOptions = {
  /** 질문 텍스트(부분 일치) 또는 header → 고를 라벨. */
  answers?: Record<string, string>;
  /** 쓰기 도구를 승인할지. 기본 false. */
  approveWrites?: boolean;
  /** 이 도구만 승인. 지정하면 approveWrites 보다 우선한다. */
  approveOnly?: string[];
  onLog?: (line: string) => void;
};

export class ScriptedDecider implements Decider {
  constructor(private readonly opts: ScriptedDeciderOptions = {}) {}

  private log(s: string): void { this.opts.onLog?.(s); }

  async answerQuestions(questions: QuestionSpec[]): Promise<Record<string, string> | null> {
    const map = this.opts.answers ?? {};
    const out: Record<string, string> = {};

    for (const q of questions) {
      const labels = q.options.map((o) => o.label);
      // header 정확 일치 → 질문 텍스트 부분 일치 순으로 찾는다.
      let chosen = map[q.header];
      if (chosen === undefined) {
        const key = Object.keys(map).find((k) => q.question.includes(k));
        if (key !== undefined) chosen = map[key];
      }
      // 정해 둔 답이 없으면 첫 선택지를 고른다. 스크립트 실행이 멈추지 않게 하되 그 사실을 남긴다.
      if (chosen === undefined) {
        chosen = labels[0]!;
        this.log(`  (정해 둔 답이 없어 첫 선택지로: "${q.header}" → ${chosen})`);
      } else if (!labels.includes(chosen)) {
        this.log(`  (선택지에 없는 답 "${chosen}" — 자유 입력으로 전달한다)`);
      }
      out[q.question] = chosen;
    }
    return out;
  }

  async approveWrite(tool: string, input: Record<string, unknown>):
    Promise<{ approved: true } | { approved: false; reason: string }> {
    const name = shortName(tool);
    if (this.opts.approveOnly) {
      if (this.opts.approveOnly.includes(name)) return { approved: true };
      return { approved: false, reason: `--approve-only 에 ${name} 이 없다` };
    }
    if (this.opts.approveWrites) return { approved: true };
    return { approved: false,
      reason: `승인하지 않았다. 실행할 때 --approve 를 붙이면 승인한다 (대상: ${JSON.stringify(input).slice(0, 120)})` };
  }
}
