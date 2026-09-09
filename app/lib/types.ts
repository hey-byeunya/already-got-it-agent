/** 화면과 서버가 주고받는 실행 상태. API_SPEC.md 의 상태값을 그대로 쓴다. */
export type RunStatus =
  | 'planning' | 'running' | 'waiting_for_user'
  | 'failed' | 'stopped' | 'done'
  /** 서버가 재시작돼 메모리에서 기다리던 콜백이 사라진 상태. */
  | 'interrupted';

export type TraceEvent = {
  seq: number;
  at: string;
  kind: string;
  /** 사람이 읽을 한 줄. */
  label: string;
  /** 펼쳐 볼 상세 (도구 입력·출력 전문 등). */
  detail?: string;
  isError?: boolean;
};

export type PendingQuestion = {
  question_id: string;
  version: number;
  questions: {
    question: string;
    header: string;
    options: { label: string; description: string }[];
    multiSelect?: boolean;
  }[];
};

export type PendingApproval = {
  approval_id: string;
  version: number;
  tool: string;
  /** 사람이 승인 전에 봐야 하는 내용. */
  summary: Record<string, unknown>;
};

export type UsageView = {
  usage_known: boolean;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  total_cost_usd: number;
  cost_is_estimate: true;
  unknown_reason?: string;
};

export type RunState = {
  run_id: string;
  fixture_id: string | null;
  status: RunStatus;
  created_at: string;
  updated_at: string;
  session_id?: string;
  goal: string;
  trace: TraceEvent[];
  pending_question: PendingQuestion | null;
  pending_approval: PendingApproval | null;
  /** 답한 질문. 같은 질문을 다시 묻지 않기 위해 남긴다. */
  answered: { question_id: string; version: number; answers: Record<string, string> }[];
  /** 승인·거절 이력. */
  decisions: { approval_id: string; tool: string; approved: boolean; reason?: string; at: string }[];
  usage: UsageView | null;
  stop_reason?: { limit: string; message: string; observed: number; allowed: number };
  final_text?: string;
  charts: { card_no: number; svg_path: string }[];
  /** 이 실행을 이 서버 프로세스가 돌리고 있는가. 재시작 감지에 쓴다. */
  live: boolean;
  /** 어느 자격증명으로 돌았는가. 비용이 어느 지갑에서 빠지는지가 달라진다. */
  credential_source?: 'api_key' | 'auth_token' | 'stored_login';
};
