'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type Listing = {
  runs: { run_id: string; status: string; created_at: string; fixture_id: string | null }[];
  fixtures: string[];
  engine_key: boolean;
};

export default function Home() {
  const [data, setData] = useState<Listing | null>(null);
  const [fixture, setFixture] = useState('f2-deploy-fail');
  const [focus, setFocus] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/runs').then((r) => r.json()).then((d: Listing) => {
      setData(d);
      if (d.fixtures.length && !d.fixtures.includes(fixture)) setFixture(d.fixtures[0]!);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startRun() {
    setStarting(true); setError(null);
    const res = await fetch('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fixture_id: fixture, focus: focus || undefined }),
    });
    const body = await res.json();
    if (!res.ok) { setError(body.message ?? body.error); setStarting(false); return; }
    location.href = `/runs/${body.run_id}`;
  }

  return (
    <main>
      <h1>「이미 있어」 주간 운영 브리핑</h1>
      <p className="sub">
        시스템 상태 · 사용자 지표 · 개발 활동 · IT 트렌드 네 축을 읽어 카드뉴스 한 편으로 넘긴다.
      </p>

      {data && !data.engine_key && (
        <div className="panel" style={{ borderColor: 'var(--danger)' }}>
          <strong>실행 엔진 키가 없다.</strong>
          <p className="note">
            저장소 루트의 <code>.env.local</code> 에 <code>ANTHROPIC_API_KEY</code> 를 넣어야 실행할 수 있다.
            형식은 <code>.env.local.example</code> 참고.
          </p>
        </div>
      )}

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>새 브리핑</h2>
        <div className="row">
          <label>
            <span className="note" style={{ display: 'block' }}>픽스처 (평가·캡처 재현용)</span>
            <select value={fixture} onChange={(e) => setFixture(e.target.value)}>
              {(data?.fixtures ?? []).map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
          <label style={{ flex: 1, minWidth: 220 }}>
            <span className="note" style={{ display: 'block' }}>깊게 볼 축 (비우면 에이전트가 판단)</span>
            <input type="text" value={focus} onChange={(e) => setFocus(e.target.value)}
              placeholder="예: 시스템" style={{ width: '100%' }} />
          </label>
        </div>
        <p className="note">
          픽스처 모드다 — 외부 API 를 부르지 않고, 쓰기 도구도 실제 GitHub 을 바꾸지 않는다.
        </p>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="primary" onClick={startRun} disabled={starting || !data?.engine_key}>
            {starting ? '시작하는 중…' : '브리핑 시작'}
          </button>
          {error && <span style={{ color: 'var(--danger)' }}>{error}</span>}
        </div>
      </div>

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
    </main>
  );
}
