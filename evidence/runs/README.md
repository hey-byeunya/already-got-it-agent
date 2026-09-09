# 실행 기록

실제 모델(Claude Agent SDK)로 돌린 실행의 기록이다. 픽스처 모드이므로 외부 API 를 부르지 않고,
쓰기 도구도 실제 GitHub 을 바꾸지 않는다(`simulated: true`).

| 실행 | 무엇을 확인하는가 | 결과 |
|---|---|---|
| `gate-deny/` | **승인 없이 쓰기 도구가 실행되지 않는다** (채점 2번) | 모델이 `create_github_issue` 호출 → 게이트가 가로채 거절 → 모델이 브리핑에 남기고 재시도 없이 넘어감 |
| `gate-approve/` | 승인 후 실행, 그리고 **되돌리기** (채점 2번 · 확장②) | `#9001` 생성 → 곧바로 `revert_issue` 로 닫힘. 두 호출 모두 승인을 지났다 |
| `cap-stopped/` | **종료 조건이 실제로 걸린다** (채점 3번) | `OPS_MAX_TOOL_CALLS=2` 로 낮춰 실행 → 3회째에 `maxToolCalls` 발동, `stopped` |
| `charts/` | `render_chart` 의 근거 대조를 통과한 SVG | 3장. 모두 `source_verified: true` |

## 읽는 법

`toolcalls.jsonl` — 한 줄이 도구 호출 하나. 입력·출력 **전문**과 소요 시간이 들어 있다.
요약만 남기면 사후에 무엇이 오갔는지 되짚을 수 없어서 전문을 남긴다.

```sh
python3 -c "
import json,sys
for l in open('evidence/runs/gate-approve/toolcalls.jsonl'):
    r=json.loads(l); print(('✓' if r['ok'] else '✖'), r['tool'], r['elapsed_ms'], 'ms')
"
```

`approvals.json` — 발급된 승인 토큰과 승인 기록. `log` 의 `created` 항목이
`revert_issue` 의 허용 범위가 된다.

## 승인 게이트가 막은 근거

`gate-deny` 실행은 SDK 의 `permission_denials` 에 1건을 남겼다. 앱이 스스로 "막았다"고
주장하는 것이 아니라 SDK 쪽 기록으로 확인된다.

## 비용에 대해

`cap-stopped` 는 종료 조건으로 중단돼 결과 메시지를 받지 못했다. 그런 실행은 비용을
**0 으로 적지 않고 "확인 못 함"으로** 남긴다 — 토큰은 이미 썼기 때문이다.

처음 구현에서는 이 경우에 `$0.0000` 을 보고했다. 캐시 읽기 58,094 토큰을 쓴 실행이었다.
이 프로젝트가 겨냥하는 "조용한 실패"를 코드가 저지른 자리라, `DECISIONS.md` D15 와
검사(`agent/test/limits-usage.test.ts`)에 남겼다.
