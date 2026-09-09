/**
 * 도메인 도구 7개. description 은 TOOLS.md 와 같은 계약을 따른다 —
 * 설명에 쓴 제약과 함수의 실제 검사가 어긋나면 설명은 아무것도 제한하지 못한다.
 */
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { config, isFixtureMode } from './config.js';
import { FatalToolError, ToolError } from './errors.js';
import { fixtureResponse, listFixtureIds } from './fixtures.js';
import { baseInput, defineTool } from './register.js';
import { openRun, runPath } from './runlog.js';
import { consume, appendLog, createdIssueNumbers, isAlreadyReverted } from './approvals.js';
import { renderBarChart, verifySource, writeSvg, type ChartPoint } from './chart.js';

const period = {
  since: z.string().describe('기간 시작 (ISO 8601)'),
  until: z.string().describe('기간 끝 (ISO 8601)'),
};

/** live 모드는 아직 붙이지 않았다. 조용히 빈 값을 돌려주는 대신 분명히 알린다. */
function requireFixtureMode(tool: string): void {
  if (!isFixtureMode()) {
    throw new FatalToolError('live_not_implemented',
      `${tool} 의 실제 API 연결은 아직 구현하지 않았다. OPS_MODE=fixture 로 실행한다`, { tool });
  }
}

/** 픽스처 응답이 error 를 담고 있으면 그대로 도구 오류로 올린다 — 실패 경로도 재현한다. */
function passthroughOrThrow(tool: string, value: unknown): unknown {
  if (value && typeof value === 'object' && 'error' in (value as Record<string, unknown>)) {
    const v = value as Record<string, unknown>;
    throw new ToolError(String(v.error), String(v.message ?? '픽스처가 재현한 실패'), {
      ...v, tool, reproduced_from: 'fixture',
    });
  }
  return value;
}

