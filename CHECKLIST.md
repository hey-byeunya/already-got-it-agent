# 진행 체크리스트 — 채점표 5문항 대응

제출: **GitHub 저장소 URL** (실제 결과물 캡처본 포함) 을 구글폼에. PRD 문서도 저장소에 넣는다.
배포 URL은 요건이 아니다 — 로컬 실행 + 캡처가 동작 증거다.

---

## 채점표 ↔ 문서 대응

| 평가 문항 | 근거 문서 | 상태 |
|---|---|---|
| 1. 자기 도메인 워크플로를 기획할 수 있는가 | `PRD.md` — 문제정의·타겟유저·워크플로·도구계획·사람개입·MVP·화면 | ✅ 초안 |
| 2. 도구를 연결해 실제 작업을 수행하게 할 수 있는가 | `TOOLS.md` — 7개 도구, 스키마·description·실패규칙·권한 | ✅ 초안 |
| 3. 에이전트 루프를 구현할 수 있는가 | `AGENT_LOOP.md` — 루프·상태·종료조건·승인 게이트 위치 | ✅ 초안 |
| 4. 사람 개입·관찰 가능성·평가 | `EVAL.md` + 실행 로그 화면 + `evidence/` | ✅ 초안 |
| 5. 배포 및 새로운 시도 | `RUN.md` — 실행·수용기준·캡처목록 / 확장 2건 | ✅ 초안 |

문서 초안과 MCP 서버(fixture 모드)가 끝났다. 다음은 앱(루프·화면)이다.

---

## 0. 확인과 저장소

- [x] Claude Agent SDK 공식 문서 확인 — `query` 옵션, `canUseTool` 평가 순서, MCP 등록, 비용 필드
- [x] `cardnews-submission/` 정리 (재사용 문서 4개는 이 저장소로 옮김)
- [ ] Vercel API 토큰 발급 (읽기 전용)
- [ ] GitHub PAT 발급 — **issue 읽기·생성·닫기 범위만**
- [ ] Anthropic API 키 준비
- [ ] Vercel API 조회 범위 확인 → `DECISIONS.md` D17
- [ ] GitHub 새 저장소 생성 + `git init` + 원격 연결
- [ ] `.gitignore` — `.env.local`, `node_modules`, `runs/`

## 1. 문서 — 채점 1번

- [x] `PRD.md` 운영 브리핑으로 재작성 (1~7절)
- [x] 문제 정의가 **"반복 업무"** 로 읽히는지 확인 — 매주 운영 점검. 카드뉴스는 결과물 형식
- [x] 워크플로 표에서 **에이전트 판단 / 도구 처리** 구분
- [x] 사람 개입 지점 7곳을 "왜 사람이어야 하는가"로 설명
- [x] `TOOLS.md` 도구 7개 재작성
- [x] `DECISIONS.md` D1~D17
- [x] `README.md` 재작성 (남은 과제 · 밝혀 두는 것 포함)
- [x] `RUN.md` (구 `DEPLOY.md`) 전환
- [x] `EVAL.md` 재작성
- [x] `AGENT_LOOP.md` 갱신
- [x] `fixtures/snapshots/` 운영 스냅샷 4개 교체
- [x] `API_SPEC.md` 를 이 앱의 엔드포인트·승인 토큰 규약으로 갱신

## 2. Supabase 집계 함수 + 상태 저장

- [ ] 집계 전용 `security definer` RPC — **원시 행 반환 금지**를 시그니처로 강제
- [ ] `service_role` 키를 쓰지 않는지 확인
- [ ] 실행 상태 저장 (`AGENT_LOOP.md`의 「저장하는 것」 표대로)
- [ ] 승인 기록 테이블 (도구·대상·토큰·시각) — `revert_issue` 대상 범위가 된다

## 3. MCP 서버 — 채점 2번 · 확장①

**fixture 모드 구현 완료.** `cd mcp-server && npm run verify` 로 전부 확인된다.

