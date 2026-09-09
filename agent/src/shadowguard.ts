/**
 * 승인 게이트가 가려졌는지 감시한다 (DECISIONS.md D14 자체 검사).
 *
 * allowedTools 의 맨이름 항목이 canUseTool 을 가리면 SDK 가
 * CLAUDE_SDK_CAN_USE_TOOL_SHADOWED 코드로 Node 경고를 한 번 띄운다.
 *
 * 그 경고를 잡아 **실패로 처리한다.** 게이트가 가려진 채로 실행이 이어지면
 * 승인 화면이 뜨지 않고 쓰기 도구가 자동 실행된다. 이 서비스가 겨냥하는
 * "조용한 실패"를 서비스 자신이 저지르는 일이라, 조용히 넘기지 않는다.
 */
export class ShadowGuard {
  private tripped: string | null = null;
  private handler: ((w: Error & { code?: string }) => void) | null = null;

  arm(): void {
    if (this.handler) return;
    this.handler = (w) => {
      if (w.code === 'CLAUDE_SDK_CAN_USE_TOOL_SHADOWED') {
        this.tripped = w.message || 'canUseTool 이 allowedTools 에 의해 가려졌다';
      }
    };
    process.on('warning', this.handler);
  }

  disarm(): void {
    if (this.handler) {
      process.off('warning', this.handler);
      this.handler = null;
    }
  }

  get shadowed(): string | null { return this.tripped; }

  /** 가려졌으면 던진다. 실행 시작 직후와 종료 시점에 부른다. */
  assertNotShadowed(): void {
    if (this.tripped) {
      throw new Error(
        '승인 게이트가 가려졌다 — canUseTool 이 호출되지 않는 설정이다. '
        + '쓰기 도구가 allowedTools 에 들어갔는지 확인한다.\n  SDK 경고: ' + this.tripped,
      );
    }
  }
}
