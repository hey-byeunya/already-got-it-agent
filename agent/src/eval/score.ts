/**
 * 자동 채점 (EVAL.md).
 *
 * 자유 문장을 채점하려면 무엇을 **믿을 수 있게** 잴 수 있는지부터 정해야 한다.
 * 여기서는 "픽스처의 값과 대조해 기계가 판정할 수 있는 것"만 잰다.
 * 나머지는 수동 항목으로 남기고 결과표에 그렇게 표시한다 —
 * 자동화한 척하면 숫자가 무의미해진다.
 *
 * ## 자동으로 재는 것
 *
 *  1. ID 환각      dpl_*, 커밋 SHA(7자 hex), 이슈 #N 이 픽스처에 있는가
 *  2. 지표 값 환각  지표 낱말 옆의 숫자가 그 지표의 실제 값 집합에 있는가
 *  3. 결측 오독     unavailable_fields 항목을 0 이나 "정상"으로 서술했는가
 *  4. 필수 신호 누락 must_include 의 핵심 토큰이 원고에 나오는가 (토큰 대리 지표)
 *
 * ## 자동으로 재지 않는 것 (수동)
 *
 *  - 근거 미표기율 · 과잉 단정률 · 우선순위 적중
 *    문장 단위 판단이 필요하다. 정규식으로 흉내내면 숫자만 그럴듯해진다.
 *
 * 숫자를 통째로 훑지 않고 **지표 낱말 옆의 숫자**만 보는 이유:
 * 원고에는 정당하게 파생된 숫자가 섞인다 — 경과 분, 백분율, 카드 번호, 날짜.
 * 전부 대조하면 정상 서술이 환각으로 잡혀 지표가 쓸모없어진다.
 */

export type Fixture = {
  id: string;
  get_system_health?: unknown;
  get_user_metrics?: unknown;
  get_dev_activity?: unknown;
  web_search?: unknown;
  expected?: {
    must_include?: string[];
    must_not_claim?: string[];
    top_signal?: string;
    unavailable_fields?: string[];
    [k: string]: unknown;
  };
};

/** 지표 낱말 → 그 지표의 실제 값이 있는 픽스처 경로들. */
const METRIC_PATHS: { keywords: string[]; paths: string[]; label: string }[] = [
  { label: '가입', keywords: ['가입', '신규가입'],
    paths: ['get_user_metrics.series[].signups', 'get_user_metrics.totals.signups',
            'get_user_metrics.previous_period_totals.signups'] },
  { label: '활성 사용자', keywords: ['활성'],
    paths: ['get_user_metrics.series[].active_users', 'get_user_metrics.totals.active_users',
            'get_user_metrics.previous_period_totals.active_users'] },
  { label: '있템 등록', keywords: ['있템', '오너드', 'owned'],
    paths: ['get_user_metrics.series[].owned_created', 'get_user_metrics.totals.owned_created',
            'get_user_metrics.previous_period_totals.owned_created'] },
  { label: '위시 등록', keywords: ['위시'],
    paths: ['get_user_metrics.series[].wish_created', 'get_user_metrics.totals.wish_created',
            'get_user_metrics.previous_period_totals.wish_created'] },
  { label: '함수 오류', keywords: ['함수 오류', '함수오류'],
    paths: ['get_system_health.function_errors.count'] },
  { label: '배포', keywords: ['배포'],
    paths: ['get_system_health.summary.total', 'get_system_health.summary.ready',
            'get_system_health.summary.error'] },
  // '이슈' 만으로 잡으면 "이슈 생성 제안 1건" 처럼 정당한 서술이 걸린다.
  // 픽스처 값을 주장하는 표현으로 좁힌다. (첫 평가 시행에서 발견)
  { label: '열린 이슈 수', keywords: ['열린 이슈', '미해결 이슈', '오픈 이슈', '이슈 수'],
    paths: ['get_dev_activity.summary.open_issue_count'] },
  { label: '이슈 경과일', keywords: ['경과일', '일째', '방치'],
    paths: ['get_dev_activity.open_issues[].age_days',
            'get_dev_activity.summary.oldest_open_issue_days'] },
  { label: '머지', keywords: ['머지', '병합'],
    paths: ['get_dev_activity.summary.merged_this_period'] },
  { label: '커밋', keywords: ['커밋'],
    paths: ['get_dev_activity.commits.count'] },
];