- [x] `mcp-server/` stdio MCP 서버 골격 (`@modelcontextprotocol/server` v2 + zod)
- [x] `get_system_health` — `unavailable_fields` 그대로 전달
- [x] `get_user_metrics` — 집계값만, `previous_period_totals` 포함
- [x] `get_dev_activity` — 허용 저장소 목록 밖은 `repo_not_allowed` 로 거절
- [x] `web_search`
- [x] `render_chart` — **`source` 대조 + `rendered_ok` 확인**
- [x] `create_github_issue` ⚠️ — `_meta requiresUserInteraction` + `approval_token` 검사
- [x] `revert_issue` ⚠️ — 승인 기록에 있는 이슈만
- [x] 도구별 실패 규칙 (즉시 중단 / 대체 경로 / 픽스처로 실패 재현)
- [x] 자체 검사 35개 — 승인 게이트·근거 대조·되돌리기 범위·결측 구별·도구 표면
- [x] 스모크 12단계 — stdio 로 붙어 전체 흐름 확인
- [x] `.mcp.json` 등록 (저장소 루트)
- [ ] **Claude Code에서 붙여 동작 확인** ← 확장① 증거, 캡처
- [ ] 실제 API 연결 (`OPS_MODE=live`) — 토큰 발급 후. 지금은 `live_not_implemented` 로 분명히 알린다

## 4. 루프와 승인 — 채점 2·3번

**구현 완료 (CLI 로 확인 가능).** `cd agent && npm run check` — 검사 52개.

