export type DeviceAvailabilityState =
  | "online"
  | "connecting"
  | "degraded"
  | "offline"
  | "error"
  | "maintenance";

export interface DeviceAvailability {
  state: DeviceAvailabilityState;
  title: string;
  detail: string;
  nextAction: string;
  canExecute: boolean;
  canInteract: boolean;
  sampledAt: string;
  lastSuccessfulTaskAt?: string;
}

interface ConsumerState {
  eventKey: string;
  ready: boolean;
}

interface CodexState {
  ready: boolean;
  lastError?: string;
}

interface ApiState {
  state: "idle" | "ready" | "degraded";
  consecutiveFailures: number;
  lastSuccessAt?: number;
  lastFailureAt?: number;
}

interface DeviceAvailabilityInput {
  consumers: ConsumerState[];
  codex: CodexState;
  api?: ApiState;
  sampledAt?: string;
  serviceHeartbeatAt?: string;
  heartbeatTimeoutMs?: number;
  lastSuccessfulTaskAt?: string;
  maintenance?: boolean;
}

export function deriveDeviceAvailability({
  consumers,
  codex,
  api,
  sampledAt = new Date().toISOString(),
  serviceHeartbeatAt,
  heartbeatTimeoutMs = 45_000,
  lastSuccessfulTaskAt,
  maintenance = false,
}: DeviceAvailabilityInput): DeviceAvailability {
  const common = {
    sampledAt,
    ...(lastSuccessfulTaskAt ? { lastSuccessfulTaskAt } : {}),
  };
  if (maintenance) {
    return {
      state: "maintenance",
      title: "设备正在维护",
      detail: "服务在线，但暂不接受新的 Codex 任务。",
      nextAction: "维护结束后刷新状态。",
      canExecute: false,
      canInteract: true,
      ...common,
    };
  }

  if (serviceHeartbeatAt) {
    const sampled = Date.parse(sampledAt);
    const heartbeat = Date.parse(serviceHeartbeatAt);
    if (!Number.isFinite(heartbeat) || sampled - heartbeat > heartbeatTimeoutMs) {
      return {
        state: "offline",
        title: "本地设备已离线",
        detail: "服务健康心跳已经过期，当前卡片不能证明设备仍可执行任务。",
        nextAction: "检查电脑电源、网络和后台服务；恢复后重新发送“状态”。",
        canExecute: false,
        canInteract: false,
        ...common,
      };
    }
  }

  const messages = consumers.find((consumer) => consumer.eventKey === "im.message.receive_v1");
  const cards = consumers.find((consumer) => consumer.eventKey === "card.action.trigger");
  if (!messages?.ready) {
    return {
      state: "connecting",
      title: "飞书连接正在恢复",
      detail: "消息事件尚未就绪，此时发送的新任务可能无法被本机接收。",
      nextAction: "等待连接恢复后重新发送“状态”。",
      canExecute: false,
      canInteract: false,
      ...common,
    };
  }
  if (!cards?.ready) {
    return {
      state: "degraded",
      title: "设备部分可用",
      detail: "文字消息可用，但卡片按钮连接正在恢复。",
      nextAction: "可以直接发送文字任务；需要按钮操作时稍后刷新状态。",
      canExecute: true,
      canInteract: false,
      ...common,
    };
  }
  if (api?.state === "degraded") {
    return {
      state: "degraded",
      title: "飞书发送链路正在恢复",
      detail: `消息接收正常，但最近 ${api.consecutiveFailures} 次飞书 API 请求失败；可靠文本回复会继续重试。`,
      nextAction: "任务仍可发送；若长时间没有回复，请检查网络后刷新状态。",
      canExecute: true,
      canInteract: true,
      ...common,
    };
  }
  if (codex.lastError && !codex.ready) {
    return {
      state: "error",
      title: "Codex 引擎异常",
      detail: truncate(codex.lastError, 240),
      nextAction: "点击“重连 Codex”验证登录和本地引擎。",
      canExecute: false,
      canInteract: true,
      ...common,
    };
  }
  return {
    state: "online",
    title: "可以开始任务",
    detail: codex.ready
      ? "飞书消息、卡片和 Codex 引擎均已连接。"
      : "飞书连接正常；Codex 引擎将在首个任务时按需启动。",
    nextAction: "直接发送完整任务，或先切换项目与模型。",
    canExecute: true,
    canInteract: true,
    ...common,
  };
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}
