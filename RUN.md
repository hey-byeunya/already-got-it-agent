# RUN — 실행 방법 · 수용 기준 · 캡처 목록

제출은 **GitHub 저장소 URL + 실제 결과물 캡처본**이다. 배포하지 않는다.
그래서 **캡처가 유일한 동작 증거**다 — 단계마다 즉시 남긴다.

---

## 구성

```
mcp-server/     도메인 도구 9개, stdio MCP 서버 (구현은 여기 한 곳)
app/            Next.js — 화면, 루프 래퍼, 승인 게이트, 실행 기록
agent/          Agent SDK 루프 래퍼 + CLI 실행기 (`node dist/src/run.js`)
fixtures/       평가·캡처용 운영 스냅샷 4개 (정답 포함)
evidence/       실행 화면 · 실행 기록 · 결과 파일 · 검증 기록
```

## 실행

```sh
# 도구 서버·에이전트 빌드
cd mcp-server && npm install && npm run build
cd ../agent && npm install && npm run build
# 화면 (http://localhost:3010)
cd ../app && npm install && npm run dev
# 화면 없이 한 편 (픽스처)
cd ../agent && node dist/src/run.js --fixture f2-deploy-fail
```

브라우저에서 `http://localhost:3010`을 연다.

Claude Code에서 같은 MCP 서버를 붙여 쓰려면 `.mcp.json`에 등록한다 (확장① 증거).

```sh
cat .mcp.json   # already-got-it-ops 등록 확인
# Claude Code에서 /mcp → 도구 9개가 뜨는지 확인한다
```

## 환경변수

저장소에 실제 값을 넣지 않는다. `.env.local.example`에 형식만 둔다.

| 변수 | 용도 | 공개 가능 |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude Agent SDK | **불가** |
| `VERCEL_API_TOKEN` | `get_system_health` — 읽기 전용 | **불가** |
| `VERCEL_PROJECT_ID` | 조회 대상 프로젝트 한정 | 가능 |
| `GITHUB_TOKEN` | `get_dev_activity` · `create_github_issue` · `revert_issue` | **불가** |
| `GITHUB_ALLOWED_REPOS` | 허용 저장소 목록. 밖은 도구가 거절 | 가능 |
| `NEXT_PUBLIC_SUPABASE_URL` | 데이터 소스 | 가능 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 집계 RPC 접근 | 가능 |
| `OPS_OPENCODE_BIN` | opencode 엔진의 바이너리 경로 (기본 `opencode`) | 가능 |
| `OPS_OPENCODE_MODEL` | opencode 엔진 기본 모델 (예: `google/gemini-3.5-flash-lite`) | 가능 |

- Supabase `service_role` 키는 **어디에도 쓰지 않는다.** 집계는 `security definer` RPC로만 접근한다.
- `GITHUB_TOKEN`은 **issue 읽기·생성·닫기 범위만** 준다. 저장소 쓰기·삭제 권한을 주지 않는다.

## opencode 엔진 — Claude 크레딧이 바닥나면

시작 화면의 엔진 선택에서 `opencode`를 고르면 Claude Agent SDK 대신
`opencode run --format json`으로 같은 브리핑을 돈다. MCP `ops` 서버는
`OPENCODE_CONFIG_CONTENT`로 그때그때 붙인다 — 저장소에 `opencode.json`을 두지 않는다.

- 인증·모델은 opencode 쪽 설정을 따른다 (`opencode auth login`).
  모델은 시작 화면에서 무료 목록(`GET /api/opencode-models`, 단가표 기준 무료 판정) 중 고른다.
  직접 지정하려면 `OPS_OPENCODE_MODEL` (예: `google/gemini-3.5-flash-lite`).
  `GOOGLE_API_KEY`만 있고 `GOOGLE_GENERATIVE_AI_API_KEY`가 없으면 같은 값을 이어 준다 (실측).
- 질문 대기·승인 대기가 없다. 이슈 생성·되돌리기 2개는 끄고, 파일 쓰기·셸도 막는다.
  이슈 제안은 브리핑 본문에 적힌다.
- 사용량은 `step_finish` 합계다. 없으면 `usage_known: false`로 표시한다.
- 실측 (2026-09-10): `opencode mcp list`에서 `ops` connected 확인.
  도구 이름은 `ops_도구` 형태라 `ops_create_github_issue` 토글로 끈다.

## live 실행 — 실제 API로 브리핑 한 편

평가는 픽스처로 재현하지만, 실제 운영에서는 이 모드로 돈다.

```sh
cd agent && OPS_MODE=live node dist/src/run.js --run-id live-YYYYMMDD
```

