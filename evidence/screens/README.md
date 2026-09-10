# 화면 캡처

배포 URL 이 제출 요건에서 빠졌으므로 **캡처가 유일한 동작 증거**다.
각 캡처가 무엇을 증명하는지 여기 적어 둔다. 목록은 `../../RUN.md` 의 캡처 목록과 짝을 맞춘다.

화면은 터미널 형태다 (`DECISIONS.md` D25 · 바탕은 Claude Design 「운영 브리핑 개선안 v4」).
아래 캡처는 전부 **실제 실행 데이터**로 찍었다 — 목업이나 더미가 아니다.

## 캡처 목록

헤드리스 브라우저로 전체 페이지를 1440px 폭에서 받았다 (아래 「다시 찍는 법」).

| 파일 | 실행 | 무엇을 증명하는가 | 채점 |
|---|---|---|---|
| `ui-01-home.png` | — | 시작 화면 — 머리의 **`LIVE`/`FIXTURE` 모드 배지**(D28) · 지난 실행 10건(상태·결과 한 줄·비용) · 자격증명 출처. **비용을 모르는 실행은 «확인 못 함»** | 4 |
| `ui-02-run-done.png` | `web-mtucmfut` | 완주한 실행 **전체**. 프롬프트 줄 · `[ PROGRESS ]` 6단계 · `[ AXES ]` 4축 실수치 · `[ BUDGET ]` 상한 대비 게이지 · `[ DECIDED BY HUMAN ]` 4건(답변 1 · 승인 1 · 거절 2) · `[ CARDS ]` 7장(근거 대조를 통과한 차트 포함) · `[ TAIL -F ]` 61건 | 2·3·4 |
| `ui-03-stopped-usage.png` | `demo-stopped` | 종료 조건(`maxToolCalls`) 발동 + **`usage_known: false` → 호박색 «확인 못 함»** + 아는 값(캐시 읽기 58,094) | 3·4 |
| `ui-04-interrupted.png` | `demo-interrupted` | 서버 재시작 후 `interrupted`. `--resume`·`--retry` 버튼, `[ STALE QUESTION ]` 무효 처리, 세션 ID 표시 | 3 |
| `ui-05-empty-run.png` | `web-mtuaform` (opencode 엔진) | 도구를 부르기 전에 실패한 실행. 네 축·카드·상한이 전부 없어도 **깨지지 않고 «없다»고 말한다** | 4 |
| `ui-06-cardnews-screen.png` | `web-mtucmfut` | **카드뉴스 제작 화면** — `[ CARDS ] 7` 전체. 로그 열이 접히는 1000px 폭이라 카드가 한 장씩 다 보인다. 카드마다 심각도 딱지·근거 줄이 붙어 있다 | 결과물 |
| `ui-07-cardnews-output.png` | `web-mtucmfut` | **내보낸 결과물** — `cardnews-web-mtucmfut.zip` 안의 PNG 7장(1080×1350)을 펼쳐 놓은 대지. 파일명·심각도·제목을 함께 적었다 | 결과물 |
| `ui-08-card-sample.png` | `web-mtucmfut` | 카드 낱장 원본 (1080×1350). `README.md` 가 이 파일을 보여준다 | 결과물 |

`ui-02` 한 장 안에 승인·거절·질문 답변이 모두 들어 있다 — 실행 하나를 끝까지 돌려 찍었기 때문이다.
살아 있는 승인·질문 게이트(누를 수 있는 상태)는 그 실행 도중에 확인했고, 결과가 `[ DECIDED BY HUMAN ]` 에 남았다.

### 바깥으로 나가는 링크

`ui-02` · `ui-06` 에서 이슈 `#11`·`#13`, PR `#14`, 저장소 이름, 검색 출처가 링크로 나간다
(`DECISIONS.md` D26). **이 실행이 실제로 조회한 번호만** 링크하므로
카드의 「함수 오류 47건」의 `47` 은 링크가 아니다.

픽스처 실행이라 그 참조는 스냅샷 안의 것이다 — 화면이 그 사실을 카드 머리에 적는다.
승인으로 «만든» 이슈는 `#9001 (시뮬레이션)` 으로만 적고 주소를 주지 않는다.

### 카드뉴스 결과물 (`ui-06` · `ui-07`)

`ui-07` 은 화면이 아니라 **실제로 내보낸 파일**이다. 같은 실행에서 나온 것들:

```
runs/web-mtucmfut/cardnews-web-mtucmfut.zip   466,772B
  cards/01.png ~ 07.png                       각 1080×1350
  SOURCES.md                                  카드별 근거 표
```

```
$ unzip -t runs/web-mtucmfut/cardnews-web-mtucmfut.zip
No errors detected in compressed data
```

**굽기는 사람이 누를 때만** 한다 (D27). `ui-06` 의 `[ CARDS ]` 위에 「카드뉴스 내보내기」
버튼이 있고, 누른 뒤에야 `⤓ 내려받기` 줄과 **카드 낱장 미리보기**가 생긴다.
카드마다 `⤓ png` 도 붙는다.

```
GET /api/runs/{id}/export/zip       → cardnews-{id}.zip
GET /api/runs/{id}/export/sources   → SOURCES.md
GET /api/runs/{id}/export/NN.png    → 카드 낱장
```

경로를 조립하지 않고 이 세 형태만 받는다 — `../` 나 널바이트를 섞은 요청은 400·404 로 막힌다.

ZIP 과 PNG 원본은 저장소에 넣지 않는다 (`.gitignore` 의 `evidence/cardnews/`) —
용량이 크고, **캡처와 `SOURCES.md` 로 충분히 증명된다.** 다시 만들려면 아래 「다시 찍는 법」 대로 실행한다.

### 아직 손으로 남겨야 하는 것

| 파일 | 무엇 | 왜 자동으로 못 찍나 |
|---|---|---|
| `mcp-in-claude-code.png` | Claude Code 에서 이 저장소의 MCP 서버가 붙어 도구 9개가 뜨는 화면 | 이 저장소 밖(다른 앱)의 화면이다 |

```sh
cd mcp-server && npm run build && cd .. && claude
```

### 살아 있는 상태를 만드는 법

`ui-04` 의 `interrupted` 와 살아 있는 질문·승인 게이트는 **끝난 실행에서는 뜨지 않는다.**
저장된 상태를 열어서는 나오지 않으므로 직접 만든다.

| 무엇 | 만드는 법 |
|---|---|
| 질문 대기 · 승인 대기 | 브리핑을 한 편 시작해 흐름을 따라간다 (약 3분, 추정 $0.3~0.4) |
| `interrupted` | ① 브리핑 시작 → 20초 기다린다 ② 개발 서버를 껐다 켠다 ③ 그 실행 페이지를 새로고침한다 |

메모리에서 기다리던 콜백이 사라지는 것이 `interrupted` 의 정의라, 서버를 껐다 켜는 것 말고는
만들 방법이 없다.

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
  --headless=new --disable-gpu --hide-scrollbars --window-size=1440,3060 \
  --virtual-time-budget=7000 --screenshot=out.png http://localhost:3010/runs/<run-id>
```

카드뉴스 결과물 대지(`ui-07`)는 내보낸 PNG 를 한곳에 모아 놓고 같은 방법으로 찍는다.
카드는 `compose_card` → `export_cardnews` 가 만든다 — 화면에서 브리핑을 한 번 돌리면 나온다.