export function registerAllTools(server: McpServer): void {
  // ─────────────────────────────────────────────────────────── 1. 시스템 상태
  defineTool(server, {
    name: 'get_system_health',
    description:
      '「이미 있어」의 배포와 실행 상태를 가져온다. 시스템이 이번 기간에 문제가 없었는지 확인할 때 '
      + '가장 먼저 호출한다. 배포 성공/실패, 빌드 오류 원문, 함수 오류 수를 돌려준다. '
      + '시스템 상태를 추측하지 말고 반드시 이 도구로 확인한다. '
      + 'unavailable_fields 에 담긴 항목은 조회하지 못한 것이며 0 이 아니다 — 결측과 0 을 구별해 서술한다.',
    inputSchema: z.object({ ...baseInput, ...period }),
    handler: ({ run_id }) => {
      requireFixtureMode('get_system_health');
      const meta = openRun(run_id);
      return passthroughOrThrow('get_system_health', fixtureResponse(meta.fixture_id!, 'get_system_health'));
    },
  });

  // ─────────────────────────────────────────────────────────── 2. 사용자 지표
  defineTool(server, {
    name: 'get_user_metrics',
    description:
      '「이미 있어」 사용자 활동의 집계 지표를 가져온다. 가입 추이, 있템·위시 등록 수, 활성 사용자를 '
      + '기간별로 돌려준다. 개별 사용자나 개별 물건은 조회할 수 없다 — 이 도구는 집계값만 반환한다. '
      + 'previous_period_totals 가 있어야 늘었는지 줄었는지 말할 수 있다. null 이면 비교하지 않는다.',
    inputSchema: z.object({ ...baseInput, ...period,
      granularity: z.enum(['day', 'week']).default('day').describe('집계 단위') }),
    handler: ({ run_id }) => {
      requireFixtureMode('get_user_metrics');
      const meta = openRun(run_id);
      return passthroughOrThrow('get_user_metrics', fixtureResponse(meta.fixture_id!, 'get_user_metrics'));
    },
  });

  // ─────────────────────────────────────────────────────────── 3. 개발 활동
  defineTool(server, {
    name: 'get_dev_activity',
    description:
      '저장소의 개발 활동을 가져온다. 열린 이슈, 기간 내 커밋, PR 상태를 돌려준다. '
      + '무엇이 쌓이고 있고 무엇이 멈춰 있는지 판단할 때 호출한다. '
      + '이슈를 만들거나 닫지는 않는다 — 그건 create_github_issue 와 revert_issue 의 일이다.',
    inputSchema: z.object({ ...baseInput, ...period,
      repo: z.string().describe('owner/name 형식. 허용 목록 밖은 거절된다') }),
    handler: ({ run_id, repo }) => {
      requireFixtureMode('get_dev_activity');
      if (!config.allowedRepos.includes(repo)) {
        throw new FatalToolError('repo_not_allowed', '허용 목록에 없는 저장소다', {
          repo, allowed: config.allowedRepos,
        });
      }
      const meta = openRun(run_id);
      return passthroughOrThrow('get_dev_activity', fixtureResponse(meta.fixture_id!, 'get_dev_activity'));
    },
  });

  // ─────────────────────────────────────────────────────────── 4. 웹 검색
  defineTool(server, {
    name: 'web_search',
    description:
      '이 앱이 실제로 쓰는 의존성의 릴리스 노트나 보안 권고를 찾을 때만 호출한다. '
      + '시스템 상태나 사용자 지표를 알아내는 용도로는 쓰지 않는다 — 그건 앞의 세 도구의 일이다. '
      + '검색 결과 요약만으로 카드의 핵심 사실을 확정하지 않는다. '
      + 'published_at 이 null 인 결과는 게시일 미확인으로 표시한다.',
    inputSchema: z.object({ ...baseInput,
      query: z.string().describe('검색어'),
      max_results: z.number().int().min(1).max(10).default(5) }),
    handler: ({ run_id }) => {
      requireFixtureMode('web_search');
      const meta = openRun(run_id);
      return passthroughOrThrow('web_search', fixtureResponse(meta.fixture_id!, 'web_search'));
    },
  });

  // ─────────────────────────────────────────────────────────── 5. 차트
  defineTool(server, {
    name: 'render_chart',
    description:
      '앞선 조회 도구가 돌려준 값으로 카드에 넣을 SVG 차트를 그린다. '
      + 'source 필드가 필수다 — 어느 도구의 어느 값을 그리는지 밝혀야 한다. '
      + '직접 입력한 수치나 기억한 수치로는 차트를 그릴 수 없다. data 의 값이 source 가 가리키는 '
      + '결과에 실제로 없으면 source_mismatch 로 거절된다. '
      + '먼저 해당 조회 도구를 호출한 뒤에 쓴다.',
    inputSchema: z.object({ ...baseInput,
      card_no: z.number().int().min(1).describe('몇 번째 카드인가'),
      chart_type: z.enum(['bar']).default('bar').describe('현재는 bar 만 지원한다'),
      source: z.object({
        tool: z.string().describe('근거가 된 도구 이름. 이 실행에서 실제로 호출했어야 한다'),
        field: z.string().describe('그 도구 결과 안의 경로. 예: series[].signups, totals.active_users'),
        run_step: z.number().int().optional(),
      }).describe('근거. 없으면 차트를 그리지 않는다'),
      data: z.array(z.object({ label: z.string(), value: z.number() })).min(1),
      title: z.string(),
      highlight: z.object({ label: z.string(), note: z.string().optional() }).nullable().default(null),
    }),
    handler: ({ run_id, card_no, source, data, title, highlight }) => {
      // 근거 대조가 먼저다. 통과하지 못하면 파일을 만들지 않는다.
      verifySource(run_id, source, data as ChartPoint[]);

      const svg = renderBarChart({ title, data: data as ChartPoint[], highlight });
      const rel = `charts/${String(card_no).padStart(2, '0')}.svg`;
      const abs = runPath(run_id, rel);
      const { bytes, rendered_ok } = writeSvg(abs, svg);

      if (!rendered_ok) {
        throw new ToolError('render_failed', 'SVG 를 만들었지만 유효한 파일로 열리지 않는다', {
          card_no, path: rel, bytes,
        });
      }
      return { card_no, svg_path: rel, bytes, rendered_ok, source_verified: true, source };
    },
  });

  // ─────────────────────────────────────────────── 6. 이슈 생성 (쓰기 ⚠️)
  defineTool(server, {
    name: 'create_github_issue',
    description:
      '브리핑에서 발견한 문제를 저장소 이슈로 남긴다. 사람이 승인했을 때만 실행된다. '
      + '에이전트는 이 도구를 직접 실행하지 않는다 — 제안만 만들고 승인을 기다린다. '
      + '유효한 approval_token 없이 호출하면 approval_required 로 거절된다. '
      + '이슈 본문에는 근거가 된 도구와 값을 함께 적는다. 삭제·수정 권한은 없다.',
    requiresApproval: true,
    destructive: false,
    inputSchema: z.object({ ...baseInput,
      repo: z.string(),
      title: z.string().min(1),
      body: z.string().min(1),
      labels: z.array(z.string()).default([]),
      source: z.object({ tool: z.string(), field: z.string() })
        .describe('이 이슈의 근거가 된 도구와 값'),
      approval_token: z.string().optional()
        .describe('앱이 사람의 승인을 받은 뒤 발급한 1회용 토큰. 없으면 실행되지 않는다'),
    }),
    handler: ({ run_id, repo, title, body, labels, source, approval_token }) => {
      if (!config.allowedRepos.includes(repo)) {
        throw new FatalToolError('repo_not_allowed', '허용 목록에 없는 저장소다', {
          repo, allowed: config.allowedRepos,
        });
      }
      const bad = labels.filter((l) => !config.allowedLabels.includes(l));
      if (bad.length) {
        throw new ToolError('label_not_allowed', '허용 목록에 없는 라벨이다. 임의 라벨을 만들지 않는다', {
          rejected: bad, allowed: config.allowedLabels,
        });
      }

      // 승인 게이트 ② — 서버가 토큰을 검사한다. 앱을 우회해도 여기서 막힌다.
      consume(run_id, approval_token, 'create_github_issue', repo);

      if (!isFixtureMode()) {
        throw new FatalToolError('live_not_implemented',
          '실제 GitHub 쓰기는 아직 구현하지 않았다', { tool: 'create_github_issue' });
      }

      // fixture 모드: 실제 저장소를 바꾸지 않는다. 번호만 부여해 승인 기록에 남긴다.
      const number = 9000 + createdIssueNumbers(run_id).length + 1;
      appendLog(run_id, {
        at: new Date().toISOString(),
        tool: 'create_github_issue',
        target: repo,
        created: { issue_number: number, repo },
      });
      return {
        number, repo, created: true,
        url: `https://github.com/${repo}/issues/${number}`,
        simulated: true,
        note: 'fixture 모드다. 실제 이슈는 만들어지지 않았다',
        title, body_length: body.length, labels, source,
      };
    },
  });

  // ─────────────────────────────────────────── 7. 되돌리기 (쓰기 ⚠️ · 확장②)
  defineTool(server, {
    name: 'revert_issue',
    description:
      '이 실행이 승인 기록으로 만든 이슈를 닫아 되돌린다. '
      + '승인 기록에 없는 이슈 번호는 거절한다 — 이 도구로는 임의의 이슈를 닫을 수 없다. '
      + '삭제는 하지 않고 닫기만 한다. 되돌리기도 사람의 승인을 지난다.',
    requiresApproval: true,
    destructive: true,
    inputSchema: z.object({ ...baseInput,
      issue_number: z.number().int().describe('이 실행에서 만든 이슈 번호만 가능하다'),
      reason: z.string().min(1).describe('왜 되돌리는지. 실행 기록에 남는다'),
      approval_token: z.string().optional(),
    }),
    handler: ({ run_id, issue_number, reason, approval_token }) => {
      // 대상 제한이 토큰 검사보다 먼저다. 승인받아도 범위 밖은 못 닫는다.
      const allowed = createdIssueNumbers(run_id);
      if (!allowed.includes(issue_number)) {
        throw new ToolError('not_in_approval_log',
          '이 실행의 승인 기록에 없는 이슈다. 이 도구로는 임의의 이슈를 닫을 수 없다',
          { issue_number, created_in_this_run: allowed });
      }
      if (isAlreadyReverted(run_id, issue_number)) {
        return { number: issue_number, state: 'closed', reverted: true, already: true };
      }

      consume(run_id, approval_token, 'revert_issue', String(issue_number));

      if (!isFixtureMode()) {
        throw new FatalToolError('live_not_implemented',
          '실제 GitHub 쓰기는 아직 구현하지 않았다', { tool: 'revert_issue' });
      }

      appendLog(run_id, {
        at: new Date().toISOString(),
        tool: 'revert_issue',
        target: String(issue_number),
        reverted: { issue_number },
      });
      return { number: issue_number, state: 'closed', reverted: true, reason, simulated: true };
    },
  });
}

export const fixtureIdsForHelp = listFixtureIds;
