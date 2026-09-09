'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type Listing = {
  runs: { run_id: string; status: string; created_at: string; fixture_id: string | null }[];
  fixtures: string[];
  credential_source: 'api_key' | 'auth_token' | 'stored_login';
};

type Engine = 'claude' | 'opencode';

type Favorite = {
  id: string; fixture_id: string; focus: string;
  engine: Engine; model: string; created_at: string;
};

/** 픽스처 4종을 요청 프리셋으로 푼 추천 목록. 직접 입력 없이 한 번에 시작한다. */
const PRESETS: { fixture: string; name: string; desc: string; focus: string }[] = [
  { fixture: 'f1-normal', name: '평범한 주간 점검',
    desc: '문제가 없을 때 없다고 말하는지 확인한다. 억지 진단을 경계한다.', focus: '' },
  { fixture: 'f2-deploy-fail', name: '배포 실패 추적',
    desc: '실패한 배포와 빌드 오류 원문, 복구 여부를 카드로 확인한다.', focus: '시스템' },
  { fixture: 'f3-metric-drop', name: '지표 급감 살펴보기',
    desc: '전주 대비 추이는 보되 원인은 단정하지 않는지 확인한다.', focus: '사용자' },
  { fixture: 'f4-sparse', name: '자료 부족 브리핑',
    desc: '결측과 0을 구별하고 카드 수를 억지로 채우지 않는지 확인한다.', focus: '' },
];

const FAV_KEY = 'ops-briefing-favorites';

