'use client';

/** 카드 목록과 그 둘레 - 미리보기 모달, 내보내기 줄. 굽기는 사람이 누를 때만 돈다 (D27). */
import { useEffect } from 'react';
import { Lights, SectionHead } from '@/components/term';
import type { CardView, ExportView, RunDetail, RunLinks } from '@/lib/types';
import { Out, linkRefs } from './links';
import { SEVERITY, kb, webSourcesFor } from './format';

/**
 * 카드 미리보기 모달.
 *
 * 새 탭 대신 모달인 이유: 카드를 넘겨 가며 훑는 일이라 탭을 오갈 필요가 없다.
 * ←/→ 로 넘기고 Esc 로 닫는다 — 키보드만으로도 다 된다.
 */
export function CardModal({ runId, pages, at, onMove, onClose }: {
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
export function ExportBar({ runId, ex, cardCount, exporting, busy, onExport, onPreview }: {
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

/** 카드가 있으면 카드를, 없으면 차트만이라도 보여준다. 둘 다 없으면 왜 없는지 적는다. */
export function CardsPane({ cards, charts, runId, links, exports: ex, exporting, busy, onExport, onPreview }: {
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
            {c.sources.length > 0 && (() => {
              const web = webSourcesFor(c, links);
              return (
                <details className="src fold">
                  {/* 열지 않아도 몇 건인지는 보인다 - 근거가 붙어 있다는 사실이 이 카드의 자격이다. */}
                  <summary>
                    <span>
                      <span className="ok">근거</span> <span className="ink">{c.sources.length}</span>
                      {web.length > 0 && <>
                        <span className="fnt"> · </span>
                        <span className="ok">링크</span> <span className="ink">{web.length}</span>
                      </>}
                    </span>
                  </summary>
                  <div style={{ marginTop: 6 }}>
                    {c.sources.map((x, i) => (
                      <div key={i} style={{ marginTop: i === 0 ? 0 : 3 }}><span className="ok">{x}</span></div>
                    ))}
                    {web.map((w) => (
                      <div key={w.url} style={{ marginTop: 4 }}>
                        ↗ <Out href={w.url}>{w.title}</Out>
                        {w.published_at
                          ? <span className="fnt"> · {w.published_at}</span>
                          : <span className="wrn"> · 게시일 미확인</span>}
                      </div>
                    ))}
                  </div>
                </details>
              );
            })()}
          </div>
        );
      })}
    </div>
  );
}
