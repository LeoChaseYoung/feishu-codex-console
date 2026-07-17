export interface CodexUsage {
  /** Sum of every model call made for this task/turn. */
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
  /** Number of model responses observed while completing the task. */
  model_calls?: number;
  /** Size of the final model call, useful for context-pressure diagnostics. */
  last_input_tokens?: number;
  last_cached_input_tokens?: number;
  model_context_window?: number;
}

export type CodexItemStatus = "in_progress" | "completed" | "failed" | "declined";

export type CodexThreadItem =
  | { id: string; type: "agent_message"; text: string }
  | { id: string; type: "reasoning" }
  | {
      id: string;
      type: "command_execution";
      command: string;
      aggregated_output: string;
      exit_code?: number;
      status: CodexItemStatus;
    }
  | {
      id: string;
      type: "file_change";
      changes: Array<{ path: string; kind: "add" | "delete" | "update" }>;
      status: CodexItemStatus;
    }
  | {
      id: string;
      type: "mcp_tool_call";
      server: string;
      tool: string;
      status: CodexItemStatus;
    }
  | { id: string; type: "web_search"; query: string }
  | {
      id: string;
      type: "todo_list";
      items: Array<{ text: string; completed: boolean }>;
    }
  | { id: string; type: "error"; message: string };

export type CodexEvent =
  | { type: "thread.started"; thread_id: string }
  | { type: "turn.started" }
  | { type: "turn.completed"; usage: CodexUsage | null }
  | { type: "turn.failed"; error: { message: string } }
  | { type: "error"; message: string }
  | {
      type: "item.started" | "item.updated" | "item.completed";
      item: CodexThreadItem;
    };

export interface CodexApprovalRequest {
  id: string;
  kind: "command" | "file_change" | "permissions";
  threadId: string;
  turnId: string;
  itemId: string;
  title: string;
  detail: string;
  command?: string;
  cwd?: string;
  reason?: string;
  requestedPermissions?: Record<string, unknown>;
}

export type CodexApprovalDecision = "accept" | "acceptForSession" | "decline";

export interface CodexQuestionOption {
  label: string;
  description: string;
}

export interface CodexQuestion {
  id: string;
  header: string;
  question: string;
  isOther: boolean;
  isSecret: boolean;
  options: CodexQuestionOption[];
}

export interface CodexQuestionRequest {
  id: string;
  threadId: string;
  turnId: string;
  itemId: string;
  questions: CodexQuestion[];
  autoResolutionMs: number | null;
}

export interface CodexInteractiveHandlers {
  requestApproval?: (request: CodexApprovalRequest) => Promise<CodexApprovalDecision>;
  requestUserInput?: (
    request: CodexQuestionRequest,
  ) => Promise<Record<string, string[]>>;
}
