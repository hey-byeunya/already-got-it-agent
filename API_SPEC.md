# API_SPEC — 화면과 서버의 약속

API는 웹 화면이 서버에 요청하는 약속이다. 여기 적은 상태값과 규칙은 화면·서버·`EVAL.md`가
같은 뜻으로 쓴다.

---

## 상태 값

| 값 | 뜻 | 완료인가 |
|---|---|---|
| `planning` | 다음 행동을 정하는 중 | 아니다 |
| `running` | 도구 호출 중 | 아니다 |
| `waiting_for_user` | 사람의 선택·승인 대기 — **정상 상태** | 아니다 |
| `failed` | 재시도 소진. 부분 결과는 보존 | 아니다 |
| `stopped` | 종료 조건에 걸림 | 아니다 |
| `done` | 사람이 최종 승인하고 파일이 열리는 것을 확인 | 그렇다 |

잘못된 엔진 출력이나 모델의 "다 했다" 한 마디를 `done`으로 처리하지 않는다.

## 엔드포인트

`구현`은 이 저장소에 라우트가 있다는 뜻이다. `미구현`은 계획만 있고 요청하면 404가 아니라
라우트 자체가 없다는 뜻이다 — 화면은 미구현 경로를 부르지 않는다.

| 메서드 · 경로 | 하는 일 | 입력 | 출력 | 오류 | 구현 |
|---|---|---|---|---|---|
| `GET /api/runs` | 실행 목록·픽스처 목록·자격증명 출처 | — | `{ runs[], fixtures[], credential_source }` | — | 구현 |
| `POST /api/runs` | 브리핑 실행 생성 | `{ fixture_id?, goal?, focus?, engine? ("claude"\|"opencode"), model? }` | `{ run_id }` (201) | — | 구현 |
| `GET /api/runs/{id}` | 상태·대기 질문·진행 조회 | — | `RunState` + 유도값(`axes`·`cards`·`steps`·`links`·`exports`, 디스크에서 읽어 얹는다) | `run_not_found` 404 | 구현 |
| `DELETE /api/runs/{id}` | 실행 삭제 (두 번 눌러야 화면이 부른다) | — | `{ ok: true }` | `run_not_found` 404 · `run_is_live`·`invalid_run_id` 409 | 구현 |
| `GET /api/opencode-models` | 무료 모델 목록 (60초 캐시) | — | `{ models: [{id, name}], cached }` | opencode 실패 시 `{ models: [], error }` 502 | 구현 |
| `GET /api/runs/{id}/trace` | 실행 로그 (도구·호출 이유·입력·결과·소요) | `?after=` | `{ events[] }` | — | 미구현 — `GET /api/runs/{id}`의 `trace`로 대신 본다 |
| `POST /api/runs/{id}/answers` | 질문 답변 제출 | `{ question_id, version, answers }` | `{ ok: true }` | `invalid_body` 400 · `already_answered`·`stale_version`·`stale_question`·`not_waiting`·`no_live_callback` 409 · `run_not_found` 404 | 구현 |
| `POST /api/runs/{id}/approvals` | **쓰기 도구 승인·거절** → 대기 콜백을 푼다 (토큰 발급은 콜백이 한다) | `{ approval_id, version, approved, reason? }` | `{ ok: true }` | `invalid_body` 400 · `already_decided`·`stale_version`·`stale_approval`·`not_waiting`·`no_live_callback` 409 · `run_not_found` 404 | 구현 |
| `GET /api/runs/{id}/approvals` | 승인 기록 조회 (되돌리기 대상 범위) | — | `{ approvals[] }` | — | 미구현 — `GET /api/runs/{id}`의 `decisions`로 대신 본다 |
| `POST /api/runs/{id}/storyboard/approve` | 스토리보드 승인 | `{ storyboard_version }` | `{ status }` | 버전 불일치면 거절 | 미구현 — 질문 대기(`AskUserQuestion`)로 대신 받는다 |
| `POST /api/runs/{id}/cards/{n}/revise` | 카드 하나만 수정 | `{ title?, body? }` | `{ card }` | 다른 카드 결과는 보존 | 미구현 — `compose_card`를 그 번호로 다시 부른다 |
| `POST /api/runs/{id}/resume` | 서버 재시작 후 재개 또는 재시도 | `{ mode: "resume"\|"retry" }` | `{ ok, mode }` | `run_not_found` 404 · `already_live`·`no_session_to_resume` 409 | 구현 |
| `POST /api/runs/{id}/export` | 카드뉴스 굽기 — **사람이 눌렀을 때만** | — | `exportCardnews` 결과 그대로 | `run_not_found` 404 · `already_exporting`·도구 오류 409 | 구현 |
| `GET /api/runs/{id}/export/[file]` | 결과물 내려받기. `zip`·`sources`·`NN.png` 세 형태만 받는다 | `?inline` (미리보기) | ZIP·PNG·`SOURCES.md` (스트리밍) | 형태 밖·없으면 400·404 | 구현 |
| `GET /api/runs/{id}/charts/{file}` | 카드 차트 SVG 서빙 | — | SVG | 없으면 404 | 구현 |
| `GET /api/runs/{id}/export` | PNG · ZIP · 근거 기록 | — | 파일 | 미승인이면 거절 | 미구현 — `export_cardnews` 도구 결과를 내려받는다 |

