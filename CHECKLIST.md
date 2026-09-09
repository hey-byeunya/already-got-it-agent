# 진행 체크리스트 — 채점표 5문항 대응

제출: **GitHub 저장소 URL** (실제 결과물 캡처본 포함) 을 구글폼에. PRD 문서도 저장소에 넣는다.
배포 URL은 요건이 아니다 — 로컬 실행 + 캡처가 동작 증거다.

> **표기** — `[o]` 완료 · `[ ]` 미완료 · `[~]` 부분 완료(무엇이 남았는지 옆에 적는다)
>
> ⚠️ GitHub 은 `[ ]` 와 `[x]` 만 체크박스로 그린다. `[o]` 는 글자 그대로 보인다.
> 사람이 읽을 때 오해가 없는 쪽을 골랐다 — 체크박스 모양이 필요하면 `[x]` 로 되돌린다.

---

## 채점표 ↔ 문서 대응

| 평가 문항 | 근거 | 상태 |
|---|---|---|
| 1. 자기 도메인 워크플로를 기획할 수 있는가 | `PRD.md` — 문제정의·타겟유저·워크플로·도구계획·사람개입·MVP·화면 | 완료 |
| 2. 도구를 연결해 실제 작업을 수행하게 할 수 있는가 | `TOOLS.md` + `mcp-server/` (검사 40 + 스모크 12) + `evidence/runs/gate-*` | 완료 |
| 3. 에이전트 루프를 구현할 수 있는가 | `AGENT_LOOP.md` + `agent/` (검사 97) + 재개·종료조건 실증 | 완료 |
| 4. 사람 개입·관찰 가능성·평가 | `EVAL.md` (기준실행 12시행 + E4 + 실패 8건) + 화면 + `evidence/` | 완료 |
| 5. 배포 및 새로운 시도 | `RUN.md` + 확장 2건 (독립 MCP 서버 · 되돌리기) | 부분 — 캡처 남음 |

**남은 것은 캡처와 마무리 정리다.** 코드·문서·평가·검증은 끝났다.

---

## 0. 확인과 저장소

- [o] Claude Agent SDK 공식 문서 확인 — `query` 옵션, `canUseTool` 평가 순서, MCP 등록, 비용 필드
- [o] `cardnews-submission/` 정리 (재사용 문서 4개는 이 저장소로 옮김)
- [o] 실행 엔진 자격증명 — `.env.local` 준비. **구독 로그인으로 전환**(`DECISIONS.md` D18)
- [o] GitHub 새 저장소 생성 + `git init` + 원격 연결 (`hey-byeunya/already-got-it-agent`, 커밋 13개)
- [o] `.gitignore` — `.env.local`, `node_modules`, `dist/`, `/runs/`
- [ ] Vercel API 토큰 · GitHub PAT 발급 ← **`live` 모드를 붙일 때만 필요.** 지금은 픽스처 모드
- [ ] Vercel API 조회 범위 확인 → `DECISIONS.md` D17

## 1. 문서 — 채점 1번

- [o] `PRD.md` 운영 브리핑으로 재작성 (1~7절)
- [o] 문제 정의가 **"반복 업무"** 로 읽히는지 확인 — 매주 운영 점검. 카드뉴스는 결과물 형식
- [o] 워크플로 표에서 **에이전트 판단 / 도구 처리** 구분
- [o] 사람 개입 지점 7곳을 "왜 사람이어야 하는가"로 설명
- [o] `TOOLS.md` 도구 7개 재작성
- [o] `DECISIONS.md` D1~D18
- [o] `README.md` 재작성 (평가 요약 · 남은 과제 · 밝혀 두는 것)
- [o] `RUN.md` (구 `DEPLOY.md`) 전환
- [o] `EVAL.md` 재작성 + 기준실행·실험·실패사례 기록
- [o] `AGENT_LOOP.md` 갱신
- [o] `fixtures/snapshots/` 운영 스냅샷 4개 교체
- [o] `API_SPEC.md` 엔드포인트·승인 토큰 규약
- [~] 문서의 남은 `TODO` — `PRD.md` 3곳(미정 항목), `API_SPEC.md` 4곳(경로 확정), `README.md` 1곳(실행 방법)

