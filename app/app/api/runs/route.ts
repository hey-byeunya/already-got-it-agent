import { NextResponse } from 'next/server';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURES_DIR } from '@/lib/paths';
import * as store from '@/lib/store';
import { credentialSource, start } from '@/lib/runner';
import { limitsFromEnv } from 'already-got-it-ops-agent/limits';

export const runtime = 'nodejs';

/**
 * 픽스처의 사람이 읽을 라벨까지 함께 준다.
 * 라벨은 fixtures/snapshots/*.json 에 원래 있었는데 화면까지 오지 않아서,
 * 화면이 같은 설명을 따로 하드코딩하고 있었다 — 두 곳이 어긋날 수 있는 구조였다.
 */
function listFixtures(): { id: string; label: string }[] {
  if (!existsSync(FIXTURES_DIR)) return [];
  return readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const id = f.replace('.json', '');
      try {
        const fx = JSON.parse(readFileSync(join(FIXTURES_DIR, f), 'utf8')) as { label?: unknown };
        return { id, label: typeof fx.label === 'string' ? fx.label : id };
      } catch {
        return { id, label: id };
      }
    });
}

export function GET() {
  return NextResponse.json({
    runs: store.listRuns(),
    fixtures: listFixtures(),
    credential_source: credentialSource(),
    limits: limitsFromEnv(),
  });
}

/** 최근 7일. 모델은 오늘 날짜를 모르므로 지시에 실제 날짜를 박는다. */
function recentWeek(): { since: string; until: string } {
  const until = new Date();
  const since = new Date(until.getTime() - 7 * 86_400_000);
  return { since: since.toISOString().slice(0, 10), until: until.toISOString().slice(0, 10) };
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as
    { fixture_id?: string; goal?: string; focus?: string; engine?: string; model?: string };
  const fixtureId = body.fixture_id ?? null;
  const runId = `web-${Date.now().toString(36)}`;
  const engine = body.engine === 'opencode' ? 'opencode' : 'claude';
  const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined;
  const focus = body.focus?.trim() || undefined;
  const period = recentWeek();

  const goal = body.goal?.trim() || (
    `이번 주 「이미 있어」 운영 브리핑 카드뉴스를 만들어 줘.`
    + ` 기간은 ${period.since} 부터 ${period.until} 까지다 (도구의 since·until 에 이 값을 그대로 넘긴다).`
    + ` run_id 는 "${runId}" 를 쓴다.`
    + (focus ? ` 특히 ${focus} 축을 깊게 본다.` : '')
    + ` 스토리보드를 제시한 뒤, 지표 카드는 render_chart 로 실제 SVG 까지 그려라.`
    + ` 손봐야 할 것이 있으면 create_github_issue 를 호출해 이슈 생성을 제안해라.`
  );

  store.createRun({ runId, fixtureId, goal, engine, ...(focus ? { focus } : {}), period });
  start({ runId, fixtureId, goal, engine, ...(model ? { model } : {}) });
  return NextResponse.json({ run_id: runId }, { status: 201 });
}
