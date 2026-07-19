export const PROJECT_CHAT_SCOPES = [
  "im:chat:create",
  "im:chat.members:write_only",
  "im:message.pins:write_only",
] as const;

export const PROJECT_CHAT_MESSAGE_SCOPES = [
  "im:message.group_msg",
  "im:message.group_msg:readonly",
] as const;

const PROJECT_CHAT_MESSAGE_SCOPE_LABEL =
  "im:message.group_msg（或 im:message.group_msg:readonly）";

export interface ProjectChatScopeAssessment {
  status: "ready" | "missing" | "unknown";
  missing: string[];
  detail: string;
}

export interface ProjectChatRuntimeEvidence {
  totalBindings: number;
  readyBindings: number;
  messageVerifiedBindings: number;
  lastVerifiedAt: string | null;
}

export function assessProjectChatScopes(
  exitCode: number | null,
  output: string,
  runtimeEvidence?: ProjectChatRuntimeEvidence,
): ProjectChatScopeAssessment {
  if (exitCode !== 0) return runtimeAssessment(runtimeEvidence) ?? unknownAssessment();
  const payload = parseJsonOutput(output);
  const scopes = appScopes(payload);
  if (!scopes) return runtimeAssessment(runtimeEvidence) ?? unknownAssessment();
  const missing = [
    ...PROJECT_CHAT_SCOPES.filter((scope) => !scopes.has(scope)),
    ...(PROJECT_CHAT_MESSAGE_SCOPES.some((scope) => scopes.has(scope))
      ? []
      : [PROJECT_CHAT_MESSAGE_SCOPE_LABEL]),
  ];
  return missing.length === 0
    ? {
        status: "ready",
        missing: [],
        detail: "自动建群、邀请成员、置顶工作台和群内普通消息权限已验证",
      }
    : {
        status: "missing",
        missing,
        detail: `缺少 ${missing.join("、")}；运行 feishu-codex-bridge configure-feishu 可通过官方确认页一键补齐。私聊仍可使用，群内也可先 @ 机器人`,
      };
}

function runtimeAssessment(
  evidence?: ProjectChatRuntimeEvidence,
): ProjectChatScopeAssessment | null {
  if (!evidence || evidence.readyBindings === 0 || evidence.messageVerifiedBindings === 0) {
    return null;
  }
  const verifiedAt = evidence.lastVerifiedAt
    ? `；最近验证 ${evidence.lastVerifiedAt}`
    : "";
  return {
    status: "ready",
    missing: [],
    detail: `已有 ${evidence.readyBindings} 个项目群通过运行实证：成员、工作台、置顶和群内普通消息均成功${verifiedAt}`,
  };
}

function unknownAssessment(): ProjectChatScopeAssessment {
  return {
    status: "unknown",
    missing: [],
    detail: "当前 lark-cli 身份未返回应用级权限；私聊可用，项目群普通消息能力尚未验证，群内可先 @ 机器人使用",
  };
}

function parseJsonOutput(output: string): unknown {
  try {
    const start = output.indexOf("{");
    return start >= 0 ? JSON.parse(output.slice(start)) : null;
  } catch {
    return null;
  }
}

function appScopes(payload: unknown): Set<string> | null {
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as Record<string, unknown>;
  for (const key of ["tenantScopes", "appScopes", "botScopes", "scopes"]) {
    const value = record[key];
    if (Array.isArray(value)) {
      return new Set(value.filter((scope): scope is string => typeof scope === "string"));
    }
  }
  return null;
}
