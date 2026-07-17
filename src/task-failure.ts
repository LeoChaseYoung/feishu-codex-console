export type TaskFailureKind =
  | "timeout"
  | "policy"
  | "permission"
  | "connection"
  | "queue"
  | "unknown";

export interface TaskFailurePresentation {
  kind: TaskFailureKind;
  title: string;
  nextAction: string;
}

export function taskFailurePresentation(message: string): TaskFailurePresentation {
  const normalized = message.toLocaleLowerCase();
  if (/timeout|timed out|超时/.test(normalized)) {
    return {
      kind: "timeout",
      title: "任务超过运行时限",
      nextAction: "先查看已经写入的文件变更，再缩小任务范围或调整 CODEX_TIMEOUT_MS 后重试。",
    };
  }
  if (/安全闸门|policy|not allowed|blocked command|禁止/.test(normalized)) {
    return {
      kind: "policy",
      title: "安全策略已停止任务",
      nextAction: "修改任务要求；如果确实需要提交、推送、部署或 PR，请通过确认卡单独授权。",
    };
  }
  if (/permission denied|eacces|operation not permitted|权限不足|无权/.test(normalized)) {
    return {
      kind: "permission",
      title: "当前权限不足",
      nextAction: "检查成员角色、项目 ACL 和本轮任务权限；不要直接扩大到完全访问。",
    };
  }
  if (/app-server|connection|socket|econn|broken pipe|连接|断开|closed/.test(normalized)) {
    return {
      kind: "connection",
      title: "Codex 连接中断",
      nextAction: "先在设备控制台重连 Codex，确认在线后再重试；已写入的文件不会自动回滚。",
    };
  }
  if (/queue|队列/.test(normalized)) {
    return {
      kind: "queue",
      title: "任务未能进入队列",
      nextAction: "等待当前任务结束，或停止不再需要的排队任务后重试。",
    };
  }
  return {
    kind: "unknown",
    title: "任务执行失败",
    nextAction: "先查看文件变更和错误原因；可以重试，仍失败时运行 doctor 并查看本地日志。",
  };
}