## 승인 토큰 규약

쓰기 도구(`create_github_issue` · `revert_issue`)는 유효한 `approval_token` 없이 실행되지 않는다.
검사는 **MCP 서버가** 한다 (`DECISIONS.md` D14 ②).

| 필드 | 뜻 |
|---|---|
| `tool` | 이 토큰으로 부를 수 있는 도구 하나 |
| `target` | 대상 리소스 (저장소·이슈 번호 등) |
| `expires_at` | 만료 시각 |
| `used_at` | 사용 시각. **한 번 쓰면 소멸한다** |

| 상황 | 서버 응답 |
|---|---|
| 토큰 없음 | `approval_required` |
| 만료됨 | `approval_expired` |
| 다른 도구·다른 대상 | `approval_scope_mismatch` |
| 이미 사용됨 | `token_already_used` — **두 번 실행하지 않는다** |

## 기간 규약

화면은 기간을 "그 날까지 포함"으로 적는다 ("2026-09-03 ~ 2026-09-10"은 9/10 하루치를
포함한다는 뜻). 도구 세 개는 이 약속을 따른다.

| 입력 형태 | 읽는 법 |
|---|---|
| 날짜만 (`"2026-09-10"`) | **그 날 끝까지 포함**한다. 조회 경계에는 하루를 더해 넘긴다 |
| 시각 포함 (`"2026-09-10T07:37:00.000Z"`) | 정확한 instant 그대로. CLI가 넘기는 `toISOString`이 여기 해당한다 |

- 내부 조회는 half-open `[since, until)` 이다. 날짜만 온 `until`에 하루를 더하는 것은
  화면의 inclusive 읽기를 half-open 경계로 옮기는 일이다 — 기간을 늘리는 것이 아니다.
- `previous_period_totals`의 직전 기간은 이렇게 확정된 이번 기간과 같은 길이로 잰다.
- 이 규약을 어기면 until 당일 데이터가 통째로 빠져 "배포 0건" 같은 오표시가 난다 (D35).
  구현은 `mcp-server/src/live/period.ts` 한 곳에 있다.

## 중복 실행 방지

- 같은 `question_id` + `version`에 대한 답변은 **한 번만** 작업을 시작한다.
- 제출 버튼을 두 번 눌러도 제작이 두 번 돌지 않는다.
- 지난 버전 질문에 뒤늦게 답이 오면 "지난 질문"임을 알리고 **현재 작업을 덮어쓰지 않는다.**
- 같은 승인을 두 번 제출해도 이슈는 한 번만 만들어진다 (`token_already_used`).

## 새로고침과 서버 재시작

| 상황 | 서버 작업 | 앱이 해야 할 일 |
|---|---|---|
| 브라우저 새로고침 | 살아 있을 수 있다 | 저장된 질문·선택·단계를 다시 그린다 |
| 서버 재시작 | 메모리에서 기다리던 `canUseTool` 콜백은 **사라진다** | 중단 상태를 보여준 뒤 `POST /resume`으로 재개하거나 재시도하게 한다 |

세션 ID만 저장한다고 화면 상태와 작업이 자동 복구되지는 않는다.

## 사용량 응답 형태

`GET /api/runs/{id}`의 `usage`는 **모르는 것과 0을 구별한다** (`DECISIONS.md` D15).

```json
{ "usage_known": true,
  "input_tokens": 35995, "output_tokens": 1058,
  "cache_read_input_tokens": 12000, "cache_creation_input_tokens": 800,
  "total_cost_usd": 0.1842, "cost_is_estimate": true,
  "elapsed_seconds": 74.2, "waiting_seconds_excluded": 310.0 }
```

- `usage_known: false`면 나머지 수치를 **0으로 표시하지 않고 "확인 못 함"으로 그린다.**
  크래시(`error_during_execution`)나 예산 초과(`error_max_budget_usd`)에서 발생한다.
- `cost_is_estimate`는 항상 `true`다. 클라이언트 측 추정값임을 화면에 표시한다.
- 출력 토큰은 result 메시지에서 읽은 값이다 (per-step 값은 placeholder).
- 자격증명 출처는 `api_key`·`auth_token`·`stored_login`·`opencode` 중 하나다.
  opencode 실행은 `step_finish` 합계로 집계하고 캐시 토큰은 0으로 둔다.

## 오류 표시

| 오류 | 화면에 보여줄 것 |
|---|---|
| 도구 조회 실패 | 원인 + 재시도 버튼. 그 축을 「확인 못 함」으로 표시 |
| 레이트 리밋 | 남은 시간 + 재시도 버튼 |
| 인증 실패 | 어느 토큰을 확인해야 하는지 안내 |
| `source_mismatch` | 차트 근거가 실제 도구 결과와 어긋남 — 조회부터 다시 |
| `approval_required` | 승인 화면으로 유도 |
| 종료 조건 도달 | 어느 조건에 걸렸는지 + 지금까지의 결과 + 계속할지 묻기 |
| 자료 부족 | 무엇이 결측인지 나열. **0으로 채우지 않는다** |
