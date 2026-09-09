import { NextResponse } from 'next/server';
import { execFile } from 'node:child_process';

export const runtime = 'nodejs';

/**
 * opencode 무료 모델 목록. 시작 화면의 모델 선택에 쓴다.
 *
 * `opencode models --verbose`는 `provider/id` 행 + JSON 블록을 늘어놓는다.
 * JSON 안 `cost.input`·`cost.output`이 둘 다 0이면 무료로 본다
 * (이름의 `-free` 접미사보다 단가표가 정본이다).
 * 채팅으로 쓸 수 없는 것(임베딩·음성·이미지·영상)은 뺀다.
 */

export type FreeModel = { id: string; name: string };

/** 채팅 브리핑에 쓸 수 없는 모델. id 부분 문자열로 거른다. */
const NON_CHAT = [
  'embedding', 'tts', '-image', 'veo-', 'lyria',
  'translate', 'computer-use', 'deep-research',
];

function parseModels(out: string): FreeModel[] {
  const lines = out.split('\n');
  const found: FreeModel[] = [];
  let header: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (header && buf.length) {
      try {
        const d = JSON.parse(buf.join('\n')) as {
          name?: string; cost?: { input?: number; output?: number };
        };
        const cost = d.cost ?? {};
        if (cost.input === 0 && cost.output === 0
          && !NON_CHAT.some((k) => header!.toLowerCase().includes(k))) {
          found.push({ id: header, name: typeof d.name === 'string' ? d.name : header });
        }
      } catch { /* 깨진 블록은 건너뛴다 */ }
    }
    header = null;
    buf = [];
  };
  for (const line of lines) {
    if (/^[\w][\w\-.]*\/\S+$/.test(line.trim()) && !line.trim().startsWith('{')) {
      flush();
      header = line.trim();
    } else if (header) {
      buf.push(line);
    }
  }
  flush();
  return found;
}

let cache: { at: number; models: FreeModel[] } | null = null;
const CACHE_MS = 60_000;

function opencodeBin(): string {
  return process.env.OPS_OPENCODE_BIN?.trim() || 'opencode';
}

export async function GET() {
  if (cache && Date.now() - cache.at < CACHE_MS) {
    return NextResponse.json({ models: cache.models, cached: true });
  }
  let out: string;
  try {
    out = await new Promise<string>((resolve, reject) => {
      execFile(opencodeBin(), ['models', '--verbose'],
        { timeout: 30_000, maxBuffer: 16 * 1024 * 1024 },
        (err, stdout) => (err ? reject(err) : resolve(stdout)));
    });
  } catch (err) {
    return NextResponse.json(
      { models: [], error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
  const models = parseModels(out);
  cache = { at: Date.now(), models };
  return NextResponse.json({ models, cached: false });
}
