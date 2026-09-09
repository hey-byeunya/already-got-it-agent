import { NextResponse } from 'next/server';
import * as store from '@/lib/store';
import { readAxes, readCards, steps } from '@/lib/derive';
import type { RunDetail } from '@/lib/types';

export const runtime = 'nodejs';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const state = store.readState(id);
  if (!state) return NextResponse.json({ error: 'run_not_found' }, { status: 404 });

  // 저장된 상태에 디스크에서 유도한 것을 얹는다. 새로 조회하는 것은 없다.
  const detail: RunDetail = {
    ...state,
    axes: readAxes(id),
    cards: readCards(id),
    steps: steps(state.trace, state.status),
  };
  return NextResponse.json(detail);
}
