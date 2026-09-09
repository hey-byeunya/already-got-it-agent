# 화면 캡처

배포 URL 이 제출 요건에서 빠졌으므로 **캡처가 유일한 동작 증거**다.
각 캡처가 무엇을 증명하는지 여기 적어 둔다. 목록은 `../../RUN.md` 의 캡처 목록과 짝을 맞춘다.

화면은 터미널 형태다 (`DECISIONS.md` D25 · 바탕은 Claude Design 「운영 브리핑 개선안 v4」).
아래 캡처는 전부 **실제 실행 데이터**로 찍었다 — 목업이나 더미가 아니다.

## 캡처 목록

헤드리스 브라우저로 전체 페이지를 1440px 폭에서 받았다 (아래 「다시 찍는 법」).

| 파일 | 실행 | 무엇을 증명하는가 | 채점 |
|---|---|---|---|
| `ui-01-home.png` | — | 시작 화면 — 지난 실행 10건(상태·결과 한 줄·비용) · 픽스처 선택 · 자격증명 출처(구독 로그인). **비용을 모르는 실행은 «확인 못 함»** | 4 |
| `ui-02-run-done.png` | `web-mtucmfut` | 완주한 실행 **전체**. 프롬프트 줄 · `[ PROGRESS ]` 6단계 · `[ AXES ]` 4축 실수치 · `[ BUDGET ]` 상한 대비 게이지 · `[ DECIDED BY HUMAN ]` 4건(답변 1 · 승인 1 · 거절 2) · `[ CARDS ]` 7장(근거 대조를 통과한 차트 포함) · `[ TAIL -F ]` 61건 | 2·3·4 |
| `ui-03-stopped-usage.png` | `demo-stopped` | 종료 조건(`maxToolCalls`) 발동 + **`usage_known: false` → 호박색 «확인 못 함»** + 아는 값(캐시 읽기 58,094) | 3·4 |
| `ui-04-interrupted.png` | `demo-approval` | 서버 재시작 후 `interrupted`. `--resume` 은 세션이 없어 **비활성**, 걸려 있던 승인은 `[ STALE APPROVAL ] 무효` | 3 |
| `ui-05-empty-run.png` | `web-mtuaihxp` | 도구를 부르기 전에 실패한 실행. 네 축·카드·상한이 전부 없어도 **깨지지 않고 «없다»고 말한다** | 4 |

`ui-02` 한 장 안에 승인·거절·질문 답변이 모두 들어 있다 — 실행 하나를 끝까지 돌려 찍었기 때문이다.
살아 있는 승인·질문 게이트(누를 수 있는 상태)는 그 실행 도중에 확인했고, 결과가 `[ DECIDED BY HUMAN ]` 에 남았다.

### 아직 손으로 남겨야 하는 것

| 파일 | 무엇 | 왜 자동으로 못 찍나 |
|---|---|---|
| `10-mcp-in-claude-code.png` | Claude Code 에서 이 저장소의 MCP 서버가 붙어 도구 9개가 뜨는 화면 | 이 저장소 밖(다른 앱)의 화면이다 |

## 캡처하지 않고 기록으로 남긴 것

화면 캡처보다 기록이 더 강한 증거인 항목이 있다.

| 무엇 | 어디에 |
|---|---|
| 승인 없이 쓰기 도구가 거부된 사실 | `../runs/gate-deny/` + SDK `permission_denials` 1건 |
| 승인 후 실행과 되돌리기 | `../runs/gate-approve/approvals.json` (#9001 생성→닫힘) |
| 기준 실행 12시행 + 원고 전문 | `../../eval-results/E0/` |
| 세팅 변화 실험 E4 | `../../eval-results/E4/` |
| 카드뉴스 결과물(PNG·ZIP·출처) | `../cardnews/` |

캡처는 사람이 화면에서 본 것을, 기록은 기계가 남긴 것을 증명한다. 둘을 섞지 않는다.

## 다시 찍는 법

```bash
npm --prefix app run dev          # http://localhost:3010
```

전체 페이지를 받으려면 창 높이를 페이지 높이만큼 준다
(`document.body.scrollHeight` 로 재고 그 값을 넣는다).

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --hide-scrollbars --window-size=1440,4290 \
  --virtual-time-budget=7000 --screenshot=out.png http://localhost:3010/runs/<run-id>
```