function loadFavorites(): Favorite[] {
  try {
    const raw = localStorage.getItem(FAV_KEY);
    const arr = raw ? JSON.parse(raw) as Favorite[] : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

export default function Home() {
  const [data, setData] = useState<Listing | null>(null);
  const [fixture, setFixture] = useState('f2-deploy-fail');
  const [focus, setFocus] = useState('');
  const [engine, setEngine] = useState<Engine>('claude');
  const [model, setModel] = useState('');
  const [freeModels, setFreeModels] = useState<{ id: string; name: string }[]>([]);
  const [modelsNote, setModelsNote] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setFavorites(loadFavorites());
    fetch('/api/runs').then((r) => r.json()).then((d: Listing) => {
      setData(d);
      if (d.fixtures.length && !d.fixtures.includes(fixture)) setFixture(d.fixtures[0]!);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // opencode를 고르면 무료 모델 목록을 가져온다. 직접 입력 대신 고르게 한다.
  useEffect(() => {
    if (engine !== 'opencode' || freeModels.length > 0 || modelsNote) return;
    setModelsNote('불러오는 중…');
    fetch('/api/opencode-models').then(async (r) => {
      const b = await r.json() as { models: { id: string; name: string }[]; error?: string };
      if (!r.ok || b.error) {
        setModelsNote(`목록을 가져오지 못했다 (${b.error ?? `HTTP ${r.status}`}). opencode 인증을 확인한다.`);
        return;
      }
      setFreeModels(b.models);
      if (b.models.length > 0) {
        setModel((m) => m || b.models[0]!.id);
        setModelsNote(null);
      } else {
        setModelsNote('무료 모델이 없다. opencode 인증(`opencode auth`)을 확인한다.');
      }
    }).catch(() => {
      setModelsNote('목록을 가져오지 못했다. opencode 인증을 확인한다.');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine]);

  function saveFavorites(next: Favorite[]) {
    setFavorites(next);
    try { localStorage.setItem(FAV_KEY, JSON.stringify(next)); } catch { /* 저장 실패는 무시 */ }
  }

  async function startRun(opts: { fixture_id: string; focus?: string; engine: Engine; model?: string }) {
    setStarting(true); setError(null);
    const res = await fetch('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fixture_id: opts.fixture_id,
        focus: opts.focus || undefined,
        engine: opts.engine,
        model: opts.model || undefined,
      }),
    });
    const body = await res.json();
    if (!res.ok) { setError(body.message ?? body.error); setStarting(false); return; }
    location.href = `/runs/${body.run_id}`;
  }

  function addFavorite() {
    const fav: Favorite = {
      id: `fav-${Date.now().toString(36)}`,
      fixture_id: fixture, focus, engine, model,
      created_at: new Date().toISOString(),
    };
    saveFavorites([fav, ...favorites].slice(0, 20));
  }

  return (
    <main>
      <h1>「이미 있어」 주간 운영 브리핑</h1>
      <p className="sub">
        시스템 상태 · 사용자 지표 · 개발 활동 · IT 트렌드 네 축을 읽어 카드뉴스 한 편으로 넘긴다.
      </p>

      {data && (
        <div className="panel">
          <strong>자격증명</strong>
          <p className="note">
            {data.credential_source === 'api_key'
              ? 'ANTHROPIC_API_KEY — 비용이 API 사용량 크레딧에서 빠진다.'
              : data.credential_source === 'auth_token'
                ? 'ANTHROPIC_AUTH_TOKEN 을 쓴다.'
                : '환경변수에 키가 없다 — SDK 가 저장된 로그인(구독)으로 시도한다.'}
            {' '}환경변수 키가 없다고 자격증명이 없다는 뜻은 아니므로 실행을 막지 않는다.
            {' '}Claude 크레딧이 바닥나면 아래 엔진에서 opencode를 고른다
            (opencode 자체 인증·모델을 쓴다).
          </p>
        </div>
      )}

      <h2>추천 브리핑</h2>
      <p className="note">픽스처 4종을 요청서로 풀었다. 고르면 바로 시작한다.</p>
      <div className="panel">
        {PRESETS.map((p) => (
          <div key={p.fixture} className="spread" style={{ padding: '8px 0' }}>
            <span>
              <strong>{p.name}</strong>
              <span className="note" style={{ display: 'block' }}>
                {p.fixture} · {p.desc}
                {p.focus ? ` 깊게 볼 축: ${p.focus}` : ' 깊게 볼 축: 에이전트 판단'}
              </span>
            </span>
            <button onClick={() => void startRun({ fixture_id: p.fixture, focus: p.focus, engine, model })}
              disabled={starting}>
              시작
            </button>
          </div>
        ))}
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>직접 입력</h2>
        <div className="row">
          <label style={{ flex: 1, minWidth: 220 }}>
            <span className="note" style={{ display: 'block' }}>깊게 볼 축 (비우면 에이전트가 판단)</span>
            <input type="text" value={focus} onChange={(e) => setFocus(e.target.value)}
              placeholder="예: 시스템" style={{ width: '100%' }} />
          </label>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <label>
            <span className="note" style={{ display: 'block' }}>엔진</span>
            <select value={engine} onChange={(e) => setEngine(e.target.value as Engine)}>
              <option value="claude">claude (Agent SDK)</option>
              <option value="opencode">opencode (별도 인증·모델)</option>
            </select>
          </label>
          {engine === 'opencode' && (
            <label style={{ flex: 1, minWidth: 220 }}>
              <span className="note" style={{ display: 'block' }}>모델 (무료 목록에서 선택)</span>
              {freeModels.length > 0 ? (
                <select value={model} onChange={(e) => setModel(e.target.value)}
                  style={{ width: '100%' }}>
                  {freeModels.map((m) => (
                    <option key={m.id} value={m.id}>{m.name} ({m.id})</option>
                  ))}
                </select>
              ) : (
                <span className="note">{modelsNote ?? '불러오는 중…'}</span>
              )}
            </label>
          )}
        </div>
        {engine === 'opencode' && (
          <p className="note">
            opencode 모드는 질문 대기·승인 없이 끝까지 간다. 이슈 생성·되돌리기는 쓸 수 없고
            제안은 본문에 적힌다. 인증은 opencode 쪽 설정(`opencode auth`)을 따른다.
          </p>
        )}
        <div className="row" style={{ marginTop: 10 }}>
          <button className="primary" onClick={() => void startRun({ fixture_id: fixture, focus, engine, model })}
            disabled={starting}>
            {starting ? '시작하는 중…' : '브리핑 시작'}
          </button>
          <button onClick={addFavorite} disabled={starting} title="지금 입력값을 즐겨찾기에 저장">
            ★ 저장
          </button>
          {error && <span style={{ color: 'var(--danger)' }}>{error}</span>}
        </div>
        <p className="note">
          픽스처 모드다 — 외부 API 를 부르지 않고, 쓰기 도구도 실제 GitHub 을 바꾸지 않는다.
        </p>
      </div>

      {favorites.length > 0 && (
        <>
          <h2>즐겨찾기</h2>
          <div className="panel">
            {favorites.map((f) => (
              <div key={f.id} className="spread" style={{ padding: '8px 0' }}>
                <span>
                  <strong>{f.fixture_id}</strong>
                  <span className="note" style={{ display: 'block' }}>
                    {f.focus ? `깊게 볼 축: ${f.focus}` : '깊게 볼 축: 에이전트 판단'}
                    {` · 엔진: ${f.engine}`}{f.model ? ` · 모델: ${f.model}` : ''}
                  </span>
                </span>
                <span className="row">
                  <button onClick={() => void startRun({
                    fixture_id: f.fixture_id, focus: f.focus, engine: f.engine, model: f.model,
                  })} disabled={starting}>
                    시작
                  </button>
                  <button onClick={() => saveFavorites(favorites.filter((x) => x.id !== f.id))}>
                    삭제
                  </button>
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <h2>지난 실행</h2>
      {!data ? <p className="note">불러오는 중…</p>
        : data.runs.length === 0 ? <p className="note">아직 없다.</p> : (
        <div className="panel">
          {data.runs.map((r) => (
            <div key={r.run_id} className="spread" style={{ padding: '8px 0' }}>
              <Link href={`/runs/${r.run_id}`}>{r.run_id}</Link>
              <span className="row">
                <span className="note">{r.fixture_id ?? '실제'}</span>
                <span className={`badge ${r.status}`}>{r.status}</span>
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>픽스처</h2>
        <div className="row">
          <label>
            <span className="note" style={{ display: 'block' }}>평가·캡처 재현용 (직접 입력에 쓴다)</span>
            <select value={fixture} onChange={(e) => setFixture(e.target.value)}>
              {(data?.fixtures ?? []).map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
        </div>
      </div>
    </main>
  );
}