/** `a.b[].c` 경로를 풀어 숫자만 모은다. */
export function resolveNumbers(root: unknown, path: string): number[] {
  let current: unknown[] = [root];
  for (const raw of path.split('.')) {
    const m = /^([A-Za-z0-9_]+)(\[\])?$/.exec(raw);
    if (!m) return [];
    const [, key, arr] = m;
    const next: unknown[] = [];
    for (const node of current) {
      if (node === null || typeof node !== 'object') continue;
      const v = (node as Record<string, unknown>)[key!];
      if (v === undefined || v === null) continue;
      if (arr) { if (Array.isArray(v)) next.push(...v); }
      else next.push(v);
    }
    current = next;
  }
  return current.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
}

/** 픽스처 전체에서 문자열 식별자를 긁어모은다. */
export function collectIdentifiers(fx: Fixture): { deploys: Set<string>; shas: Set<string>; issues: Set<number> } {
  const deploys = new Set<string>();
  const shas = new Set<string>();
  const issues = new Set<number>();
  const walk = (v: unknown): void => {
    if (v === null) return;
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (typeof v === 'object') { Object.values(v as Record<string, unknown>).forEach(walk); return; }
    if (typeof v === 'string') {
      if (/^dpl_[A-Za-z0-9]+$/.test(v)) deploys.add(v);
      if (/^[0-9a-f]{7,40}$/.test(v)) shas.add(v.slice(0, 7));
    }
  };
  walk(fx.get_system_health); walk(fx.get_user_metrics);
  walk(fx.get_dev_activity); walk(fx.web_search);
  for (const n of resolveNumbers(fx, 'get_dev_activity.open_issues[].number')) issues.add(n);
  return { deploys, shas, issues };
}

export type Hallucination = { kind: 'deploy_id' | 'commit_sha' | 'issue_number' | 'metric_value';
  value: string; metric?: string; context?: string };

/** 숫자 하나를 쉼표 없는 형태로. "1,234" → 1234 */
const toNum = (s: string) => Number(s.replace(/,/g, ''));

/**
 * 환각 탐지 결과를 **신뢰도로 나눠** 돌려준다.
 *
 * `identifiers` — 배포 ID·커밋 SHA·이슈 번호. 정확한 문자열 일치라 판정이 확실하다.
 * `metricCandidates` — 지표 낱말 옆의 숫자. **사람 확인이 필요한 후보다.**
 *
 * 왜 나누는가: 12시행 동안 지표 값 규칙은 **진짜 환각 0건, 허수 9건**을 냈다.
 * 자유 문장에서 "이 숫자가 그 지표의 값인가"를 정규식이 안정적으로 판정하지 못한다.
 * 같은 표에 섞어 세면 신뢰할 수 있는 식별자 판정까지 흐려진다.
 */
