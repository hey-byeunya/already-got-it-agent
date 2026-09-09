import { NextResponse } from 'next/server';
import { readdirSync, existsSync } from 'node:fs';
import { FIXTURES_DIR } from '@/lib/paths';
import * as store from '@/lib/store';
import { credentialSource, start } from '@/lib/runner';

export const runtime = 'nodejs';

export function GET() {
  const fixtures = existsSync(FIXTURES_DIR)
    ? readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', '')).sort()
    : [];
  return NextResponse.json({
    runs: store.listRuns(), fixtures, credential_source: credentialSource(),
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as { fixture_id?: string; goal?: string; focus?: string };
  const fixtureId = body.fixture_id ?? null;
  const runId = `web-${Date.now().toString(36)}`;

  const goal = body.goal?.trim() || (
    `이번 주 「이미 있어」 운영 브리핑 카드뉴스를 만들어 줘. 기간은 최근 7일이다.`
    + ` run_id 는 "${runId}" 를 쓴다.`
    + (body.focus ? ` 특히 ${body.focus} 축을 깊게 본다.` : '')
    + ` 스토리보드를 제시한 뒤, 지표 카드는 render_chart 로 실제 SVG 까지 그려라.`
    + ` 손봐야 할 것이 있으면 create_github_issue 를 호출해 이슈 생성을 제안해라.`
  );

  store.createRun({ runId, fixtureId, goal });
  start({ runId, fixtureId, goal });
  return NextResponse.json({ run_id: runId }, { status: 201 });
}
