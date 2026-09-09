# 캡처 안내

**이 파일은 사람이 PNG 를 남기기 위한 안내다.** 화면 흐름은 전부 검증했지만
스크린샷 파일 저장은 사람이 해야 한다 — 자동화 도구가 임의 경로에 PNG 를 쓸 수 없었다.

기계 기록은 이미 `../runs/` 에 있다. 캡처는 **사람이 화면에서 본 것**을 증명하는 몫이다.

## 준비

```sh
cd already-got-it-agent/app && npm run dev     # http://localhost:3010
```

`.env.local` 의 `ANTHROPIC_API_KEY` 가 주석 처리돼 있으면 구독 로그인으로 돈다.

## 이미 만들어 둔 실행 두 개로 8장을 뜰 수 있다

두 실행의 상태가 `runs/` 에 남아 있어 **모델을 다시 부르지 않고** 화면을 열 수 있다.

| 실행 | URL | 상태 |
|---|---|---|
| `web-mtu1tqmf` | http://localhost:3010/runs/web-mtu1tqmf | `done` · 차트 3장 · 비용 $0.4287 · 거절 이력 |
| `web-mtu21ejs` | http://localhost:3010/runs/web-mtu21ejs | `stopped` · 종료 조건 발동 · 비용 "확인 못 함" |

| 파일명 | 어디서 | 무엇이 보여야 하는가 |
|---|---|---|
| `01-start.png` | `/` | 픽스처 선택 · 「자격증명」 패널에 구독 로그인 표시 |
| `02-usage-cost.png` | `web-mtu1tqmf` 상단 | `done` 배지 · 토큰 4칸 · **"클라이언트 측 추정값"** · **"구독으로 돌았다 — API 크레딧에서 차감되지 않는다"** |
| `03-decisions.png` | 같은 화면 「사람이 결정한 것」 | 질문 답변 = `이대로 진행 (권장)` · `create_github_issue` = **거절(빨간색)** |
| `04-charts.png` | 같은 화면 「생성된 카드 차트」 | SVG 3장 · 캡션 *"근거 대조를 통과한 값만 그려진다"* |
| `05-trace-expanded.png` | 같은 화면 「실행 로그」 (32건) | 「펼쳐 보기」 를 열어 **도구 입력·출력 전문**이 보이게 |
| `06-stopped-limit.png` | `web-mtu21ejs` 상단 | `stopped` · **「종료 조건에 걸려 멈췄다 — maxToolCalls」 (관측 3 / 허용 2)** |
| `07-cost-unknown.png` | 같은 화면 「실행 비용」 | **"확인 못 함"** · *"토큰은 이미 썼으므로 0 으로 적지 않는다 (아는 값: 캐시 읽기 47,129 토큰)"* |
| `08-interrupted.png` | 서버를 껐다 켠 뒤 진행 중 실행 | `interrupted` · 「중단됨」 · **「세션으로 재개」 가 비활성**(세션 없음) · 「처음부터 재시도」 |

`08` 은 실행이 살아 있는 동안 서버를 재시작해야 나온다. 만드는 방법:

```sh
# 1) 브리핑 시작 → 20초 기다린다
# 2) 개발 서버를 껐다 켠다
# 3) 그 실행 페이지를 새로고침 → interrupted 로 바뀐다
```

## 새로 실행해야 나오는 2장

이 둘은 살아 있는 실행에서만 뜬다. 브리핑을 한 편 시작해 흐름을 따라간다(약 3분, 추정 $0.3~0.4).

| 파일명 | 언제 | 무엇이 보여야 하는가 |
|---|---|---|
| `09-question-waiting.png` | 스토리보드 승인 질문이 뜰 때 | `waiting_for_user` · *"답하기 전에는 다음 단계로 넘어가지 않는다. 이 상태는 정상이다"* · 선택지와 설명 |
| `10-approval-waiting.png` | `create_github_issue` 승인 요청이 뜰 때 | ⚠️ 배지 · *"승인하면 1회용 토큰을 주입한다. 모델은 토큰을 받지 않으므로 스스로 실행할 수 없다"* · **「무엇을 쓰려는지」 펼친 상태** |

## 확장① — Claude Code 에서 MCP 서버

```sh
cd already-got-it-agent/mcp-server && npm run build && cd .. && claude
```

`/mcp` 로 연결 확인 → 도구 7개가 뜬다. 이 화면을 `11-mcp-in-claude-code.png` 로.

## 이번 세션에서 검증한 것 (캡처만 남은 상태)

화면 흐름은 실제 모델 실행으로 전부 확인했다. 근거는 `../runs/web-mtu1tqmf/ui-state.json` 과
`../runs/web-mtu21ejs/ui-state.json` 에 있다.

| 확인한 것 | 근거 |
|---|---|
| 질문 대기 → 답변 → 이어감 | `answered` 1건, 상태가 `waiting_for_user` → `running` → `done` |
| **같은 답변 두 번 제출 거절** | API 가 `409 already_answered` 반환, `answered` 는 1건뿐 |
| 승인 대기 → 화면에서 거절 → 이어감 | `decisions` 에 `approved: false, reason: "화면에서 거절"` |
| 서버 재시작 후 `interrupted` + 재시도 성공 | `web-mtu21ejs` 의 로그가 재시작 전 7건 + 재시도 후로 이어짐 |
| 종료 조건 발동 | `stop_reason: {limit: maxToolCalls, observed: 3, allowed: 2}` |
| 중단 시 비용을 0 으로 적지 않음 | `usage_known: false`, `unknown_reason` 에 사유, 캐시 읽기 47,129 는 남김 |
