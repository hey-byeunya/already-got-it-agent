/**
 * opencode `--format json` 이벤트 파서. 의존성이 없어 단독으로 검사할 수 있다.
 *
 * 실측한 형태 (opencode 1.18.29):
 *   text       — {"type":"text","part":{"type":"text","text":"..."}}
 *   tool_use   — {"type":"tool_use","part":{"type":"tool","tool":"ops_get_system_health",
 *                "state":{"status":"completed","input":{...},"output":"..."}}}
 *   step_finish— {"type":"step_finish","part":{"type":"step-finish","tokens":{...},"cost":...}}
 *   error      — {"type":"error","error":{"name":...,"data":{"message":...}}}
 *
 * 모르는 형태는 무시한다 — 버전이 올라 이벤트가 늘어도 실행이 깨지지 않게.
 */
export type ParsedLine =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; tool: string; input: unknown; output: string; isError: boolean }
  | { kind: 'usage'; input: number; output: number; cost: number }
  | { kind: 'error'; message: string }
  | { kind: 'ignore' };

export function parseOpencodeLine(line: string): ParsedLine {
  let e: Record<string, unknown>;
  try {
    e = JSON.parse(line) as Record<string, unknown>;
  } catch { return { kind: 'ignore' }; }
  if (!e || typeof e !== 'object') return { kind: 'ignore' };
  const part = (e.part ?? {}) as Record<string, unknown>;

  if (e.type === 'text' && typeof part.text === 'string') {
    return part.text.trim() ? { kind: 'text', text: part.text } : { kind: 'ignore' };
  }
  if (e.type === 'tool_use' && part.type === 'tool' && typeof part.tool === 'string') {
    const state = (part.state ?? {}) as Record<string, unknown>;
    // 실패한 호출은 output 대신 error 에 든다. output 만 보면 `""` 로 보인다 (실측).
    const output = typeof state.output === 'string' ? state.output
      : state.error !== undefined ? JSON.stringify(state.error)
      : JSON.stringify(state.output ?? '');
    return {
      kind: 'tool',
      tool: shortTool(part.tool),
      input: state.input ?? {},
      output,
      isError: state.status !== 'completed',
    };
  }
  if (e.type === 'step_finish' && part.type === 'step-finish') {
    const tokens = (part.tokens ?? {}) as Record<string, number>;
    const cost = typeof part.cost === 'number' ? part.cost : 0;
    return {
      kind: 'usage',
      input: tokens.input ?? 0,
      output: tokens.output ?? 0,
      cost,
    };
  }
  if (e.type === 'error') {
    const err = (e.error ?? {}) as Record<string, unknown>;
    const data = (err.data ?? {}) as Record<string, unknown>;
    const message = typeof data.message === 'string' ? data.message
      : typeof err.message === 'string' ? err.message : 'opencode 실행 오류';
    return { kind: 'error', message: `${String(err.name ?? 'error')}: ${message}`.slice(0, 500) };
  }
  return { kind: 'ignore' };
}

/** `ops_get_system_health` → `get_system_health`. 서버 접두어를 뗀다. */
function shortTool(name: string): string {
  return name.replace(/^ops_/, '');
}
