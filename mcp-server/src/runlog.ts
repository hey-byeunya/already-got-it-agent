/**
 * 실행 기록. 두 가지를 남긴다.
 *
 *  1. toolcalls.jsonl — 도구 호출 전문 (입력·출력·소요·성공 여부)
 *  2. run.json        — 이 실행의 모드와 픽스처
 *
 * 전문을 남기는 이유: Day 38 하네스는 도구 결과를 요약만 저장해서, 모델이 실제로 받은
 * 내용을 사후에 되짚을 수 없었다. 그 보고서가 스스로 지적한 한계다. 여기서는 전문을 남긴다.
 *
 * render_chart 의 source 대조도 이 기록을 근거로 한다 — 기록에 없는 값으로는 차트를 그릴 수 없다.
 */
import { mkdirSync, appendFileSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { config, type Mode } from './config.js';
import { FatalToolError } from './errors.js';

export type ToolCallRecord = {
  seq: number;
  at: string;
  tool: string;
  input: unknown;
  output: unknown;
  ok: boolean;
  elapsed_ms: number;
};

export type RunMeta = { run_id: string; mode: Mode; fixture_id: string | null; created_at: string };

function runDir(runId: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(runId)) {
    throw new FatalToolError('invalid_run_id', 'run_id 는 영문·숫자·_·- 로 된 1~64자여야 한다', { run_id: runId });
  }
  return join(config.runsDir, runId);
}

/** 실행을 열거나 이미 열린 실행을 가져온다. 첫 호출이 픽스처를 확정한다. */
export function openRun(runId: string, fixtureId?: string | null): RunMeta {
  const dir = runDir(runId);
  const metaPath = join(dir, 'run.json');

  if (existsSync(metaPath)) {
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as RunMeta;
    // 이미 열린 실행의 픽스처를 도중에 바꾸면 앞선 기록과 근거가 어긋난다.
    if (fixtureId && meta.fixture_id && fixtureId !== meta.fixture_id) {
      throw new FatalToolError(
        'fixture_conflict',
        '이미 다른 픽스처로 열린 실행이다. 픽스처를 바꾸려면 새 run_id 로 시작한다',
        { run_id: runId, opened_with: meta.fixture_id, requested: fixtureId },
      );
    }
    return meta;
  }

  const resolved = fixtureId ?? config.defaultFixtureId;
  if (config.mode === 'fixture' && !resolved) {
    throw new FatalToolError(
      'fixture_required',
      'fixture 모드에서는 fixture_id 가 필요하다. 도구 입력에 넘기거나 OPS_FIXTURE_ID 를 설정한다',
      { available_hint: 'f1-normal, f2-deploy-fail, f3-metric-drop, f4-sparse' },
    );
  }
  if (config.mode === 'live' && resolved) {
    throw new FatalToolError('fixture_in_live_mode', 'live 모드에서는 fixture_id 를 쓸 수 없다', {});
  }

  const meta: RunMeta = {
    run_id: runId,
    mode: config.mode,
    fixture_id: config.mode === 'fixture' ? resolved : null,
    created_at: new Date().toISOString(),
  };
  mkdirSync(dir, { recursive: true });
  writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  return meta;
}

export function record(runId: string, rec: Omit<ToolCallRecord, 'seq' | 'at'>): ToolCallRecord {
  const dir = runDir(runId);
  mkdirSync(dir, { recursive: true });
  const full: ToolCallRecord = { seq: readCalls(runId).length + 1, at: new Date().toISOString(), ...rec };
  // 한 줄씩 즉시 flush 한다. 프로세스가 죽어도 남게.
  appendFileSync(join(dir, 'toolcalls.jsonl'), JSON.stringify(full) + '\n');
  return full;
}

export function readCalls(runId: string): ToolCallRecord[] {
  const path = join(runDir(runId), 'toolcalls.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as ToolCallRecord);
}

/** 이 실행에서 특정 도구가 성공적으로 돌려준 마지막 결과. */
export function lastSuccessfulOutput(runId: string, tool: string): unknown | undefined {
  const calls = readCalls(runId).filter((c) => c.tool === tool && c.ok);
  return calls.length ? calls[calls.length - 1]!.output : undefined;
}

export function runPath(runId: string, ...parts: string[]): string {
  const dir = join(runDir(runId), ...parts);
  return dir;
}
