/**
 * get_user_metrics 의 live 구현. Supabase 집계 전용 RPC.
 *
 * 이 파일은 테이블을 직접 조회하지 않는다. RPC 하나만 부른다 (DECISIONS.md D10).
 * service_role 키는 읽지도 않는다 — 코드에 그 이름이 없다.
 *
 * 함수가 아직 없거나 토큰이 어긋나면 상류 오류를 그대로 흘리지 않고
 * **무엇을 하면 되는지** 담아 되돌린다. 모델이 헛되게 재시도하지 않게.
 */
import { FatalToolError, ToolError } from '../errors.js';
import { request, requireEnv } from './http.js';

const RPC = 'ops_user_metrics';

/** ISO 8601 이든 YYYY-MM-DD 이든 날짜 부분만 쓴다. RPC 인자가 date 다. */
export function toDate(v: string, which: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) {
    // 2026-13-99 같은 문자열도 정규식은 통과한다. 달력에 있는 날짜인지 대조한다.
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d) {
      return `${m[1]}-${m[2]}-${m[3]}`;
    }
    throw new FatalToolError('invalid_period', `${which} 가 실제 날짜가 아니다`, { [which]: v });
  }
  const t = Date.parse(v);
  if (!Number.isFinite(t)) {
    throw new FatalToolError('invalid_period', `${which} 가 날짜로 읽히지 않는다`, { [which]: v });
  }
  return new Date(t).toISOString().slice(0, 10);
}

function upstreamCode(err: unknown): string | undefined {
  if (err instanceof ToolError) {
    const u = err.extra.upstream as { code?: unknown } | undefined;
    if (u && typeof u.code === 'string') return u.code;
  }
  return undefined;
}

export async function userMetrics(
  period: { since: string; until: string },
  granularity: 'day' | 'week',
): Promise<Record<string, unknown>> {
  const env = requireEnv('get_user_metrics', [
    'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'OPS_METRICS_TOKEN',
  ]);
  const url = env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/+$/, '');
  const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  let out: unknown;
  try {
    out = await request({
      source: 'Supabase',
      method: 'POST',
      url: `${url}/rest/v1/rpc/${RPC}`,
      headers: { apikey: key, authorization: `Bearer ${key}` },
      body: {
        p_token: env.OPS_METRICS_TOKEN!,
        p_since: toDate(period.since, 'since'),
        p_until: toDate(period.until, 'until'),
        p_granularity: granularity,
      },
    });
  } catch (err) {
    // PGRST202 = 스키마 캐시에 그런 함수가 없다. 마이그레이션을 아직 안 돌린 것이다.
    if (upstreamCode(err) === 'PGRST202') {
      throw new FatalToolError('rpc_not_created',
        `Supabase 에 집계 함수 ${RPC} 가 없다. supabase/ops_metrics.sql 을 SQL Editor 에서 실행한다`,
        { rpc: RPC, sql_file: 'supabase/ops_metrics.sql' });
    }
    // 42501 = insufficient_privilege. 함수 안에서 토큰 대조가 실패했다.
    if (upstreamCode(err) === '42501') {
      throw new FatalToolError('metrics_token_rejected',
        'OPS_METRICS_TOKEN 이 Supabase 에 저장된 값과 다르다. 값은 사람이 직접 맞춘다',
        { rpc: RPC, sql_file: 'supabase/ops_metrics.sql' });
    }
    throw err;
  }

  if (!out || typeof out !== 'object') {
    throw new ToolError('unexpected_rpc_shape', '집계 함수가 객체를 돌려주지 않았다', { got: typeof out });
  }
  return { ...(out as Record<string, unknown>), source: { mode: 'live', rpc: RPC } };
}
