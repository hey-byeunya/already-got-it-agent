'use client';

/**
 * 실행 상세 — 터미널 화면.
 *
 * 위에서 아래로: 타이틀바 · 프롬프트 헤더 · 계기 3분할 · 게이트(승인/질문/중단/종료) ·
 * 사람이 결정한 것 · 본문 2단(카드 또는 원고 | 로그).
 *
 * 화면이 지켜야 할 것 두 가지:
 *  1. **모르는 것을 0 으로 그리지 않는다.** usage_known:false 는 «확인 못 함» 이다.
 *  2. **누를 수 없는 버튼을 보여주지 않는다.** 콜백이 사라진 대기는 무효로 표시하고 비활성한다.
 */

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Bar, Cursor, Gauge, Lights, SectionHead, StatusBadge, TERMINAL_STATUSES, clock,
} from '@/components/term';
import type { CardView, ExportView, RunDetail, RunLinks, Step, TraceEvent } from '@/lib/types';

type Conflict = { code: string; message: string };

const POLL_MS = 1200;
const NARROW = 1080;
/** 로그 한 쪽에 담는 줄 수. 실행 하나가 60줄을 넘기니 전부 펼치면 스크롤이 감당이 안 된다. */
const LOG_PAGE = 20;

/** 트레이스 kind → 글리프와 색. kind 는 원래 저장되는데 전에는 화면이 버렸다. */
function glyph(e: TraceEvent): { mark: string; cls: string; group: 'tool' | 'think' | 'err' } {
  if (e.isError || e.kind === 'error' || e.kind === 'hook_denied') {
    return { mark: '✕', cls: 'bad', group: 'err' };
  }
  switch (e.kind) {
    case 'tool_use': return { mark: '→', cls: 'ok', group: 'tool' };
    case 'tool_result': return { mark: '←', cls: 'mut', group: 'tool' };
    case 'question_waiting': return { mark: '?', cls: 'wrn', group: 'think' };
    case 'question_answered':
    case 'question_declined': return { mark: '?', cls: 'mut', group: 'think' };
    case 'approval_waiting': return { mark: '!', cls: 'bad', group: 'think' };
    case 'approval_granted': return { mark: '✓', cls: 'ok', group: 'think' };
    case 'approval_denied': return { mark: '✕', cls: 'bad', group: 'think' };
    case 'stopped': return { mark: '■', cls: 'wrn', group: 'err' };
    default: return { mark: '·', cls: 'mut', group: 'think' };
  }
}


/** 바깥으로 나가는 링크. 새 탭으로 열고 referrer 를 보내지 않는다. */
function Out({ href, children, title }: {
  href: string; children: React.ReactNode; title?: string;
}) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener"
      {...(title ? { title } : {})}>{children}</a>
  );
}

/**
 * 글 안의 `#12` 를 이슈·PR 링크로 바꾼다.
 *
 * **이 실행이 실제로 조회한 번호만** 링크한다. 아무 숫자나 링크하면
 * 없는 이슈를 가리키게 되고, 카드에 적힌 «47건» 같은 수치까지 링크가 된다.
 */
