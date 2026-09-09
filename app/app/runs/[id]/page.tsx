'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { use } from 'react';

type Trace = { seq: number; at: string; kind: string; label: string; detail?: string; isError?: boolean };
type Question = { question: string; header: string; options: { label: string; description: string }[] };
type State = {
  run_id: string; fixture_id: string | null; status: string; goal: string;
  engine?: 'claude' | 'opencode';
  session_id?: string; trace: Trace[];
  pending_question: { question_id: string; version: number; questions: Question[] } | null;
  pending_approval: { approval_id: string; version: number; tool: string; summary: Record<string, unknown> } | null;
  answered: { question_id: string; answers: Record<string, string> }[];
  decisions: { approval_id: string; tool: string; approved: boolean; reason?: string; at: string }[];
  usage: {
    usage_known: boolean; input_tokens: number; output_tokens: number;
    cache_read_input_tokens: number; total_cost_usd: number;
    cost_is_estimate: true; unknown_reason?: string;
  } | null;
  stop_reason?: { limit: string; message: string; observed: number; allowed: number };
  final_text?: string;
  charts: { card_no: number; svg_path: string }[];
  live: boolean;
  credential_source?: 'api_key' | 'auth_token' | 'stored_login';
};

const TERMINAL = new Set(['done', 'stopped', 'failed', 'interrupted']);