export function findHallucinations(text: string, fx: Fixture, opts: { allowIssues?: number[] } = {}): {
  identifiers: Hallucination[]; metricCandidates: Hallucination[];
} {
  const out: Hallucination[] = [];
  const metricCandidates: Hallucination[] = [];
  const ids = collectIdentifiers(fx);
  const allowedIssues = new Set([...ids.issues, ...(opts.allowIssues ?? [])]);

  // ① 배포 ID — dpl_ 로 시작하면 형태가 어떻든 대조한다.
  //    ASCII 만 보면 이상한 형태의 환각을 조용히 놓친다.
  for (const m of text.matchAll(/dpl_[^\s`'",.)\]}]+/g)) {
    if (!ids.deploys.has(m[0])) out.push({ kind: 'deploy_id', value: m[0] });
  }
  // ② 커밋 SHA — 백틱 안의 7자 hex 만 본다 (일반 낱말과 섞이지 않게)
  for (const m of text.matchAll(/`([0-9a-f]{7})`/g)) {
    if (!ids.shas.has(m[1]!)) out.push({ kind: 'commit_sha', value: m[1]! });
  }
  // ③ 이슈 번호 — **"이슈"/"issue" 라는 낱말이 앞 12자 안에 있을 때만** 이슈 참조로 본다.
  //    그냥 `#3` 은 카드 번호·목록 표시·제목일 수 있다.
  //    (첫 평가 시행에서 #1·#3·#5 를 이슈 번호로 잡아 환각 3건이 허수로 잡혔다.)
  for (const m of text.matchAll(/#(\d{1,5})\b/g)) {
    const before = text.slice(Math.max(0, m.index - 12), m.index);
    if (!/(이슈|issue)/i.test(before)) continue;
    const n = Number(m[1]);
    if (!allowedIssues.has(n)) out.push({ kind: 'issue_number', value: String(n) });
  }
  // ④ 지표 낱말 옆의 숫자
  for (const spec of METRIC_PATHS) {
    const allowed = new Set<number>();
    for (const p of spec.paths) for (const n of resolveNumbers(fx, p)) allowed.add(n);
    // 이슈 지표는 승인해 만든 이슈 번호도 허용한다 (③과 같은 범위를 봐야 한다)
    if (spec.label.startsWith('열린 이슈')) for (const n of allowedIssues) allowed.add(n);
    if (allowed.size === 0) continue;  // 픽스처에 그 지표가 없으면 대조하지 않는다

    for (const kw of spec.keywords) {
      for (const km of text.matchAll(new RegExp(kw, 'g'))) {
        // 낱말 뒤 30자만 보고, **문장 경계에서 자른다.**
        //
        // 가장 가까운 개수 하나만 봐도 창이 문장을 넘어가면 다음 지표의 숫자를 집어온다 —
        //   "배포·빌드는 정상. 함수 오류 3건" → 3 을 배포 수로 봤다
        //   "…일째, bug). 커밋 14건"        → 14 를 이슈 경과일로 봤다
        // 둘 다 실제 평가 시행에서 나온 허수다.
        const raw = text.slice(km.index + km[0].length, km.index + km[0].length + 30);
        const cut = raw.search(/[.\n!?]/);
        const window = cut >= 0 ? raw.slice(0, cut) : raw;

        // **개수 단위가 붙은 숫자만** 본다.
        //
        // "낱말 뒤 첫 숫자"로 잡았더니 날짜와 기간이 걸렸다 —
        //   "함수 오류 7일 3건" → 7 을 건수로 봤다 (실제 건수는 3)
        //   "활성 사용자, 9월"  → 9 를 값으로 봤다
        // 단위를 요구하면 이런 허수가 사라진다. 대신 단위 없이 쓴 수치("가입 17")는
        // 놓칠 수 있다 — **과소 보고 쪽으로 기운다.** 지표를 오염시키는 것보다 낫다고 판단했다.
        // **낱말에 가장 가까운 첫 개수만** 본다.
        // 창 안의 모든 개수를 보면 다음 지표의 숫자까지 끌어온다 —
        //   "함수 오류 3건. 가입 19명" → 19 를 함수 오류 값으로 봤다
        // **개수 단위가 붙은 숫자가 창의 첫 숫자여야 한다.**
        //
        // 지표 값을 단위 없이 쓰는 형식이 있다 —
        //   "활성 사용자 41(43) — 4개 차트" → 41 에 단위가 없어 규칙이 뒤의 "4개"(차트 수)를 집었다
        // 첫 숫자가 아니면 그 낱말의 값은 단위 없이 쓰인 것이므로 **판정하지 않는다.**
        // 과소 보고 쪽으로 한 번 더 기운다.
        const firstNum = /[0-9]/.exec(window);
        const nm = /([0-9][0-9,]*)\s*(건|명|회|개)(?![월일년주간])/.exec(window);
        if (nm && nm.index !== undefined && firstNum && nm.index === firstNum.index) {
          const before = window[nm.index - 1];
          if (before !== '#') {          // 식별자는 ③이 이미 봤다
            const n = toNum(nm[1]!);
            if (!allowed.has(n)) {
              metricCandidates.push({ kind: 'metric_value', value: String(n), metric: spec.label,
                context: `${km[0]}${window.slice(0, nm.index + nm[0].length)}`
                  .replace(/\s+/g, ' ').slice(0, 60) });
            }
          }
        }
      }
    }
  }
  return { identifiers: out, metricCandidates };
}

export type MissingReadCandidate = { field: string; evidence: string; sentence: string };
export type MissingReadCleared = { field: string; sentence: string; marker: string };

/**
 * 불확실성 표시. 이 낱말이 **같은 문장에** 있으면 오독이 아니라 올바른 서술로 본다.
 *
 * 첫 실제 시행에서 모델이 이렇게 썼다 —
 *   "함수 오류를 **못** 봤으므로 '이번 주 문제 없다'고 말할 수 없다"
 * 규칙이 문장 안의 "문제 없"만 보고 오독으로 판정했다. 정확히 올바른 서술을 벌점 준 것이다.
 */
const UNCERTAINTY_MARKERS = [
  '못', '미확인', '조회하지', '확인하지', '알 수 없', '말할 수 없', '단정',
  'available: false', 'null', '결측', '없어서', '없으므로', '않는다', '아니다',
];

/** 매치 지점을 포함하는 문장만 잘라 낸다. 문장을 넘어가면 엉뚱한 부정을 끌어온다. */
export function sentenceAround(text: string, index: number): string {
  const isBoundary = (c: string) => c === '.' || c === '\n' || c === '!' || c === '?';
  let start = index;
  while (start > 0 && !isBoundary(text[start - 1]!)) start -= 1;
  let end = index;
  while (end < text.length && !isBoundary(text[end]!)) end += 1;
  return text.slice(start, end).trim();
}

/**
 * 결측을 0 이나 "정상"으로 서술했는지 본다.
 *
 * 필드별로 낱말 규칙을 둔다. 규칙이 없는 필드는 **판정하지 않고 미확인으로 남긴다** —
 * 없는 규칙을 통과로 세면 지표가 후해진다.
 */
const MISSING_RULES: Record<string, { keywords: string[]; badPatterns: RegExp[] }> = {
  'function_errors.count': {
    keywords: ['함수 오류', '함수오류'],
    badPatterns: [/함수\s*오류[^.\n]{0,20}(0\s*건|없|정상|문제\s*없)/],
  },
  previous_period_totals: {
    keywords: ['전주', '지난주', '전 기간'],
    badPatterns: [/(전주|지난주)[^.\n]{0,30}(대비|보다)[^.\n]{0,20}(증가|감소|늘|줄)/],
  },
};

export function findMissingMisreads(text: string, fx: Fixture): {
  candidates: MissingReadCandidate[]; cleared: MissingReadCleared[]; unchecked: string[];
} {
  const candidates: MissingReadCandidate[] = [];
  const cleared: MissingReadCleared[] = [];
  const unchecked: string[] = [];
  const unavailable = new Set<string>();

  const collect = (v: unknown): void => {
    if (v && typeof v === 'object' && 'unavailable_fields' in (v as Record<string, unknown>)) {
      const arr = (v as Record<string, unknown>).unavailable_fields;
      if (Array.isArray(arr)) for (const f of arr) if (typeof f === 'string') unavailable.add(f);
    }
  };
  collect(fx.get_system_health); collect(fx.get_user_metrics);
  // previous_period_totals 가 null 인 것도 결측이다
  const upm = fx.get_user_metrics as Record<string, unknown> | undefined;
  if (upm && upm.previous_period_totals === null) unavailable.add('previous_period_totals');

  for (const field of unavailable) {
    const key = Object.keys(MISSING_RULES).find((k) => field.includes(k));
    if (!key) { unchecked.push(field); continue; }
    const rule = MISSING_RULES[key]!;
    for (const p of rule.badPatterns) {
      const re = new RegExp(p.source, p.flags.includes('g') ? p.flags : `${p.flags}g`);
      let m: RegExpExecArray | null;
      let decided = false;
      while ((m = re.exec(text)) !== null) {
        const sentence = sentenceAround(text, m.index);
        const marker = UNCERTAINTY_MARKERS.find((k) => sentence.includes(k));
        if (marker) {
          cleared.push({ field, sentence: sentence.slice(0, 120), marker });
          continue;   // 같은 문장에 불확실성 표시가 있으면 올바른 서술이다
        }
        candidates.push({
          field,
          evidence: m[0].replace(/\s+/g, ' ').slice(0, 80),
          sentence: sentence.slice(0, 160),
        });
        decided = true;
        break;
      }
      if (decided) break;
    }
  }
  return { candidates, cleared, unchecked };
}

export type MustIncludeResult = { item: string; tokens: string[]; found: string[]; missing: string[]; ok: boolean };

/**
 * must_include 의 **핵심 토큰**이 원고에 나오는지 본다. 대리 지표다.
 *
 * 정답이 한국어 문장이라 문자열 그대로 맞출 수 없다. 그래서 식별자와 숫자만 뽑아 대조하고,
 * 결과표에 "토큰 대리 지표"임을 표시한다. 문장의 뜻이 맞는지는 사람이 봐야 한다.
 */
export function checkMustInclude(text: string, fx: Fixture): MustIncludeResult[] {
  const items = fx.expected?.must_include ?? [];
  return items.map((item) => {
    const tokens = [
      ...new Set([
        ...(item.match(/\bdpl_[A-Za-z0-9]+\b/g) ?? []),
        ...(item.match(/\b[0-9a-f]{7}\b/g) ?? []),
        ...(item.match(/#\d{1,5}/g) ?? []),
        ...(item.match(/\b\d{2,6}\b/g) ?? []),
      ]),
    ];
    const found = tokens.filter((t) => text.includes(t));
    const missing = tokens.filter((t) => !text.includes(t));
    // 토큰이 아예 없는 정답은 자동 판정 불가 → ok 를 null 대신 true 로 두지 않고 tokens 로 구분한다
    return { item, tokens, found, missing, ok: tokens.length > 0 && missing.length === 0 };
  });
}

export type Score = {
  fixture_id: string;
  /** 자동 판정 */
  /** 식별자 환각 — 정확한 문자열 일치로 판정한다. 확실하다. */
  identifier_hallucinations: Hallucination[];
  /** 지표 값 환각 **후보** — 사람 확인이 필요하다. 자동 집계에 하드 숫자로 쓰지 않는다. */
  metric_value_candidates: Hallucination[];
  /** 규칙에 걸린 것. **사람 확인이 필요한 후보다** — 문장 판단을 정규식이 대신하지 못한다. */
  missing_misread_candidates: MissingReadCandidate[];
  /** 규칙에 걸렸지만 같은 문장의 불확실성 표시로 올바른 서술이라 판정한 것. */
  missing_misread_cleared: MissingReadCleared[];
  missing_unchecked: string[];
  must_include: MustIncludeResult[];
  must_include_auto_judgeable: number;
  must_include_satisfied: number;
  /** 수동 확인 항목 — 자동으로 재지 않는다 */
  manual: string[];
};

export function score(text: string, fx: Fixture, opts: { allowIssues?: number[] } = {}): Score {
  const mi = checkMustInclude(text, fx);
  const judgeable = mi.filter((r) => r.tokens.length > 0);
  const mm = findMissingMisreads(text, fx);
  const h = findHallucinations(text, fx, opts);
  return {
    fixture_id: fx.id,
    identifier_hallucinations: h.identifiers,
    metric_value_candidates: h.metricCandidates,
    missing_misread_candidates: mm.candidates,
    missing_misread_cleared: mm.cleared,
    missing_unchecked: mm.unchecked,
    must_include: mi,
    must_include_auto_judgeable: judgeable.length,
    must_include_satisfied: judgeable.filter((r) => r.ok).length,
    manual: ['근거 미표기율', '과잉 단정률', '우선순위 적중',
      '결측 오독 후보 확인', '지표 값 환각 후보 확인'],
  };
}