## 2. Supabase 집계 함수 + 상태 저장

**`live` 모드용이라 아직 하지 않았다.** 픽스처 모드는 이 층이 필요 없다.

- [ ] 집계 전용 `security definer` RPC — **원시 행 반환 금지**를 시그니처로 강제
- [ ] `service_role` 키를 쓰지 않는지 확인
- [o] 실행 상태 저장 — 화면 층이 `runs/{id}/ui-state.json` 으로 구현 (`app/lib/store.ts`)
- [o] 승인 기록 — `runs/{id}/approvals.json` (`revert_issue` 대상 범위가 된다)

## 3. MCP 서버 — 채점 2번 · 확장①

**fixture 모드 구현 완료.** `cd mcp-server && npm run verify`

- [o] `mcp-server/` stdio MCP 서버 골격 (`@modelcontextprotocol/server` v2 + zod)
- [o] `get_system_health` — `unavailable_fields` 그대로 전달
- [o] `get_user_metrics` — 집계값만, `previous_period_totals` 포함
- [o] `get_dev_activity` — 허용 저장소 목록 밖은 `repo_not_allowed` 로 거절
- [o] `web_search`
- [o] `render_chart` — **`source` 대조 + `rendered_ok` 확인**
- [o] `create_github_issue` ⚠️ — `_meta requiresUserInteraction` + `approval_token` 검사
- [o] `revert_issue` ⚠️ — 승인 기록에 있는 이슈만
- [o] 도구별 실패 규칙 (즉시 중단 / 대체 경로 / 픽스처로 실패 재현)
- [o] **자체 검사 40개** — 승인 게이트·근거 대조·되돌리기 범위·결측 구별·도구 표면
- [o] 스모크 12단계 — stdio 로 붙어 전체 흐름 확인
- [o] `.mcp.json` 등록 (저장소 루트)
- [ ] **Claude Code 에서 붙여 도구 7개가 뜨는 화면** ← 확장① 캡처
- [ ] 실제 API 연결 (`OPS_MODE=live`) — 지금은 `live_not_implemented` 로 분명히 알린다

## 4. 루프와 승인 — 채점 2·3번

**구현 완료.** `cd agent && npm run check` — **검사 97개**

