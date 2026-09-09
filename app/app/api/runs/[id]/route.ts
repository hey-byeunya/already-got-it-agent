import { NextResponse } from 'next/server';
import * as store from '@/lib/store';

export const runtime = 'nodejs';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const state = store.readState(id);
  if (!state) return NextResponse.json({ error: 'run_not_found' }, { status: 404 });
  return NextResponse.json(state);
}