실행 전 확인 (하나라도 빠지면 읽기 축이 `확인 못 함`이 된다):

- [ ] `.env.local`에 `VERCEL_API_TOKEN`·`VERCEL_PROJECT_ID`·`GITHUB_TOKEN`·
  `NEXT_PUBLIC_SUPABASE_URL`·`NEXT_PUBLIC_SUPABASE_ANON_KEY`·`OPS_METRICS_TOKEN`이 있는가
- [ ] `supabase/ops_metrics.sql`을 Supabase SQL Editor에서 실행했는가.
  안 하면 `get_user_metrics`가 `rpc_not_created`로 죽고 사용자 지표 축 전체가 빈다
- [ ] 실제 쓰기를 원하지 않으면 `OPS_ALLOW_LIVE_WRITES=0`인가 (기본값).
  승인 없이 돌리려면 `--approve`를 붙이지 않는다 — 쓰기 제안은 거절 기록으로 남는다

첫 live 실행 (2026-09-10, `live-t1`, 구독 로그인, 승인 없음):

- `done (success)` — 도구 호출 24회, 실행 346.7초, 비용 $0.7940 추정(구독이라 미청구).
  카드 6장 + PNG 6장 + ZIP(`cards/*.png` + `SOURCES.md`) 전부 열림.
- Vercel 배포 0건 · GitHub 이슈·커밋·PR 0건 · 보안 권고 3종(next critical RCE 2건 포함).
- Supabase RPC 미생성이라 사용자 지표 축은 `확인 못 함` — SQL 실행이 남은 사람 몫이다.
  → **해소 (2026-09-10)**: SQL 실행 후 `smoke-live` 3번이 집계 반환 확인.
  7일 series + totals + 직전 기간 비교값, `unavailable_fields: []`, 원시 행 없음.
  이번 기간 전부 0, 직전 기간 활성 사용자 1 — 실제 0이지 결측이 아니다.
- 지어낸 근거 카드가 `source_not_found`로 거절된 뒤 모델이 내용을 바꿔 완성했다 (P1-7(a) live 증거).
- 이슈 생성 제안 2건은 승인 없이 거절됐고 `permission_denials` 2건이 기록에 남았다.

두 번째 live 실행 (2026-09-10, `live-t2`, 구독 로그인, 승인 없음):

- `done (success)` — 도구 호출 22회, 실행 178.5초, 비용 $0.3744 추정(미청구).
- RPC 해소 후라 사용자 지표 카드가 정상 수치로 나왔다 (전부 0 + 차트, 전 기간 활성 1명 병기).
- 모델이 GHSA ID를 `field`에 넣어 `invalid_source_field`로 2번 거절당하고 고쳐서 완성했다.
- 이슈 제안 1건 거절, `permission_denials` 1건. 전회($0.79)의 절반 — 같은 조건도 편차가 크다.

## 픽스처 실행 모드

평가와 캡처를 재현할 수 있게, 외부 API 응답과 기준 시각을 픽스처로 고정 주입하는 모드를 둔다.

- 실제 API를 쓰면 실행 시점마다 결과가 달라져 **세팅 변화의 효과를 판정할 수 없다.**
- 픽스처 모드에서는 쓰기 도구가 실제 GitHub를 바꾸지 않는다. 승인 화면과 결과 표시는 그대로 동작하되
  대상이 픽스처 사본이다. **화면에 이 사실을 표시한다.**

```sh
cd agent && node dist/src/run.js --fixture f2-deploy-fail
# --approve 를 붙이면 쓰기 도구 승인을 허용한다 (픽스처라 실제 저장소는 안 바뀐다)
```

## 실행 전 확인

- [ ] `.env.local`이 `.gitignore`에 있는가
- [ ] 저장소에 키·토큰이 없는가 (`git log`까지 확인)
- [ ] `GITHUB_TOKEN`의 범위가 issue로 한정돼 있는가
- [ ] `service_role` 키를 쓰지 않는가
- [ ] 종료 조건(`maxTurns`·`maxBudgetUsd` 등)이 기본값으로 걸려 있는가
- [ ] `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` 경고 감시가 켜져 있는가 (게이트가 가려지면 실패시킨다)

## 수용 기준

로컬 실행에서 이 기준으로 동작을 확인한다.

> **픽스처 4개 전부, 사람 개입 지점 외의 중단 없이 내보내기까지 도달했다 (E0, 12/12 완주).**
> 그리고 `f4-sparse`에서는 카드를 억지로 만들지 않고 자료 부족을 알려야 한다.