- [o] Agent SDK `query()` 래퍼 — `agent/src/engine.ts` 한 곳에서만 SDK 를 부른다
- [o] MCP 서버를 `mcpServers` 로 연결 (stdio)
- [o] `disallowedTools` — 내장 도구 15종 차단
- [o] `allowedTools` — **읽기 도구 5개만**. 쓰기 2개는 넣지 않는다 (D14)
- [o] `permissionMode: 'default'` (`dontAsk` 아님 — 질문 대기가 거부된다)
- [o] `canUseTool` — `AskUserQuestion` 가로채기 + 쓰기 승인 + **승인 시점에 토큰 주입**
- [o] `PreToolUse` 훅 (게이트 ③) — `agent/src/hook.ts`, 검사 13개 (설정 무관 불변식 2종)
- [o] `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` 경고 감시 → **쓰기 도구가 가려진 경우만** 실패 처리
- [o] 종료 조건 — `maxTurns` · `maxBudgetUsd` (SDK) + 도구호출·토큰·시간·연속 (내 코드)
- [o] 대기 시간을 실행 시간에서 제외
- [o] 토큰·비용 집계 — 함정 4개 + `usage_known`
- [o] CLI 실행기 `agent/src/run.js` — 화면 없이 브리핑 한 편
- [o] **실제 모델로 실행** — `evidence/runs/` 에 기록 **5건**
- [o] 승인 없이 쓰기 도구가 실행되지 않는지 실제 실행에서 확인 (`gate-deny` + SDK `permission_denials` 1건)
- [o] 승인 후 실행 + 되돌리기 (`gate-approve` — #9001 생성→닫힘)
- [o] 종료 조건 실제 발동 (`cap-stopped`·`web-mtu21ejs` — `maxToolCalls`)
- [~] 훅 — 매 실행에서 돌았지만 **거절한 적은 없다.** 불변식을 위반한 호출이 없었으니 정상이다.
      거절 경로는 검사 13개로 확인했다. 실행에서 발동시키려면 일부러 위반을 만들어야 한다

## 5. 화면과 재개 — 채점 3·4번

**구현 완료.** `cd app && npm run dev` → http://localhost:3010

- [o] 시작 화면 — 픽스처·축 선택, 지난 실행 목록, 자격증명 출처 표시
- [o] 진행 화면 + 실행 로그 펼쳐보기 (도구·입력·출력 **전문**·시각)
- [o] 소요 시간 · 토큰 · 비용 표시 + **추정값 표기** + 자격증명별 설명 (D18)
- [o] `usage_known: false` 면 0 이 아니라 **"확인 못 함"** 으로 그린다
- [o] 질문 대기 UI — 선택지와 설명, "이 상태는 정상이다" 안내
- [o] 승인 대기 UI — 쓸 내용 펼쳐 본 뒤 승인/거절, 결정 이력
- [o] 중단 후 **재개/재시도** — 걸려 있던 질문·승인은 읽기 전용으로만 (누를 수 없는 버튼을 안 보여준다)
- [o] 카드 차트 표시 (SVG 서빙)
- [o] 다크 모드 · 모바일 폭 확인
- [o] **V1 새로고침 유지** — 살아 있는 실행에서 페이지를 다시 열어 상태가 그대로 그려짐 (`web-mtu1tqmf`)
- [o] **V2 같은 답변 두 번 제출** → `409 already_answered`, 작업은 한 번만 (`web-mtu1tqmf`)
- [o] **V3 지난 버전 답변** → `409 stale_version`
- [o] **V4 실패 후 재시도** — 「처음부터 재시도」로 로그가 이어짐 (`web-mtu21ejs`)
- [o] **V5 서버 재시작 후** → `interrupted` + 재개 경로. 세션 없으면 「재개」 비활성 (`web-mtu21ejs`)
- [ ] V6 실행 두 개 동시 — 질문·세션이 섞이지 않는지
- [ ] `evidence/02-verification.md` 4칸 표로 정리 (V1~V6)
- [ ] 화면 캡처 PNG → `evidence/screens/` ← **안내서는 `CAPTURE_GUIDE.md` 에 있다**

## 6. 카드 제작과 내보내기

**차트까지는 되고, 카드 파일 내보내기는 남았다.**

- [o] `render_chart` 로 지표 카드 — 근거 대조를 통과한 SVG (실행마다 3~4장)
- [ ] **로컬에서 `agy`로 표지 삽화 생성** → 커밋, 실행 기록 보관
- [ ] 스토리보드 승인 → 카드 PNG 렌더링 (지금은 SVG 차트까지)
- [ ] 제목·본문·출처를 **별도 텍스트 레이어**로
- [ ] 카드 1장만 수정 → 나머지 유지 (텍스트만 고칠 때 차트 재렌더링 안 함)
- [ ] PNG · ZIP · `evidence/SOURCES.md` 근거 기록
- [ ] 내려받은 ZIP을 **열어서** 순서·수량·글자 잘림·한글 표시 점검

## 7. 평가 — 채점 4번

- [o] 자동 채점 스크립트 `agent/src/eval/score.ts` — **검사 51개**, 과탐지 9건 수정 이력 포함
- [o] 평가 실행기 `agent/src/eval/run.ts` (`--rescore` 로 무료 재채점)
- [o] 시행 기록에 **원고 전문 저장** — 재채점과 수동 채점의 근거
- [o] 기준 실행 — 픽스처 4개 × 3회 = 12시행, 전부 완주 (`eval-results/E0/`)
- [o] 수동 항목 판정 — f3 원인 단정 회피, f4 결측·0 구별, 근거 표기 (근거 문장을 `EVAL.md`에)
- [o] `f4-sparse` 에서 결측을 0으로 읽지 않는지 확인 — 통과
- [o] `f3-metric-drop` 에서 원인을 단정하지 않는지 확인 — 3/3 통과
- [o] 세팅 변화 실험 — **E4 완료**(3분류 지시 제거, f3·f4 각 3회), **E2 판정 불가로 미실행**
- [o] 실패 사례 수집·분류 → `EVAL.md` (실행 수준 8건 + 도구 실패 4종 + 출처별 집계)
- [o] 편차를 함께 적고, 편차와 무관한 변화만 판정으로 (E4 형식 효과만 판정, 내용은 판정 불가)
- [ ] E1(도구 description 제약 제거)·E3(모델 교체) — 선택. 기준선이 있어 언제든 붙일 수 있다

## 8. 확장② — 되돌리기

**구현·검증 완료.** 캡처만 남았다.

- [o] `revert_issue` — 승인 기록에 있는 이슈만
- [o] 되돌리기도 승인 게이트를 지난다 (`_meta` + `approval_token`)
- [o] 되돌린 사실이 실행 기록에 남는지 — `approvals.json` 의 `log`
- [o] 승인 기록에 없는 이슈 번호로 시도 → `not_in_approval_log` 거절 (스모크 11단계)
- [o] 실제 모델로 생성→되돌리기 왕복 (`gate-approve` — #9001)
- [ ] 전후 캡처 (생성 → 되돌림 → 닫힘)

## 9. 캡처와 마무리

- [~] `README.md` — 평가 요약·남은 과제·밝혀 두는 것은 완료. **실행 방법 TODO 1곳 남음**
- [o] 실패 사례 → `EVAL.md` 에 8건 + 출처별 집계 (`evidence/04-failure.md` 는 템플릿으로 남음)
- [ ] `RUN.md` 의 캡처 목록 전부 확보 → `evidence/screens/`
- [ ] `git log`까지 훑어 키·토큰 없는지 확인
- [ ] 남은 TODO 정리

```bash
grep -rn "TODO" --include="*.md" . | grep -v node_modules
```

- [ ] 저장소를 **공개로 전환** (현재 PRIVATE)
- [ ] 구글폼 제출 — GitHub 저장소 URL

---

## 놓치기 쉬운 것

| 위험 | 방지 |
|---|---|
| **승인 게이트가 조용히 무력화됨** | 쓰기 도구를 `allowedTools`에 넣지 않는다. `_meta requiresUserInteraction` + 서버 토큰 검사 + `PreToolUse` 훅 3중. 셰도잉 경고를 실패로 처리 (D14) |
| `dontAsk` 를 잠금이라 착각 | 그 모드는 `canUseTool`을 호출하지 않아 질문 대기와 승인이 **거부**된다 |
| 문제 정의가 "카드뉴스 만들기"로 읽힘 | 반복 업무는 **매주 운영 상태를 점검하는 일**. 카드뉴스는 결과물 형식 |
| 결측을 0으로 읽음 | `unavailable_fields`·`usage_known`. 배포 0건(사실)과 함수 오류 null(모름)은 다르다 |
| 지표 하락의 원인을 지어냄 | `f3-metric-drop` 이 이걸 잡는다. 원인 미지를 미지로 남긴다 |
| 차트가 지어낸 수치를 그림 | `render_chart` 의 `source` 대조. 어긋나면 `source_mismatch` 거절 |
| 1회 실행으로 개선 주장 | Day 38에서 겪은 문제. 3회 이상 + 편차 함께 적기 |
| 비용을 실제 청구액처럼 적음 | 클라이언트 측 추정값이다. 자격증명 출처에 따라 뜻이 다르다 (D18) |
| **채점기가 정상 서술에 벌점을 줌** | 실제 시행이 과탐지 9건을 잡아냈다. 채점기에도 검사를 붙인다 (51개) |
| **상한이 정상 작업을 끊음** | 종료 조건 세 개가 그 방향으로 잘못돼 있었다 (`EVAL.md` 실패 F1·F2) |
| 캡처 누락 | 재현하기 번거로운 것(재시작 재개·종료 조건)을 그 자리에서 먼저. 안내서는 `evidence/screens/CAPTURE_GUIDE.md` |
| 확장이 실제로 확장인지 | ① Claude Code에서 내 MCP 서버가 붙는 화면 ② 되돌리기 전후 — 둘 다 캡처로 증명 |