function linkRefs(text: string, links: RunLinks): React.ReactNode {
  if (!links.repo) return text;
  const known = new Map<number, { url: string; kind: string }>();
  for (const i of links.issues) known.set(i.number, { url: i.url, kind: 'issue' });
  for (const p of links.pulls) known.set(p.number, { url: p.url, kind: 'PR' });
  if (known.size === 0) return text;

  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(/#(\d+)/g)) {
    const hit = known.get(Number(m[1]));
    if (!hit) continue;
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(
      <Out key={`${m.index}-${m[1]}`} href={hit.url}
        title={links.snapshot
          ? `픽스처 스냅샷의 ${hit.kind} 참조 - 실제 저장소에 없을 수 있다`
          : `${links.repo} ${hit.kind} #${m[1]}`}>
        {m[0]}
      </Out>,
    );
    last = m.index + m[0].length;
  }
  if (parts.length === 0) return text;
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** 카드의 출처 문장이 web_search 를 가리키면, 그 검색이 돌려준 주소를 붙인다. */
function webSourcesFor(card: CardView, links: RunLinks): RunLinks['web'] {
  if (!links.web.length) return [];
  if (!card.sources.some((x) => x.includes('web_search'))) return [];
  // 출처 문장에 제목이 적혀 있으면 그것만, 없으면 이 실행의 검색 출처 전부.
  const named = links.web.filter((w) => card.sources.some((x) => x.includes(w.title)));
  return named.length ? named : links.web;
}


const kb = (b: number) => `${Math.round(b / 1024).toLocaleString()}KB`;

/**
 * 로그 한 줄의 시각. **현지 시각으로 고친다.**
 *
 * 기록은 ISO UTC 로 남는다. 예전에는 그 문자열을 그대로 잘라 썼는데(`slice(11,19)`),
 * 같은 화면의 created 는 현지 시각이라 두 값이 9시간 어긋나 보였다.
 * 저장은 UTC 로 두고 — 기계끼리 견줄 값이다 — 읽는 자리에서만 고친다.
 */
function hhmmss(v: string): string {
  const t = Date.parse(v);
  if (!Number.isFinite(t)) return v.slice(11, 19);
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 사람이 읽을 시각. 초는 버린다. */
function stamp(v: string): string {
  const t = Date.parse(v);
  if (!Number.isFinite(t)) return v;
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 카드 미리보기 모달.
 *
 * 새 탭 대신 모달인 이유: 카드를 넘겨 가며 훑는 일이라 탭을 오갈 필요가 없다.
 * ←/→ 로 넘기고 Esc 로 닫는다 — 키보드만으로도 다 된다.
 */
function CardModal({ runId, pages, at, onMove, onClose }: {
  runId: string;
  pages: { card_no: number; bytes: number }[];
  at: number;
  onMove: (next: number) => void;
  onClose: () => void;
}) {
  const cur = pages[at];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') onMove(Math.min(pages.length - 1, at + 1));
      if (e.key === 'ArrowLeft') onMove(Math.max(0, at - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [at, pages.length, onMove, onClose]);

  if (!cur) return null;
  const nn = String(cur.card_no).padStart(2, '0');

  return (
    // 바깥을 누르면 닫힌다. 안쪽 클릭이 새어 나가지 않게 멈춘다.
    <div className="modal" role="dialog" aria-modal="true" aria-label={`카드 ${nn} 미리보기`}
      onClick={onClose}>
      <div className="frame-win" onClick={(e) => e.stopPropagation()}>
        <div className="titlebar">
          <span className="row" style={{ gap: 10 }}>
            <Lights />
            <span className="ink">card {nn}.png</span>
            <span className="fnt">{kb(cur.bytes)} · {at + 1}/{pages.length}</span>
          </span>
          <span className="row" style={{ gap: 6 }}>
            <button className="chip" disabled={at === 0} onClick={() => onMove(at - 1)}>‹ prev</button>
            <button className="chip" disabled={at >= pages.length - 1} onClick={() => onMove(at + 1)}>next ›</button>
            <a href={`/api/runs/${runId}/export/${nn}.png`} download
              className="chip" style={{ display: 'inline-block' }}>⤓ png</a>
            <button onClick={onClose}>esc</button>
          </span>
        </div>
        <div className="body">
          <img src={`/api/runs/${runId}/export/${nn}.png?inline`} alt={`카드 ${nn}`} />
        </div>
      </div>
    </div>
  );
}

/**
 * 카드뉴스 내보내기 — **사람이 누를 때만 굽는다.**
 *
 * 이미지 굽기는 카드당 브라우저를 한 번 띄우는 일이라 느리다. 문안을 고칠 때마다
 * 다시 구우면 낭비이고, 스토리보드가 됐는지는 사람이 판단할 일이다.
 * 그래서 에이전트는 카드까지만 만들고, 굽는 것은 이 버튼이 한다.
 *
 * 굽고 난 뒤에야 내려받기와 미리보기가 생긴다 — 디스크에 **실제로 있는 것만** 보여준다.
 */
function ExportBar({ runId, ex, cardCount, exporting, busy, onExport, onPreview }: {
  runId: string; ex: ExportView; cardCount: number;
  exporting: boolean; busy: boolean; onExport: () => void; onPreview: (at: number) => void;
}) {
  const base = `/api/runs/${runId}/export`;
  const made = Boolean(ex.zip) || ex.png.length > 0;
  const stale = made && cardCount > 0 && ex.png.length !== cardCount;

  // 두 버튼은 같은 자리에 번갈아 서므로 크기가 같아야 한다 (.primary 는 더 크고 굵다).
  // 아직 안 구웠을 때만 --cards 탭과 같은 초록으로 눈에 띄게 한다.
  const button = (
    <button className={made ? undefined : 'go'}
      disabled={busy || exporting || cardCount === 0}
      onClick={onExport}
      title={cardCount === 0
        ? '내보낼 카드가 없다'
        : made ? '카드를 PNG 로 다시 굽고 ZIP 을 새로 만든다'
          : `카드 ${cardCount}장을 PNG · ZIP · 근거 기록으로 내보낸다`}>
      {exporting ? 'exporting…' : made ? '--rebuild' : `--export ${cardCount}`}
    </button>
  );

  if (!made) {
    return (
      <div className="row" style={{ gap: 12 }}>
        {button}
        <span className="note">
          {cardCount === 0
            ? '카드가 아직 없다. 카드를 만들면 여기서 PNG · ZIP · 근거 기록을 만든다.'
            : `카드 ${cardCount}장을 PNG 로 굽고 ZIP 으로 묶는다. 그 뒤에 내려받을 수 있다.`}
        </span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="row" style={{ gap: 12 }}>
        {button}
        {stale
          ? (
            <span className="note wrn">
              카드 {cardCount}장 중 {ex.png.length}장만 구워져 있다 - 다시 굽는다
            </span>
          )
          : <span className="note">카드를 고쳤으면 다시 굽는다</span>}
      </div>
      <div className="note" style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <span className="ok">⤓ 내려받기</span>
      {ex.zip && (
        <a href={`${base}/zip`} download>
          {ex.zip.name} <span className="fnt">{kb(ex.zip.bytes)}</span>
        </a>
      )}
      {ex.sources && <a href={`${base}/sources`} download>SOURCES.md <span className="fnt">근거 기록</span></a>}
      {ex.png.length > 0 && (
        <span className="mut">
          카드 {ex.png.length}장{ex.png.length !== cardCount && cardCount > 0
            ? <span className="wrn"> (카드 {cardCount}장 중)</span> : ''}
          {' - '}
          {/*
            번호를 누르면 모달로 크게 본다. 내려받기는 모달 안의 ⤓ png 가 한다.
            썸네일 격자를 따로 두었더니 카드 목록 바로 위에 같은 그림이 두 번 나와
            화면만 길어졌다 — 격자를 걷어내고 이 줄에 모달을 붙였다.
          */}
          {ex.png.map((p, i) => (
            <span key={p.card_no}>
              {i > 0 && <span className="fnt"> · </span>}
              <button className="linky" onClick={() => onPreview(i)}
                title={`카드 ${String(p.card_no).padStart(2, '0')} 크게 보기 · ${kb(p.bytes)}`}>
                {String(p.card_no).padStart(2, '0')}
              </button>
            </span>
          ))}
          <span className="fnt"> · 누르면 크게 본다</span>
        </span>
      )}
      </div>

    </div>
  );
}

const SEVERITY: Record<CardView['severity'], { line: string; bg: string; ink: string }> = {
  FIX_NOW: { line: 'var(--danger)', bg: 'rgba(226,96,75,.16)', ink: 'var(--danger-ink)' },
  WATCH: { line: 'var(--warn)', bg: 'rgba(232,192,78,.14)', ink: 'var(--warn)' },
  METRICS: { line: 'var(--muted)', bg: 'var(--line-in)', ink: 'var(--muted)' },
  FYI: { line: 'var(--muted)', bg: 'var(--line-in)', ink: 'var(--muted)' },
  COVER: { line: 'var(--accent)', bg: 'rgba(78,224,138,.14)', ink: 'var(--accent)' },
};

const STEP_MARK: Record<Step['state'], { g: string; cls: string }> = {
  done: { g: '✓', cls: 'ok' },
  current: { g: '◆', cls: 'wrn' },
  pending: { g: '·', cls: 'mut' },
};

export default function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [s, setS] = useState<RunDetail | null>(null);
  /** 불러오지 못한 이유. null 이면 아직 시도 중이거나 정상이다. */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [view, setView] = useState<'card' | 'raw'>('card');
  const [showLog, setShowLog] = useState(true);
  const [meter, setMeter] = useState<'budget' | 'usage'>('budget');
  const [gate, setGate] = useState(false);
  const [filter, setFilter] = useState<'all' | 'tool' | 'think' | 'err'>('all');
  const [page, setPage] = useState(0);
  const [narrow, setNarrow] = useState(false);
  const [copied, setCopied] = useState(false);
  /** 미리보기 모달이 보고 있는 카드 순번. null 이면 닫힌 상태다. */
  const [previewAt, setPreviewAt] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swipeX = useRef<number | null>(null);

  useEffect(() => {
    const check = () => setNarrow(window.innerWidth < NARROW);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const poll = useCallback(async () => {
    let res: Response;
    try {
      res = await fetch(`/api/runs/${id}`, { cache: 'no-store' });
    } catch {
      // 서버가 죽었거나 연결이 끊겼다. 계속 도는 대신 멈추고 알린다.
      setLoadError('서버에 연결하지 못했다. 개발 서버가 떠 있는지 확인한다.');
      return;
    }
    if (!res.ok) {
      // 404 를 그냥 넘기면 화면이 «불러오는 중» 에서 영원히 멈춘다 —
      // CLI 로 돌린 실행처럼 ui-state.json 이 없는 폴더에서 실제로 그랬다.
      setLoadError(res.status === 404
        ? '이 실행의 화면 상태가 없다. CLI 로 돌린 실행은 화면 상태(ui-state.json)를 남기지 않는다.'
        : `실행 상태를 불러오지 못했다 (HTTP ${res.status})`);
      return;
    }
    setLoadError(null);
    const next = await res.json() as RunDetail;
    setS(next);
    // 끝난 실행은 더 두드리지 않는다.
    if (!TERMINAL_STATUSES.has(next.status)) timer.current = setTimeout(() => void poll(), POLL_MS);
  }, [id]);

  useEffect(() => {
    void poll();
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [poll]);

  /** 카드뉴스 굽기. 사람이 눌렀을 때만 돈다. */
  async function exportCards() {
    setBusy(true); setConflict(null);
    const res = await fetch(`/api/runs/${id}/export`, { method: 'POST' });
    if (!res.ok) {
      const b = await res.json().catch(() => ({})) as { error?: string; message?: string };
      setConflict({ code: b.error ?? String(res.status), message: b.message ?? '내보내지 못했다' });
    }
    setBusy(false);
    await poll();
  }

  async function post(path: string, body: unknown) {
    setBusy(true); setConflict(null);
    const res = await fetch(`/api/runs/${id}/${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({})) as { error?: string; message?: string };
      setConflict({ code: b.error ?? String(res.status), message: b.message ?? '요청이 거절됐다' });
    }
    setBusy(false);
    await poll();
  }

  // 최신이 위로 온다. 실행이 길어지면 방금 무슨 일이 있었는지가 먼저 보여야 한다.
  const shown = useMemo(
    () => (s
      ? s.trace.filter((e) => filter === 'all' || glyph(e).group === filter).reverse()
      : []),
    [s, filter],
  );
  const pageCount = Math.max(1, Math.ceil(shown.length / LOG_PAGE));
  // 거르고 나서 쪽이 줄면 빈 쪽에 남을 수 있다. 그때는 마지막 쪽으로 당긴다.
  const safePage = Math.min(page, pageCount - 1);
  const pageItems = shown.slice(safePage * LOG_PAGE, safePage * LOG_PAGE + LOG_PAGE);
  const counts = useMemo(() => {
    const c = { tool: 0, think: 0, err: 0 };
    for (const e of s?.trace ?? []) c[glyph(e).group] += 1;
    return c;
  }, [s]);

  if (loadError) {
    return (
      <main>
        <div className="win">
          <div className="titlebar">
            <div className="row" style={{ gap: 12 }}>
              <Lights />
              <span className="mut">ops-brief</span><span className="fnt">—</span>
              <span className="ink">run/{id}</span>
            </div>
            <Link href="/" className="mut" style={{ fontSize: 11 }}>cd ..</Link>
          </div>
          <div className="strip warn" style={{ borderBottom: 'none' }}>
            <div><span className="wrn">✕</span> <b>불러오지 못했다</b></div>
            <div className="mut">{loadError}</div>
          </div>
        </div>
      </main>
    );
  }
  if (!s) return <main><span className="mut">불러오는 중<Cursor /></span></main>;

  const dead = !s.live;
  const askable = Boolean(s.pending_question) && s.live;
  const approvable = Boolean(s.pending_approval) && s.live;
  // 엔진이 잰 값이 있으면 그것을 쓴다. updated_at 은 실행이 끝난 뒤에도
  // 카드 내보내기 같은 작업으로 갱신돼, 끝난 실행의 경과 시간이 계속 늘어난다.
  const elapsed = s.elapsed_seconds
    ?? (Date.parse(s.updated_at) - Date.parse(s.created_at)) / 1000;
  const toolCalls = s.trace.filter((e) => e.kind === 'tool_use').length;
  const u = s.usage;
  // 상한이 재는 것은 «캐시 읽기를 뺀» 입력이다 (agent/src/usage.ts 의 freshInputTokens).
  // 캐시 읽기까지 더하면 상한을 한참 넘겨 보인다 — 실제 실행에서 겪은 함정이다.
  const freshInput = u && u.usage_known
    ? u.input_tokens + u.cache_creation_input_tokens
    : null;
  const known = Boolean(u?.usage_known);
  const lim = s.limits;

  const bottomCols = narrow || !showLog ? 'minmax(0,1fr)' : 'minmax(0,1fr) 372px';

  return (
    <main>
      <div className="win">

        {/* ─────────────────────────── 타이틀 바 */}
        <div className="titlebar">
          <div className="row" style={{ gap: 12 }}>
            <Lights />
            <span className="mut">ops-brief</span><span className="fnt">—</span>
            <span className="ink">run/{s.run_id}</span>
            <span className="fnt">·</span>
            <span className="mut">{s.fixture_id ?? 'live'}</span>
            <Link href="/" className="mut" style={{ fontSize: 11 }}>cd ..</Link>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <StatusBadge status={s.status} pendingApproval={Boolean(s.pending_approval)} />
            <div className="tabs">
              <button className="tab" aria-pressed={view === 'card'} onClick={() => setView('card')}>--cards</button>
              <button className="tab" aria-pressed={view === 'raw'} onClick={() => setView('raw')}>--raw</button>
            </div>
            <button onClick={() => setShowLog((v) => !v)}>{showLog ? '--no-log' : '--log'}</button>
          </div>
        </div>

        {/* ─────────────────────────── 프롬프트 헤더 */}
        <div style={{ padding: '16px 18px 14px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ fontSize: 12.5, lineHeight: 1.9 }}>
            <div>
              <span className="ok">➜</span> <span className="mut">brief</span> run
              {s.fixture_id && <> --fixture <span className="ink">{s.fixture_id}</span></>}
              {s.period && <>
                {' '}--since <span className="ink">{s.period.since}</span>
                {' '}--until <span className="ink">{s.period.until}</span>
              </>}
              {' '}--axis <span className="ok">{s.focus || 'auto'}</span>
              {' '}--engine <span className="ink">{s.engine ?? 'claude'}</span>
            </div>
            <div className="mut">
              auth: {credLine(s.credential_source)} · engine {s.engine ?? 'claude'}
              {/* 설명은 툴팁으로 내린다 — 값만 남긴다. 머리줄 모드 배지와 같은 규칙이다. */}
              {' · '}live{' '}
              {s.fixture_id
                ? <span className="wrn" data-tip="외부 API 를 부르지 않았다 · 스냅샷을 읽었다."
                    tabIndex={0}>false</span>
                : <span className="ok" data-tip="실제 API 를 불렀다." tabIndex={0}>true</span>}
              {!dead && <Cursor />}
            </div>
          </div>
          <div className="row" style={{ marginTop: 13, fontSize: 11, gap: 10 }}>
            {/*
              여기 있던 「live true — 이 서버가 실행 중」을 뺐다. 윗줄의 live 표시와
              같은 낱말이 뜻만 다르게 두 번 나와 읽는 사람을 헷갈리게 했다.
              뺀 뜻은 사라지지 않는다 — 이 서버가 들고 있지 않은 실행은
              store.read() 가 곧바로 interrupted 로 바꾸므로 상태 배지와 중단 패널이 말한다.
            */}
            {/* 언제 만든 브리핑인지. 목록에서 넘어오면 잊기 쉽다. */}
            <span className="mut">
              created <span className="ink">{stamp(s.created_at)}</span>
              {s.period && <> · period <span className="ink">{s.period.since} ~ {s.period.until}</span></>}
              {!s.period && <span className="fnt"> · period 기록 없음</span>}
            </span>
          </div>
        </div>

        {/* ─────────────────────────── 계기 3분할 */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: narrow ? 'minmax(0,1fr)' : 'repeat(auto-fit,minmax(280px,1fr))',
          borderBottom: '1px solid var(--line)',
        }}>
          {/* PROGRESS */}
          <div className="pane">
            <SectionHead label={`[ PROGRESS ] elapsed ${clock(elapsed)}`} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7, fontSize: 12 }}>
              {s.steps.map((st) => {
                const m = STEP_MARK[st.state];
                return (
                  <div key={st.label} style={{ display: 'grid', gridTemplateColumns: '18px minmax(0,1fr)', gap: 8 }}>
                    <span className={m.cls}>{m.g}</span>
                    <span className={st.state === 'current' ? 'ink' : 'mut'}>{st.label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* AXES */}
          <div className="pane">
            <SectionHead label="[ AXES ]" />
            {s.axes.collected ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 10, fontSize: 12 }}>
                  {s.axes.tiles.map((t) => (
                    <div className="tile" key={t.key}>
                      <div className="mut">
                        {t.key === 'dev' && s.links.repo
                          ? <Out href={`https://github.com/${s.links.repo}/issues`}
                              title={s.links.repo}>dev ↗</Out>
                          : t.key}
                      </div>
                      <div className="stat">
                        <span className="v">{t.value === null ? '—' : t.value}</span>{' '}
                        <span className={t.tone === 'mut' ? 'mut' : t.tone} style={{ fontSize: 11 }}>{t.note}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="note" style={{ marginTop: 11 }}>
                  unavailable_fields:{' '}
                  {s.axes.unavailable_fields.length === 0
                    ? <><span className="ok">[]</span> - 네 축 모두 값을 받았다</>
                    : <><span className="wrn">[{s.axes.unavailable_fields.join(', ')}]</span> - 조회하지 못했다. 0 이 아니다</>}
                </div>
                {/*
                  검색 출처는 카드가 인용하지 않아도 여기 남긴다.
                  트렌드 축의 «N hit» 이 어디서 왔는지 주소로 확인할 수 있어야 한다.
                */}
                {s.links.web.length > 0 && (
                  <div className="note" style={{ marginTop: 8 }}>
                    <span className="ok">출처</span>{' '}
                    {s.links.web.map((w, i) => (
                      <span key={w.url}>
                        {i > 0 && <span className="fnt"> · </span>}
                        <Out href={w.url} title={w.url}>{w.title}</Out>
                        {w.published_at
                          ? <span className="fnt"> {w.published_at}</span>
                          : <span className="wrn"> 게시일 미확인</span>}
                      </span>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="note">아직 도구를 부르지 않았다 - 네 축 값이 없다.</div>
            )}
          </div>

          {/* BUDGET ↔ USAGE */}
          <div
            className="pane"
            style={{ touchAction: 'pan-y' }}
            onPointerDown={(e) => { swipeX.current = e.clientX; }}
            onPointerUp={(e) => {
              if (swipeX.current !== null && Math.abs(e.clientX - swipeX.current) > 36) {
                setMeter((p) => (p === 'budget' ? 'usage' : 'budget'));
              }
              swipeX.current = null;
            }}
          >
            <SectionHead
              label={meter === 'budget'
                ? '[ BUDGET ] limits'
                : known ? '[ USAGE ] cost_is_estimate: true' : '[ USAGE ] usage_known: false'}
              hint={meter === 'budget' && lim
                ? `반복 ${lim.maxTurns}회 상한은 SDK 가 검사한다 - 이 화면은 실제 턴 수를 관측할 수 없어 게이지로 그리지 않는다`
                : undefined}
              right={
                <span className="row" style={{ gap: 6 }}>
                  <button className="dot" title="BUDGET" aria-pressed={meter === 'budget'} onClick={() => setMeter('budget')} />
                  <button className="dot" title="USAGE" aria-pressed={meter === 'usage'} onClick={() => setMeter('usage')} />
                </span>
              }
            />
            {meter === 'budget' ? (
              lim ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9, fontSize: 11.5 }}>
                  {/* 단서는 문단이 아니라 각 줄의 툴팁에 둔다 (마우스를 올리면 나온다). */}
                  <Gauge label="cost (est)" value={known && u ? u.total_cost_usd : null}
                    max={lim.maxBudgetUsd} prefix="$" digits={2} tone="ok"
                    hint="SDK 로컬 추정값 · 종료 조건 판정용. 실제 청구액이 아니다" />
                  <Gauge label="tool calls" value={toolCalls} max={lim.maxToolCalls}
                    hint="이 실행이 부른 도구 수. 상한에 닿으면 stopped 로 멈춘다" />
                  <Gauge label="fresh input" value={freshInput} max={lim.maxInputTokens}
                    hint="캐시 읽기를 뺀 입력 토큰 · 상한이 재는 값이다" />
                  <Gauge label="wall clock" value={Math.round(elapsed)} max={lim.maxElapsedSeconds} unit="s"
                    hint="엔진이 잰 실행 시간 · 사람을 기다린 시간은 빠져 있다" />
                </div>
              ) : <div className="note">상한이 기록되지 않았다 - 이 실행은 상한을 남기기 전 버전이다.</div>
            ) : (
              known && u ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 10 }}>
                    <div className="stat"><div className="k">input</div><div className="v">{u.input_tokens.toLocaleString()}</div></div>
                    <div className="stat"><div className="k">cache read</div><div className="v">{u.cache_read_input_tokens.toLocaleString()}</div></div>
                    <div className="stat"><div className="k">output</div><div className="v">{u.output_tokens.toLocaleString()}</div></div>
                    <div className="stat"><div className="k">cost (est)</div><div className="v">${u.total_cost_usd.toFixed(4)}</div></div>
                  </div>
                  <div className="note">
                    <span data-tip="SDK 가 번들된 단가표로 로컬 계산한다. 단가 변경·모델 미인식에서 실제 청구와 어긋날 수 있다"
                      aria-label="cost 는 SDK 가 번들된 단가표로 로컬 계산한 추정값이다">
                      cost 는 <span className="ink">추정값</span>이다
                    </span>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                  <div style={{ border: '1px solid var(--warn)', padding: '11px 13px' }}>
                    <div className="k mut" style={{ fontSize: 11 }}>토큰 · 비용</div>
                    <div className="wrn" style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.5 }}>확인 못 함</div>
                  </div>
                  <div className="note">
                    {u?.unknown_reason ?? '아직 집계되지 않았다.'}{' '}
                    토큰은 이미 썼으므로 <span className="ink">0 으로 적지 않는다.</span>
                    {u && u.cache_read_input_tokens > 0 && <>
                      <br />아는 값: 캐시 읽기 <span className="ink">{u.cache_read_input_tokens.toLocaleString()}</span> 토큰
                    </>}
                  </div>
                </div>
              )
            )}
            <div className="note" style={{ color: 'var(--faint)', marginTop: 11 }}>
              ← 옆으로 밀어 {meter === 'budget' ? 'USAGE' : 'BUDGET'} 보기
            </div>
          </div>
        </div>

        {/* ─────────────────────────── 서버가 거절한 요청 */}
        {conflict && (
          <div className="strip warn" style={{ display: 'flex', gap: 11, alignItems: 'flex-start' }}>
            <span className="wrn">✕</span>
            <div style={{ minWidth: 0 }}>
              <div><b>요청이 거절됐다</b> - <span className="wrn">{conflict.code}</span> <span className="mut">HTTP 409</span></div>
              <div className="mut">{conflict.message}</div>
            </div>
            <button style={{ marginLeft: 'auto' }} onClick={() => setConflict(null)}>dismiss</button>
          </div>
        )}

        {/* ─────────────────────────── 승인 게이트 */}
        {approvable && s.pending_approval && (
          <div className="strip bad">
            <div className="row" style={{ gap: 18, alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 280 }}>
                <div>
                  <span className="bad">!</span> <b>write tool 승인 대기</b>{' '}
                  <span className="bad">{s.pending_approval.tool}</span>{' '}
                  <span className="mut">v{s.pending_approval.version}</span>
                </div>
                {summaryLines(s.pending_approval.summary).map(([k, v]) => (
                  <div className="mut" key={k}>
                    {k}{' '}
                    {k === 'repo' && /^[\w.-]+\/[\w.-]+$/.test(v)
                      ? <Out href={`https://github.com/${v}`}>{v} ↗</Out>
                      : <span className="ink">{v}</span>}
                  </div>
                ))}
                <div className="mut">
                  승인하면 <span className="ink">1회용 토큰</span>을 주입해 실행한다 - 모델은 토큰을 받지 않는다
                </div>
                {/*
                  픽스처 실행은 simulated 로 끝나지만 live 는 실제 저장소를 바꾼다.
                  같은 버튼이 두 가지 다른 결과를 내므로, 어느 쪽인지 승인 **전에** 말한다.
                */}
                {s.fixture_id === null ? (
                  <div className="bad">
                    ⚠ live 모드다 - 승인하면{' '}
                    {s.links.repo
                      ? <Out href={`https://github.com/${s.links.repo}/issues`}>{s.links.repo}</Out>
                      : '실제 저장소'}
                    {' '}에 <b>진짜 이슈가 만들어진다.</b> 되돌리려면 revert_issue 로 닫아야 한다
                  </div>
                ) : (
                  <div className="mut">
                    fixture 모드다 - 승인해도 <span className="ink">실제 이슈는 만들어지지 않는다</span>
                    {' '}(<span className="fnt">simulated</span>)
                  </div>
                )}
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button onClick={() => setGate((v) => !v)}>--diff</button>
                <button className="primary" disabled={busy} onClick={() => void post('approvals', {
                  approval_id: s.pending_approval!.approval_id,
                  version: s.pending_approval!.version, approved: true,
                })}>approve</button>
                <button className="danger" disabled={busy} onClick={() => void post('approvals', {
                  approval_id: s.pending_approval!.approval_id,
                  version: s.pending_approval!.version, approved: false, reason: '화면에서 거절',
                })}>reject</button>
              </div>
            </div>
            {gate && <pre style={{ marginTop: 12 }}>{JSON.stringify(s.pending_approval.summary, null, 2)}</pre>}
          </div>
        )}

        {/* ─────────────────────────── 질문 게이트 */}
        {askable && s.pending_question && (
          <div className="strip warn">
            <div className="spread" style={{ flexWrap: 'wrap' }}>
              <div>
                <span className="wrn">?</span> <b>질문 대기</b>{' '}
                <span className="mut">ask_user · {s.pending_question.question_id} v{s.pending_question.version}</span>
              </div>
              <span className="note">답하기 전에는 다음 단계로 넘어가지 않는다 - 정상 상태다</span>
            </div>
            {s.pending_question.questions.map((q) => (
              <div key={q.question} style={{ marginTop: 12 }}>
                <div className="prose" style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--ink)', marginBottom: 10 }}>
                  {q.question}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(228px,1fr))', gap: 9 }}>
                  {q.options.map((o, i) => (
                    <button className="opt" key={o.label} disabled={busy} onClick={() => void post('answers', {
                      question_id: s.pending_question!.question_id,
                      version: s.pending_question!.version,
                      answers: { [q.question]: o.label },
                    })}>
                      <span className="l">{i + 1} · {o.label}</span>
                      {o.description && <span className="d">{o.description}</span>}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div className="note" style={{ marginTop: 10 }}>
              같은 question_id + version 은 한 번만 작업을 시작한다 - 두 번 눌러도 제작이 두 번 돌지 않는다
            </div>
          </div>
        )}

        {/* ─────────────────────────── 중단 — 콜백 소실 */}
        {s.status === 'interrupted' && (
          <div style={{ borderBottom: '1px solid var(--line)' }}>
            <div className="strip warn">
              <div className="row" style={{ gap: 18, alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 280 }}>
                  <div><span className="wrn">■</span> <b>중단됨</b> <span className="mut">이 서버가 이 실행을 들고 있지 않다</span></div>
                  <div className="mut">
                    서버를 재시작해 메모리에서 기다리던 <span className="ink">canUseTool</span> 콜백이 사라졌다.
                    상태만 고쳐도 작업은 이어지지 않는다.
                  </div>
                  <div className="mut">session_id <span className="ink">{s.session_id ?? '없음'}</span></div>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <button className="primary" disabled={busy || !s.session_id}
                    title={s.session_id ? '' : '이어갈 세션 ID 가 없다'}
                    onClick={() => void post('resume', { mode: 'resume' })}>--resume</button>
                  <button disabled={busy} style={{ fontSize: 12.5, fontWeight: 600, padding: '8px 14px' }}
                    onClick={() => void post('resume', { mode: 'retry' })}>--retry</button>
                </div>
              </div>
            </div>
            {(s.pending_question || s.pending_approval) && (
              <div style={{
                display: 'grid',
                gridTemplateColumns: narrow ? 'minmax(0,1fr)' : 'repeat(auto-fit,minmax(300px,1fr))',
                borderBottom: '1px solid var(--line-in)',
              }}>
                {s.pending_question && (
                  <div className="pane">
                    <SectionHead label="[ STALE QUESTION ] 무효" tone="mut" />
                    <div className="note">
                      이 질문을 기다리던 콜백이 사라졌다. 지금 답해도 작업은 이어지지 않는다 - 재개하면 에이전트가 다시 묻는다.
                    </div>
                    <pre style={{ marginTop: 9, color: 'var(--faint)' }}>
                      {s.pending_question.question_id} v{s.pending_question.version}
                      {'\n'}{s.pending_question.questions.map((q) => q.question).join('\n')}
                    </pre>
                  </div>
                )}
                {s.pending_approval && (
                  <div className="pane">
                    <SectionHead label="[ STALE APPROVAL ] 무효" tone="mut" />
                    <div className="note">
                      {s.pending_approval.tool} - 승인 토큰은 <span className="ink">발급되지 않았다</span>. 지금 승인해도 실행되지 않는다.
                    </div>
                    <div style={{ marginTop: 9, fontSize: 11.5, lineHeight: 1.8 }}>
                      <div className="fnt">무엇을 쓰려 했는지</div>
                      {summaryLines(s.pending_approval.summary).map(([k, v]) => (
                        <div className="mut" key={k}>{k} <span style={{ color: 'var(--faint)' }}>{v}</span></div>
                      ))}
                      <details style={{ marginTop: 7 }}>
                        <summary className="fnt">원문 펼쳐 보기</summary>
                        <pre style={{ marginTop: 6, color: 'var(--faint)' }}>
                          {JSON.stringify(s.pending_approval.summary, null, 2)}
                        </pre>
                      </details>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ─────────────────────────── 종료 조건 */}
        {s.stop_reason && (
          <div className="strip warn">
            <div>
              <span className="wrn">■</span> <b>종료 조건에 걸려 멈췄다</b>{' '}
              <span className="wrn">{s.stop_reason.limit}</span>
            </div>
            <div className="mut">
              {s.stop_reason.message} - 관측 <span className="ink">{s.stop_reason.observed}</span>
              {' '}/ 허용 <span className="ink">{s.stop_reason.allowed}</span>. 지금까지의 결과는 아래에 보존된다.
            </div>
            <div className="mut">
              모델의 「다 했다」 한 마디를 <span className="ink">done</span> 으로 처리하지 않는다 —
              이 실행의 상태는 <span className="wrn">stopped</span> 다.
            </div>
          </div>
        )}

        {/* ─────────────────────────── 사람이 결정한 것 */}
        <div style={{ borderBottom: '1px solid var(--line)' }}>
          <div style={{ padding: '14px 18px' }}>
            <SectionHead label={`[ DECIDED BY HUMAN ] ${s.answered.length + s.decisions.length}`} />
            {s.answered.length + s.decisions.length === 0 ? (
              <div className="note">
                아직 없다 - 답과 승인이 여기 쌓인다. 같은 질문을 다시 묻지 않기 위한 기록이다.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>
                {s.answered.map((a) => (
                  <div className="spread" key={a.question_id}
                    style={{ padding: '7px 0', borderBottom: '1px solid var(--line-faint)' }}>
                    <span className="mut">질문 답변 <span className="fnt">{a.question_id}</span></span>
                    <span className="ok">{Object.values(a.answers).join(' · ')}</span>
                  </div>
                ))}
                {s.decisions.map((d, i) => {
                  // 승인 기록은 순서대로 쌓이므로, n 번째 승인이 n 번째로 만들어진 이슈다.
                  const madeSoFar = s.decisions.slice(0, i + 1).filter((x) => x.approved).length;
                  const made = d.approved ? s.links.created[madeSoFar - 1] : undefined;
                  return (
                    <div className="spread" key={d.approval_id}
                      style={{ padding: '7px 0', borderBottom: '1px solid var(--line-faint)' }}>
                      <span className="mut">{d.tool} <span className="fnt">{d.approval_id}</span></span>
                      <span className={d.approved ? 'ok' : 'bad'}>
                        {d.approved ? '승인 - 토큰 주입해 실행' : `거절 - ${d.reason ?? '사람이 승인하지 않았다'}`}
                        {made && (made.url
                          ? <> · <Out href={made.url}>#{made.number} ↗</Out></>
                          : <> · <span className="wrn" title="fixture 모드다. 실제 이슈는 만들어지지 않았다">
                              #{made.number} (시뮬레이션)</span></>)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="note" style={{ marginTop: 10 }}>
              되돌리기(revert_issue)의 대상 범위는 이 기록이 정한다 · 같은 승인을 두 번 제출해도 이슈는 한 번만 만들어진다
            </div>
          </div>
        </div>

        {/* ─────────────────────────── 본문 2단 */}
        <div style={{ display: 'grid', gridTemplateColumns: bottomCols }}>
          <div style={{ padding: 18, minWidth: 0 }}>
            {view === 'card' ? (
              <CardsPane cards={s.cards} charts={s.charts} runId={s.run_id}
                links={s.links} exports={s.exports}
                exporting={s.cards_exporting === true} busy={busy} onExport={() => void exportCards()}
                onPreview={(at) => setPreviewAt(at)} />
            ) : (
              <div style={{ border: '1px solid var(--line)', background: 'var(--raised)' }}>
                <div className="spread" style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', fontSize: 11.5 }}>
                  <span className="ok">cat draft.md</span>
                  <button disabled={!s.final_text} onClick={() => {
                    void navigator.clipboard?.writeText(s.final_text ?? '');
                    setCopied(true); setTimeout(() => setCopied(false), 1500);
                  }}>{copied ? 'copied' : 'copy'}</button>
                </div>
                <pre style={{ border: 'none', padding: 16, background: 'transparent', color: 'var(--prose)', fontSize: 12.5 }}>
                  {s.final_text ?? '아직 원고가 없다. 실행이 끝나면 여기에 전문이 남는다.'}
                </pre>
              </div>
            )}
          </div>

          {showLog && (
            <div className="log">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11, marginBottom: 12 }}>
                <span className="sechead">
                  [ TAIL -F ] {s.trace.length} <span className="mut">· 최신순</span>
                </span>
                <span className={dead ? 'mut' : 'ok'}>
                  {dead ? '○ poll 정지 - 끝난 실행은 더 두드리지 않는다' : `● poll ${POLL_MS / 1000}s`}
                </span>
              </div>
              <div className="row" style={{ gap: 5, marginBottom: 12 }}>
                {(['all', 'tool', 'think', 'err'] as const).map((f) => (
                  <button className="chip" key={f} aria-pressed={filter === f}
                    onClick={() => { setFilter(f); setPage(0); }}
                    style={f === 'err' && counts.err > 0
                      ? { borderColor: 'rgba(226,96,75,.45)', color: 'var(--danger-ink)' } : undefined}>
                    {f}{f === 'all' ? '' : ` ${counts[f]}`}
                  </button>
                ))}
              </div>
              {/* 최신이 위라서 프롬프트도 위에 둔다 — 커서가 가장 최근 줄 바로 앞에 온다. */}
              <div className="ok" style={{ paddingBottom: 9 }}>➜{!dead && <Cursor />}</div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {pageItems.map((e) => {
                  const g = glyph(e);
                  return (
                    <div className="line" key={e.seq}>
                      <span className="when">{hhmmss(e.at)}</span>
                      <span className={g.cls}>{g.mark}</span>
                      <div style={{ minWidth: 0 }}>
                        <span className={e.isError ? 'bad' : 'ink'}>{e.label}</span>
                        {e.detail && (
                          <details>
                            <summary className="sub" style={{ fontSize: 11 }}>펼쳐 보기</summary>
                            <pre style={{ marginTop: 6 }}>{e.detail}</pre>
                          </details>
                        )}
                      </div>
                    </div>
                  );
                })}
                {shown.length === 0 && <div className="note">이 갈래에 해당하는 기록이 없다.</div>}
              </div>

              {shown.length > LOG_PAGE && (
                <div className="spread" style={{ marginTop: 12, alignItems: 'center' }}>
                  <button className="chip" disabled={safePage === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}>‹ newer</button>
                  <span className="note">
                    {safePage * LOG_PAGE + 1}–{safePage * LOG_PAGE + pageItems.length}
                    {' / '}{shown.length}
                    <span className="fnt"> · {safePage + 1}/{pageCount}</span>
                  </span>
                  <button className="chip" disabled={safePage >= pageCount - 1}
                    onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}>older ›</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {previewAt !== null && s.exports.png.length > 0 && (
        <CardModal runId={s.run_id} pages={s.exports.png} at={previewAt}
          onMove={setPreviewAt} onClose={() => setPreviewAt(null)} />
      )}
    </main>
  );
}

/** 카드가 있으면 카드를, 없으면 차트만이라도 보여준다. 둘 다 없으면 왜 없는지 적는다. */
function CardsPane({ cards, charts, runId, links, exports: ex, exporting, busy, onExport, onPreview }: {
  cards: CardView[]; charts: { card_no: number; svg_path: string }[];
  runId: string; links: RunLinks; exports: ExportView;
  exporting: boolean; busy: boolean; onExport: () => void; onPreview: (at: number) => void;
}) {
  const chartOf = (p?: string) => charts.find((c) => c.svg_path === p);

  if (cards.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <SectionHead label={`[ CARDS ] ${charts.length}`} tone="mut"
          right={<span className="note">근거 없는 수치는 카드에 오르지 않는다</span>} />
        <div style={{ padding: '10px 12px', border: '1px solid var(--line)', background: 'var(--raised)' }}>
          <ExportBar runId={runId} ex={ex} cardCount={0}
            exporting={exporting} busy={busy} onExport={onExport} onPreview={onPreview} />
        </div>
        {charts.length === 0 ? (
          <div className="hatch" style={{ padding: '26px 20px', textAlign: 'center' }}>
            <div className="note" style={{ fontSize: 12.5, lineHeight: 1.9 }}>
              storyboard · render_chart · compose_card 가 아직 돌지 않았다<br />
              <span className="ink">근거 대조를 통과한 값만 카드에 오른다</span>
            </div>
          </div>
        ) : charts.map((c) => (
          <figure key={c.card_no} style={{ margin: 0 }}>
            <div className="frame">
              <img className="chart" src={`/api/runs/${runId}/${c.svg_path}`} alt={`카드 ${c.card_no} 차트`} />
            </div>
            <figcaption className="note" style={{ marginTop: 6 }}>
              card {String(c.card_no).padStart(2, '0')} · render_chart · 근거 대조 통과
            </figcaption>
          </figure>
        ))}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <SectionHead label={`[ CARDS ] ${cards.length}`}
        right={<span className="note">근거 없는 수치는 카드에 오르지 않는다</span>} />
      {/* PRD 1절의 세 갈래와 화면의 딱지가 어떻게 대응하는지 밝힌다. */}
      <div className="note" style={{ marginTop: -4 }}>
        <span style={{ color: SEVERITY.FIX_NOW.ink }}>FIX_NOW</span> 지금 손봐야 할 것{' · '}
        <span style={{ color: SEVERITY.WATCH.ink }}>WATCH</span> 지켜볼 것{' · '}
        <span className="mut">FYI</span> 알아둘 것
        <span className="fnt">{' · METRICS 는 차트가 붙은 지표 카드다'}</span>
      </div>
      {links.snapshot && (links.issues.length > 0 || links.pulls.length > 0) && (
        <div className="note" style={{ marginTop: -4 }}>
          이슈·PR 링크는 <span className="wrn">픽스처 스냅샷</span>의 참조다 —
          실제 저장소에는 없을 수 있다.
        </div>
      )}
      <div style={{ padding: '10px 12px', border: '1px solid var(--line)', background: 'var(--raised)' }}>
        <ExportBar runId={runId} ex={ex} cardCount={cards.length}
          exporting={exporting} busy={busy} onExport={onExport} onPreview={onPreview} />
      </div>
      {cards.map((c) => {
        const sev = SEVERITY[c.severity];
        const chart = chartOf(c.chart_path);
        return (
          <div className="card" key={c.card_no} style={{ borderLeftColor: sev.line }}>
            <div className="row" style={{ gap: 9, marginBottom: 9, fontSize: 11 }}>
              <span className="cardkind" style={{ background: sev.bg, color: sev.ink }}>{c.severity}</span>
              <span className="mut">card {String(c.card_no).padStart(2, '0')}</span>
              {(() => {
                // 같은 그림을 열 길을 하나로 모은다 — 모달 안에 내려받기가 있다.
                const at = ex.png.findIndex((p) => p.card_no === c.card_no);
                if (at < 0) return null;
                return (
                  <button className="chip" style={{ marginLeft: 'auto' }}
                    onClick={() => onPreview(at)}>png ↗</button>
                );
              })()}
            </div>
            <h3>{linkRefs(c.title, links)}</h3>
            {c.body.length > 0 && (
              <div className="body">
                {c.body.map((line, i) => <div key={i}>{linkRefs(line, links)}</div>)}
              </div>
            )}
            {chart && (
              <div className="frame" style={{ marginTop: 11 }}>
                <img className="chart" src={`/api/runs/${runId}/${chart.svg_path}`} alt={`카드 ${c.card_no} 차트`} />
              </div>
            )}
            {c.sources.length > 0 && (
              <div className="src">
                <div>근거 {c.sources.map((x, i) => (
                  <span key={i}>{i > 0 && ' · '}<span className="ok">{x}</span></span>
                ))}</div>
                {webSourcesFor(c, links).map((w) => (
                  <div key={w.url} style={{ marginTop: 4 }}>
                    ↗ <Out href={w.url}>{w.title}</Out>
                    {w.published_at
                      ? <span className="fnt"> · {w.published_at}</span>
                      : <span className="wrn"> · 게시일 미확인</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function credLine(src?: 'api_key' | 'auth_token' | 'stored_login' | 'opencode'): string {
  switch (src) {
    case 'api_key': return 'ANTHROPIC_API_KEY (API 크레딧에서 빠진다)';
    case 'auth_token': return 'ANTHROPIC_AUTH_TOKEN';
    case 'stored_login': return '저장된 로그인(구독)';
    case 'opencode': return 'opencode 자체 인증 (Anthropic 자격증명을 쓰지 않는다)';
    default: return '기록되지 않음';
  }
}

/** 승인 요약에서 사람이 먼저 봐야 하는 줄만 뽑는다. 전문은 --diff 로 본다. */
function summaryLines(summary: Record<string, unknown>): [string, string][] {
  const pick = ['repo', 'title', 'labels', 'issue_number', 'reason'];
  const out: [string, string][] = [];
  for (const k of pick) {
    const v = summary[k];
    if (v === undefined || v === null) continue;
    out.push([k, Array.isArray(v) ? `[${v.join(', ')}]` : String(v)]);
  }
  const src = summary.source as { tool?: unknown; field?: unknown } | undefined;
  if (src?.tool) out.push(['근거', `${String(src.tool)}${src.field ? ` → ${String(src.field)}` : ''}`]);
  return out;
}