| 시나리오 | 기대 | 실제 | 통과 |
|---|---|---|---|
| `f1-normal` 정상 주간 | 큰 문제 없음을 확인하고 지켜볼 것 위주로 구성 | 문제없음 확인, 억지 진단 없음 (3/3) | O |
| `f2-deploy-fail` 배포 실패 | 실패한 배포를 `지금 손봐야 할 것`으로 1번 카드에 | 빌드 오류 원문 그대로 카드화. 필수신호 0.67이라 1번 배치까지는 장담 못 함 | △ |
| `f3-metric-drop` 지표 급감 | 전주 대비 감소를 근거와 함께 제시. 원인을 단정하지 않음 | 원인 단정 회피 3/3, 추정 표기 | O |
| `f4-sparse` 자료 부족 | **카드를 만들지 않고** 무엇이 부족한지 알림 | 4장으로 축소, 결측과 0 구별 (3/3) | O |

- 확인 일자: 2026-09-09 (E0 기준 실행) · live `live-t1` 2026-09-10은 `RUN.md` live 실행절 참조
- 확인한 커밋: 741d167 (E0 당시 최신. 이후 변경은 `git log`로 대조한다)

## 캡처 목록 — 채점 5문항 매핑

| 채점 | 캡처할 화면 | 완료 |
|---|---|---|
| 1. 기획 | (문서로 대체 — `PRD.md`) | — |
| 2. 도구 | ① 실행 로그에 외부 호출 3종이 실제로 찍힌 화면 | ☐ |
| | ② **승인 없이 쓰기 도구 호출이 거부되는 화면** — 앱 경유 | ☐ |
| | ③ **같은 거부를 MCP 서버에 직접 붙여 재현** (Claude Code에서) | ☐ |
| | ④ 도구 실패를 모의 오류로 재현한 화면 | ☐ |
| | ⑤ 내장 도구가 차단돼 목록에 없는 화면 | ☐ |
| 3. 루프 | ① 질문 대기 화면 | ☐ |
| | ② 답변 후 이어가는 화면 | ☐ |
| | ③ 새로고침 후 질문 유지 | ☐ |
| | ④ **서버 재시작 후 재개** ← 나중에 재현하기 번거롭다. 그 자리에서 남긴다 | ☐ |
| | ⑤ **종료 조건 발동** — 상한을 낮춰 실제로 걸어 본다 ← 위와 같음 | ☐ |
| 4. 관찰·평가 | ① 실행 로그 펼친 화면 (호출 이유까지) | ☐ |
| | ② 토큰·비용 표시 (추정값 표기 포함) | ☐ |
| | ③ 평가 결과표 | ☐ |
| | ④ 실패 분류표 | ☐ |
| 5. 확장 | ① **Claude Code에서 내 MCP 서버가 붙어 도구가 뜨는 화면** | ☐ |
| | ② 되돌리기 **전후** — 이슈 생성됨 → 되돌림 → 닫힘 | ☐ |
| 결과물 | 카드 5장 PNG, 내려받은 ZIP을 열어본 화면 | ☐ |

## 지금까지 확보한 증거

| 무엇 | 어디에 | 상태 |
|---|---|---|
| 승인 없이 쓰기 도구가 거부되는 것 | `evidence/runs/gate-deny/` + SDK `permission_denials` 1건 | ✅ 실제 모델 |
| 승인 후 실행 + 되돌리기 | `evidence/runs/gate-approve/` (#9001 생성→닫힘) | ✅ 실제 모델 |
| 종료 조건 실제 발동 | `evidence/runs/cap-stopped/` (`maxToolCalls`) | ✅ 실제 모델 |
| 근거 대조를 통과한 차트 | `evidence/runs/charts/` 3장 (`source_verified`) | ✅ 실제 모델 |
| 기준 실행 12시행 + 원고 전문 | `eval-results/E0/` | ✅ 실제 모델 |
| live 브리핑 2편 (카드 6장·PNG·ZIP) | `runs/live-t1/`·`runs/live-t2/` (gitignore라 로컬에만) | ✅ 실제 모델 |
| Supabase 집계 반환 확인 | `smoke-live` 3번 + 직접 호출 (7일 series, 원시 행 없음) | ✅ 실제 API |
| 화면 — 질문 대기·승인·중단 재개·비용·차트·로그 | (캡처 예정) | ⏳ 화면에서 실행 후 |
| Claude Code 에서 MCP 서버 붙는 화면 | (캡처 예정) | ⏳ |

`evidence/runs/README.md` 에 각 실행이 무엇을 확인하는지 적어 두었다.

④⑤(3번 행)와 종료 조건 발동은 **나중에 다시 만들기 번거롭다.** 해당 단계에서 즉시 남긴다.