export default function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [s, setS] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const poll = useCallback(async () => {
    const res = await fetch(`/api/runs/${id}`, { cache: 'no-store' });
    if (res.ok) {
      const next = await res.json() as State;
      setS(next);
      // 끝난 실행은 더 두드리지 않는다.
      if (!TERMINAL.has(next.status)) timer.current = setTimeout(poll, 1200);
    }
  }, [id]);

  useEffect(() => {
    void poll();
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [poll]);

  async function post(path: string, body: unknown) {
    setBusy(true); setConflict(null);
    const res = await fetch(`/api/runs/${id}/${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setConflict(b.message ?? b.error ?? `요청 실패 (${res.status})`);
    }
    setBusy(false);
    void poll();
  }

  if (!s) return <main><p className="note">불러오는 중…</p></main>;

  const u = s.usage;

  return (
    <main>
      <div className="spread">
        <h1>{s.run_id}</h1>
        <span className={`badge ${s.status}`}>{s.status}</span>
      </div>
      <p className="sub">
        픽스처 {s.fixture_id ?? '실제'} · 엔진 {s.engine ?? 'claude'}
        {s.engine === 'opencode' && ' (질문·승인 없이 진행, 이슈 도구는 꺼짐)'}
        {' · '}{s.live ? '이 서버가 실행 중' : '이 서버가 들고 있지 않음'}
        {' · '}<Link href="/">목록</Link>
      </p>

      {conflict && (
        <div className="panel" style={{ borderColor: 'var(--warn)' }}>
          <strong>요청이 거절됐다</strong>
          <p className="note">{conflict}</p>
        </div>
      )}

      {/* ── 지난 질문 (중단돼 무효) ────────────────────────── */}
      {s.pending_question && !s.live && (
        <div className="panel">
          <strong className="note">걸려 있던 질문 (무효)</strong>
          <p className="note">
            이 질문을 기다리던 콜백이 사라졌다. 지금 답해도 작업은 이어지지 않는다.
            아래에서 재개하면 에이전트가 다시 묻는다.
          </p>
          <pre>{s.pending_question.questions.map((q) => q.question).join('\n')}</pre>
        </div>
      )}

      {/* ── 질문 대기 ─────────────────────────────────────── */}
      {s.pending_question && s.live && (
        <div className="panel" style={{ borderColor: 'var(--warn)' }}>
          <div className="spread">
            <strong>질문 대기</strong>
            <span className="note">버전 {s.pending_question.version}</span>
          </div>
          <p className="note">답하기 전에는 다음 단계로 넘어가지 않는다. 이 상태는 정상이다.</p>
          {s.pending_question.questions.map((q) => (
            <div key={q.question} style={{ marginTop: 14 }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>{q.question}</div>
              {q.options.map((o) => (
                <button key={o.label} className="opt" disabled={busy}
                  onClick={() => post('answers', {
                    question_id: s.pending_question!.question_id,
                    version: s.pending_question!.version,
                    answers: { [q.question]: o.label },
                  })}>
                  <span className="l">{o.label}</span>
                  {o.description && <div className="d">{o.description}</div>}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* ── 지난 승인 요청 (중단돼 무효) ───────────────────── */}
      {s.pending_approval && !s.live && (
        <div className="panel">
          <strong className="note">걸려 있던 승인 요청 (무효) — {s.pending_approval.tool}</strong>
          <p className="note">
            기다리던 콜백이 사라져 지금 승인해도 실행되지 않는다. 승인 토큰은 발급되지 않았다.
          </p>
          <details><summary className="note">무엇을 쓰려 했는지</summary>
            <pre>{JSON.stringify(s.pending_approval.summary, null, 2)}</pre></details>
        </div>
      )}

      {/* ── 승인 대기 ─────────────────────────────────────── */}
      {s.pending_approval && s.live && (
        <div className="panel" style={{ borderColor: 'var(--danger)' }}>
          <div className="spread">
            <strong>⚠️ 승인 대기 — {s.pending_approval.tool}</strong>
            <span className="note">버전 {s.pending_approval.version}</span>
          </div>
          <p className="note">
            승인하면 1회용 토큰을 주입해 실행한다. 모델은 토큰을 받지 않으므로 스스로 실행할 수 없다.
          </p>
          <details open>
            <summary>무엇을 쓰려는지 (승인 전에 확인)</summary>
            <pre>{JSON.stringify(s.pending_approval.summary, null, 2)}</pre>
          </details>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="primary" disabled={busy}
              onClick={() => post('approvals', {
                approval_id: s.pending_approval!.approval_id,
                version: s.pending_approval!.version, approved: true,
              })}>승인하고 실행</button>
            <button className="danger" disabled={busy}
              onClick={() => post('approvals', {
                approval_id: s.pending_approval!.approval_id,
                version: s.pending_approval!.version, approved: false, reason: '화면에서 거절',
              })}>거절</button>
          </div>
        </div>
      )}

      {/* ── 중단 후 재개 ──────────────────────────────────── */}
      {s.status === 'interrupted' && (
        <div className="panel" style={{ borderColor: 'var(--warn)' }}>
          <strong>중단됨</strong>
          <p className="note">
            이 서버가 이 실행을 들고 있지 않다. 서버를 재시작했다면 메모리에서 기다리던 콜백이 사라진 것이다.
            저장된 맥락으로 재개하거나 처음부터 다시 돌린다.
          </p>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="primary" disabled={busy || !s.session_id}
              onClick={() => post('resume', { mode: 'resume' })}>
              세션으로 재개{!s.session_id && ' (세션 없음)'}
            </button>
            <button disabled={busy} onClick={() => post('resume', { mode: 'retry' })}>처음부터 재시도</button>
          </div>
        </div>
      )}

      {/* ── 종료 조건 ─────────────────────────────────────── */}
      {s.stop_reason && (
        <div className="panel" style={{ borderColor: 'var(--warn)' }}>
          <strong>종료 조건에 걸려 멈췄다 — {s.stop_reason.limit}</strong>
          <p className="note">
            {s.stop_reason.message} (관측 {s.stop_reason.observed} / 허용 {s.stop_reason.allowed})
          </p>
        </div>
      )}

      {/* ── 사용량 ────────────────────────────────────────── */}
      <h2>실행 비용</h2>
      <div className="panel">
        {!u ? <p className="note">아직 집계되지 않았다.</p>
          : !u.usage_known ? (
            <>
              <div className="stat" style={{ borderColor: 'var(--warn)' }}>
                <div className="k">토큰 · 비용</div>
                <div className="v">확인 못 함</div>
              </div>
              <p className="note">
                {u.unknown_reason} — 토큰은 이미 썼으므로 <strong>0 으로 적지 않는다.</strong>
                {u.cache_read_input_tokens > 0
                  && ` (아는 값: 캐시 읽기 ${u.cache_read_input_tokens.toLocaleString()} 토큰)`}
              </p>
            </>
          ) : (
            <>
              <div className="grid">
                <div className="stat"><div className="k">입력 토큰</div>
                  <div className="v">{u.input_tokens.toLocaleString()}</div></div>
                <div className="stat"><div className="k">캐시 읽기</div>
                  <div className="v">{u.cache_read_input_tokens.toLocaleString()}</div></div>
                <div className="stat"><div className="k">출력 토큰</div>
                  <div className="v">{u.output_tokens.toLocaleString()}</div></div>
                <div className="stat"><div className="k">비용 (추정)</div>
                  <div className="v">${u.total_cost_usd.toFixed(4)}</div></div>
              </div>
              <p className="note">
                비용은 <strong>클라이언트 측 추정값</strong>이다. SDK 가 번들된 단가표로 로컬 계산하며
                실제 청구액과 다를 수 있다. 참고와 종료 조건 판정에만 쓴다.
              </p>
              <p className="note">
                {s.credential_source === 'api_key'
                  ? '이 실행은 ANTHROPIC_API_KEY 로 돌았다 — API 사용량 크레딧에서 차감된다.'
                  : s.credential_source === 'stored_login'
                    ? '이 실행은 저장된 로그인(구독)으로 돌았다 — 위 금액은 토큰 추정치이며 API 크레딧에서 차감되지 않는다.'
                    : '이 실행의 자격증명 출처가 기록되지 않았다.'}
              </p>
            </>
          )}
      </div>

      {/* ── 결정 이력 ─────────────────────────────────────── */}
      {(s.decisions.length > 0 || s.answered.length > 0) && (
        <>
          <h2>사람이 결정한 것</h2>
          <div className="panel">
            {s.answered.map((a) => (
              <div key={a.question_id} className="spread" style={{ padding: '6px 0' }}>
                <span>질문 답변</span>
                <span className="note">{Object.values(a.answers).join(', ')}</span>
              </div>
            ))}
            {s.decisions.map((d) => (
              <div key={d.approval_id} className="spread" style={{ padding: '6px 0' }}>
                <span>{d.tool}</span>
                <span className={d.approved ? '' : 'note'}
                  style={{ color: d.approved ? 'var(--ok)' : 'var(--danger)' }}>
                  {d.approved ? '승인' : `거절 — ${d.reason ?? ''}`}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── 차트 ──────────────────────────────────────────── */}
      {s.charts.length > 0 && (
        <>
          <h2>생성된 카드 차트 ({s.charts.length}장)</h2>
          <div className="panel">
            {s.charts.map((c) => (
              <figure key={c.card_no} style={{ margin: '0 0 16px' }}>
                <img className="chart" alt={`카드 ${c.card_no} 차트`}
                  src={`/api/runs/${s.run_id}/${c.svg_path}`} />
                <figcaption className="note">
                  카드 {c.card_no} — 근거 대조를 통과한 값만 그려진다
                </figcaption>
              </figure>
            ))}
          </div>
        </>
      )}

      {/* ── 최종 원고 ─────────────────────────────────────── */}
      {s.final_text && (
        <>
          <h2>브리핑 원고</h2>
          <div className="panel"><pre>{s.final_text}</pre></div>
        </>
      )}

      {/* ── 실행 로그 ─────────────────────────────────────── */}
      <h2>실행 로그 ({s.trace.length}건)</h2>
      <div className="panel">
        <ul className="trace">
          {s.trace.map((e) => (
            <li key={e.seq}>
              <div className="spread">
                <span className={e.isError ? 'err' : ''}>{e.label}</span>
                <span className="when">{e.at.slice(11, 19)}</span>
              </div>
              {e.detail && (
                <details>
                  <summary className="note">펼쳐 보기</summary>
                  <pre>{e.detail}</pre>
                </details>
              )}
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