- [x] Agent SDK `query()` 래퍼 — `agent/src/engine.ts` 한 곳에서만 SDK 를 부른다
- [x] MCP 서버를 `mcpServers` 로 연결 (stdio)
- [x] `disallowedTools` — 내장 도구 10종 차단
- [x] `allowedTools` — **읽기 도구 5개만**. 쓰기 2개는 넣지 않는다 (D14)
- [x] `permissionMode: 'default'` (`dontAsk` 아님)
- [x] `canUseTool` — `AskUserQuestion` 가로채기 + 쓰기 승인 + **승인 시점에 토큰 주입**
- [x] `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` 경고 감시 → 뜨면 실패 처리
- [x] 종료 조건 — `maxTurns` · `maxBudgetUsd` (SDK) + 도구호출·토큰·시간·연속 (내 코드)
- [x] 대기 시간을 실행 시간에서 제외
- [x] 토큰·비용 집계 — 함정 4개 + `usage_known`
- [x] CLI 실행기 `agent/src/run.js` — 화면 없이 브리핑 한 편
- [x] **실제 모델로 브리핑 실행** — `evidence/runs/` 에 기록 3건
- [x] `PreToolUse` 훅 (게이트 ③) — `agent/src/hook.ts`, 검사 13개
- [ ] 훅이 실제 실행에서 발동하는 것 확인 ← 크레딧 필요 (로직·연결은 검사·타입으로 확인됨)
- [x] 승인 없이 쓰기 도구가 실행되지 않는지 실제 실행에서 확인 (`gate-deny`)
- [x] 승인 후 실행 + 되돌리기 (`gate-approve` — #9001 생성→닫힘)
- [x] 종료 조건 실제 발동 (`cap-stopped` — maxToolCalls)
- [ ] 위 세 실행의 **화면 캡처** (터미널 출력은 기록으로 남았고, 화면은 웹앱 이후)

## 5. 화면과 재개 — 채점 3·4번

**구현 완료.** `cd app && npm run dev` → http://localhost:3010

- [x] 시작 화면 — 픽스처·축 선택, 지난 실행 목록, 키 없으면 잠금
- [x] 진행 화면 + 실행 로그 펼쳐보기 (도구·입력·출력 **전문**·시각)
- [x] 소요 시간 · 토큰 · 비용 표시 + **추정값 표기**
- [x] `usage_known: false` 면 0 이 아니라 **"확인 못 함"** 으로 그린다
- [x] 질문 대기 UI — 선택지와 설명, "정상 상태" 안내
- [x] 승인 대기 UI — 쓸 내용 펼쳐 본 뒤 승인/거절, 결정 이력
- [x] 중단 후 **재개/재시도** — 걸려 있던 질문·승인은 읽기 전용으로만 (누를 수 없는 버튼을 안 보여준다)
- [x] 카드 차트 표시 (SVG 서빙)
- [x] 다크 모드 · 모바일 폭 확인
- [x] V3 지난 버전 답변 → `409 stale_version`
- [x] V5 재시작 후 제출 → `409 no_live_callback` + 재개 경로
- [x] 중복 제출 → `409 already_answered` / `already_decided`
- [ ] V1 새로고침 유지 · V2 두 번 제출 · V4 실패 후 재시도 ← **살아 있는 실행 필요 (크레딧)**
- [ ] V6 실행 두 개 — 질문·세션 안 섞임 ← 위와 같음
- [ ] `evidence/02-verification.md` 4칸 표 작성
- [ ] 화면 캡처 → `evidence/screens/`

⚠️ **크레딧 소진**: `Credit balance is too low`. 화면 자체는 상태를 심어 확인했지만,
모델이 도는 실행에서의 질문 대기·승인·재개는 크레딧 충전 후 확인해야 한다.

## 6. 카드 제작과 내보내기

- [ ] **로컬에서 `agy`로 표지 삽화 생성** → 커밋, 실행 기록 보관
- [ ] 스토리보드 5~8장 → 승인
- [ ] `render_chart` 로 지표 카드
- [ ] 제목·본문·출처를 **별도 텍스트 레이어**로
- [ ] 카드 1장만 수정 → 나머지 유지 (텍스트만 고칠 때 차트 재렌더링 안 함)
- [ ] PNG · ZIP · `evidence/SOURCES.md` 근거 기록
- [ ] 내려받은 ZIP을 **열어서** 순서·수량·글자 잘림·한글 표시 점검

## 7. 평가 — 채점 4번

- [ ] 자동 채점 스크립트 (환각·근거미표기·결측오독·필수누락·우선순위)
- [ ] 기준 실행 — 픽스처 4개 × 3회 이상
- [ ] `f4-sparse` 에서 **결측을 0으로 읽지 않는지** 확인
- [ ] `f3-metric-drop` 에서 **원인을 단정하지 않는지** 확인
- [ ] 세팅 변화 실험 E1~E4 (E2는 방향 반대 — 검사를 껐을 때 나빠지는지)
- [ ] 실패 사례 수집·분류 → `EVAL.md`
- [ ] 편차를 함께 적고, 편차와 무관한 변화만 개선으로

## 8. 확장② — 되돌리기

- [ ] `revert_issue` — 승인 기록에 있는 이슈만
- [ ] 되돌리기도 승인 게이트를 지난다
- [ ] 되돌린 사실이 실행 기록에 남는지
- [ ] 승인 기록에 없는 이슈 번호로 시도 → 거절 확인
- [ ] 전후 캡처 (생성 → 되돌림 → 닫힘)

## 9. 캡처와 마무리

- [ ] `RUN.md` 의 캡처 목록 전부 확보 → `evidence/`
- [ ] `README.md` 완성 — 실행 방법, 평가 결과 요약, 남은 과제, 밝혀 두는 것
- [ ] `evidence/04-failure.md` — 실패 사례 1건 이상 + 개선 + 재실행
- [ ] `git log`까지 훑어 키·토큰 없는지 확인
- [ ] 남은 TODO 확인

```bash
grep -rn "TODO" --include="*.md" .
```

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
| 비용을 실제 청구액처럼 적음 | 클라이언트 측 추정값이다. 「밝혀 두는 것」에 명시 |
| 캡처 누락 | 재현하기 번거로운 것(서버 재시작 재개, 종료 조건 발동)을 그 자리에서 먼저 |
| 확장이 실제로 확장인지 | ① Claude Code에서 내 MCP 서버가 붙는 화면 ② 되돌리기 전후 — 둘 다 캡처로 증명 |
