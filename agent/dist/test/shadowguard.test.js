/**
 * 검사: 승인 게이트가 가려졌는지 감시한다 (DECISIONS.md D14 자체 검사)
 *
 * allowedTools 에 쓰기 도구를 맨이름으로 넣으면 SDK 가
 * CLAUDE_SDK_CAN_USE_TOOL_SHADOWED 경고를 띄운다. 그걸 잡아 **실패로 처리**한다.
 * 조용히 넘기면 승인 화면이 뜨지 않은 채 쓰기 도구가 실행된다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ShadowGuard } from '../src/shadowguard.js';
test('셰도잉 감시', async (t) => {
    await t.test('해당 경고가 뜨면 실패로 처리한다', async () => {
        const g = new ShadowGuard();
        g.arm();
        try {
            const w = new Error('canUseTool shadowed by allowedTools entry');
            w.name = 'Warning';
            w.code = 'CLAUDE_SDK_CAN_USE_TOOL_SHADOWED';
            process.emit('warning', w);
            await new Promise((r) => setImmediate(r));
            assert.ok(g.shadowed, '경고를 잡아야 한다');
            assert.throws(() => g.assertNotShadowed(), /승인 게이트가 가려졌다/);
        }
        finally {
            g.disarm();
        }
    });
    await t.test('경계 — 관계없는 경고는 무시한다', async () => {
        const g = new ShadowGuard();
        g.arm();
        try {
            const w = new Error('DeprecationWarning: something else');
            w.name = 'Warning';
            w.code = 'DEP0040';
            process.emit('warning', w);
            await new Promise((r) => setImmediate(r));
            assert.equal(g.shadowed, null);
            g.assertNotShadowed(); // 던지지 않아야 한다
        }
        finally {
            g.disarm();
        }
    });
    await t.test('disarm 뒤에는 더 듣지 않는다', async () => {
        const g = new ShadowGuard();
        g.arm();
        g.disarm();
        const w = new Error('x');
        w.name = 'Warning';
        w.code = 'CLAUDE_SDK_CAN_USE_TOOL_SHADOWED';
        process.emit('warning', w);
        await new Promise((r) => setImmediate(r));
        assert.equal(g.shadowed, null);
    });
});
//# sourceMappingURL=shadowguard.test.js.map