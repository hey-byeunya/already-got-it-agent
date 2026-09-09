/**
 * 서버 설정. 모드와 권한 범위를 여기 한 곳에서 정한다.
 *
 * 이 서버는 두 모드로 돈다.
 *  - fixture : 외부 API를 부르지 않고 fixtures/snapshots/*.json 을 읽는다.
 *              쓰기 도구도 실제 GitHub 을 바꾸지 않는다. 평가·캡처 재현용.
 *  - live    : 실제 API 를 부른다.
 *
 * 기본값은 fixture 다. 실수로 실제 저장소에 쓰는 것보다 실수로 픽스처를 읽는 편이 낫다.
 *
 * 값은 **읽을 때마다** 환경변수에서 가져온다. 모듈 로드 시점에 고정하면
 * 검사에서 실행마다 다른 작업 폴더를 줄 수 없고, 앞선 검사의 상태가 뒤로 새어 나간다.
 * (실제로 그렇게 만들었다가 검사 세 개가 서로의 상태를 물려받았다.)
 */
import { resolve } from 'node:path';

export type Mode = 'fixture' | 'live';

function readMode(): Mode {
  const raw = (process.env.OPS_MODE ?? 'fixture').trim();
  if (raw === 'live' || raw === 'fixture') return raw;
  throw new Error(`OPS_MODE 는 fixture 또는 live 여야 한다 (받은 값: ${raw})`);
}

function csv(raw: string | undefined, fallback: string): string[] {
  return (raw ?? fallback).split(',').map((s) => s.trim()).filter(Boolean);
}

export const config = {
  get mode(): Mode { return readMode(); },
  /** 실행 상태와 승인 기록이 쌓이는 곳. 앱과 이 서버가 같은 경로를 본다. */
  get runsDir(): string { return resolve(process.env.OPS_RUNS_DIR ?? 'runs'); },
  /** 평가용 스냅샷 위치. */
  get fixturesDir(): string { return resolve(process.env.OPS_FIXTURES_DIR ?? '../fixtures/snapshots'); },
  /** run 에 픽스처가 지정되지 않았을 때 쓰는 기본값. */
  get defaultFixtureId(): string | null { return process.env.OPS_FIXTURE_ID ?? null; },
  /** 허용 저장소 목록. 이 목록 밖의 repo 는 도구가 거절한다 (권한 최소화). */
  get allowedRepos(): string[] {
    return csv(process.env.GITHUB_ALLOWED_REPOS, 'hey-byeunya/already-got-it');
  },
  /** 라벨 허용 목록. 임의 라벨을 만들지 않는다. */
  get allowedLabels(): string[] {
    return csv(process.env.GITHUB_ALLOWED_LABELS, 'ops,bug,enhancement,question');
  },
  /** 승인 토큰 유효 시간 (초). */
  get approvalTtlSeconds(): number { return Number(process.env.OPS_APPROVAL_TTL ?? 600); },
};

export function isFixtureMode(): boolean {
  return config.mode === 'fixture';
}
