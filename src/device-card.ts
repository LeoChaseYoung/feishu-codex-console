import type { AccountQuotaSnapshot } from "./account-quota.js";
import { renderAccountQuotaSummary } from "./account-quota-card.js";
import type { FeishuCard } from "./task-card.js";
import type { DeviceAvailability, DeviceAvailabilityState } from "./device-health.js";

export interface DeviceConsoleSnapshot {
  deviceName: string;
  osLabel: string;
  uptimeLabel: string;
  availability: DeviceAvailability;
  project: {
    name: string;
    displayPath: string;
    isGitRepository: boolean;
  };
  codex: {
    state: "online" | "standby" | "error";
    pid?: number;
    restartCount: number;
    lastError?: string;
  };
  listener: {
    ready: boolean;
    restartCount: number;
  };
  remoteReady: {
    supported: boolean;
    enabled: boolean;
    active: boolean;
    lastError?: string;
  };
  powerLabel: string;
  activeTask?: string;
  queuedForConversation: number;
  activeTasks: number;
  queuedTasks: number;
  maxConcurrentTasks: number;
  threadCount: number;
  sandboxLabel: string;
  networkEnabled: boolean;
  accountQuota?: AccountQuotaSnapshot;
  feedback?: string;
}

export function renderDeviceCard(snapshot: DeviceConsoleSnapshot): FeishuCard {
  const presentation = statePresentation(snapshot.availability.state);
  const elements: Record<string, unknown>[] = [
    availabilityPanel(snapshot),
    remoteReadyPanel(snapshot),
    healthMetrics(snapshot),
    ...(snapshot.accountQuota
      ? [
          renderAccountQuotaSummary(
            snapshot.accountQuota,
            "dq",
            snapshot.availability.canInteract
              ? {
                  bridge: "feishu-codex-v4",
                  action: "device_quota",
                }
              : undefined,
          ),
        ]
      : []),
    currentProjectPanel(snapshot),
  ];

  if (snapshot.feedback) {
    elements.push({
      tag: "column_set",
      element_id: "feedback_panel",
      flex_mode: "none",
      columns: [
        {
          tag: "column",
          width: "weighted",
          weight: 1,
          background_style: "blue-50",
          padding: "10px 12px 10px 12px",
          elements: [
            {
              tag: "markdown",
              element_id: "device_feedback",
              text_size: "notation",
              content: `<font color='blue'>${safe(snapshot.feedback)}</font>`,
            },
          ],
        },
      ],
    });
  }

  elements.push(safetyNote(snapshot));
  if (!snapshot.availability.canInteract) {
    elements.push(connectionNotice(snapshot));
  } else if (snapshot.availability.canExecute) {
    elements.push(primaryActions(), workspaceActions());
  } else {
    elements.push(recoveryActions(snapshot));
  }
  if (snapshot.availability.canInteract) {
    const remote = remoteActions(snapshot);
    if (remote) elements.push(remote);
  }

  return {
    schema: "2.0",
    config: {
      update_multi: true,
      width_mode: "default",
      enable_forward: false,
      summary: {
        content: `本地 Codex 控制台 · ${truncatePlain(snapshot.deviceName, 40)} · ${presentation.label}`,
      },
      style: {
        text_size: {
          device_title: { default: "heading-4", pc: "heading-4", mobile: "normal" },
          device_caption: { default: "notation", pc: "notation", mobile: "notation" },
        },
      },
    },
    header: {
      title: { tag: "plain_text", content: "本地 Codex 控制台" },
      subtitle: {
        tag: "plain_text",
        content: `${truncatePlain(snapshot.deviceName, 32)} · ${truncatePlain(snapshot.project.name, 36)}`,
      },
      template: presentation.template,
      icon: { tag: "standard_icon", token: "myai_colorful" },
      text_tag_list: [
        {
          tag: "text_tag",
          text: { tag: "plain_text", content: presentation.tag },
          color: presentation.color,
        },
        {
          tag: "text_tag",
          text: {
            tag: "plain_text",
            content: !snapshot.remoteReady.supported
              ? "唤醒不支持"
              : snapshot.remoteReady.active
                ? "持续唤醒"
                : "按需唤醒",
          },
          color: snapshot.remoteReady.active ? "blue" : "neutral",
        },
      ],
    },
    body: {
      direction: "vertical",
      padding: "12px 12px 20px 12px",
      vertical_spacing: "12px",
      elements,
    },
  };
}

function availabilityPanel(snapshot: DeviceConsoleSnapshot): Record<string, unknown> {
  const presentation = statePresentation(snapshot.availability.state);
  const lastSuccess = snapshot.availability.lastSuccessfulTaskAt
    ? formatTime(snapshot.availability.lastSuccessfulTaskAt)
    : "暂无成功任务";
  return {
    tag: "column_set",
    element_id: "device_state_panel",
    flex_mode: "none",
    columns: [
      {
        tag: "column",
        width: "weighted",
        weight: 1,
        background_style: presentation.background,
        padding: "12px 12px 12px 12px",
        vertical_spacing: "4px",
        elements: [
          {
            tag: "markdown",
            element_id: "device_state_title",
            text_size: "device_title",
            content: `**<font color='${presentation.textColor}'>${safe(snapshot.availability.title)}</font>**`,
          },
          {
            tag: "markdown",
            element_id: "device_state_detail",
            text_size: "device_caption",
            content: safe(snapshot.availability.detail),
          },
          {
            tag: "markdown",
            element_id: "device_state_next",
            text_size: "device_caption",
            content: `<font color='grey'>${safe(snapshot.availability.nextAction)}\n状态采样 ${safe(formatTime(snapshot.availability.sampledAt))} · 本人最后成功 ${safe(lastSuccess)}</font>`,
          },
        ],
      },
    ],
  };
}

function remoteReadyPanel(snapshot: DeviceConsoleSnapshot): Record<string, unknown> {
  const status = !snapshot.remoteReady.supported
    ? "当前系统不支持远程就绪"
    : snapshot.remoteReady.active
    ? "远程就绪已开启"
    : snapshot.remoteReady.enabled
      ? "远程就绪启动失败"
      : "远程就绪未开启";
  const color = snapshot.remoteReady.active
    ? "green"
    : snapshot.remoteReady.enabled
      ? "red"
      : "grey";
  const background = snapshot.remoteReady.active
    ? "blue-50"
    : snapshot.remoteReady.enabled
      ? "red-50"
      : "grey-50";
  const detail = !snapshot.remoteReady.supported
    ? "Remote Ready 目前仅支持 macOS；仍需自行保证电源、网络和系统唤醒"
    : snapshot.remoteReady.lastError
    ? safe(truncate(snapshot.remoteReady.lastError, 240))
    : snapshot.remoteReady.active
      ? "桥接服务运行期间，macOS 不会因空闲自动睡眠"
      : "开启后可降低人在外面时本机因空闲而离线的概率";

  return {
    tag: "column_set",
    element_id: "remote_ready_panel",
    flex_mode: "none",
    columns: [
      {
        tag: "column",
        width: "weighted",
        weight: 1,
        background_style: background,
        padding: "12px 12px 12px 12px",
        vertical_spacing: "4px",
        elements: [
          {
            tag: "markdown",
            element_id: "remote_ready_status",
            text_size: "device_title",
            content: `**<font color='${color}'>${status}</font>**`,
          },
          {
            tag: "markdown",
            element_id: "remote_ready_detail",
            text_size: "device_caption",
            content: `<font color='grey'>${safe(snapshot.powerLabel)} · ${detail}</font>`,
          },
        ],
      },
    ],
  };
}

function healthMetrics(snapshot: DeviceConsoleSnapshot): Record<string, unknown> {
  const codexLabel =
    snapshot.codex.state === "online"
      ? "在线"
      : snapshot.codex.state === "error"
        ? "异常"
        : "待命";
  const taskLabel = snapshot.activeTask
    ? `运行 1 · 等待 ${snapshot.queuedForConversation}`
    : snapshot.queuedForConversation > 0
      ? `等待 ${snapshot.queuedForConversation}`
      : "空闲";
  const listenerLabel = statePresentation(snapshot.availability.state).metric;

  return {
    tag: "column_set",
    element_id: "health_metrics",
    flex_mode: "none",
    horizontal_spacing: "8px",
    columns: [
      metricColumn("codex_metric", codexLabel, "Codex 引擎"),
      metricColumn("task_metric", taskLabel, "当前聊天"),
      metricColumn("listen_metric", listenerLabel, "飞书连接"),
    ],
  };
}

function metricColumn(elementId: string, value: string, label: string): Record<string, unknown> {
  return {
    tag: "column",
    width: "weighted",
    weight: 1,
    background_style: "grey-50",
    padding: "10px 4px 10px 4px",
    vertical_spacing: "2px",
    elements: [
      {
        tag: "markdown",
        element_id: `${elementId}_value`,
        text_align: "center",
        content: `**${safe(truncatePlain(value, 24))}**`,
      },
      {
        tag: "markdown",
        element_id: `${elementId}_label`,
        text_align: "center",
        text_size: "device_caption",
        content: `<font color='grey'>${label}</font>`,
      },
    ],
  };
}

function currentProjectPanel(snapshot: DeviceConsoleSnapshot): Record<string, unknown> {
  const taskLine = snapshot.activeTask
    ? `任务 ${safe(snapshot.activeTask)} 正在执行`
    : `全局 ${snapshot.activeTasks} 个运行中 · ${snapshot.queuedTasks} 个排队中`;
  return {
    tag: "column_set",
    element_id: "device_project_panel",
    flex_mode: "none",
    columns: [
      {
        tag: "column",
        width: "weighted",
        weight: 1,
        background_style: "grey-50",
        padding: "12px 12px 12px 12px",
        vertical_spacing: "4px",
        elements: [
          {
            tag: "markdown",
            element_id: "device_project_label",
            text_size: "device_caption",
            content: "<font color='grey'>当前项目</font>",
          },
          {
            tag: "markdown",
            element_id: "device_project_name",
            content: `**${safe(snapshot.project.name)}**  ${snapshot.project.isGitRepository ? "<text_tag color='blue'>Git</text_tag>" : "<text_tag color='neutral'>文件夹</text_tag>"}`,
          },
          {
            tag: "markdown",
            element_id: "device_project_path",
            text_size: "device_caption",
            content: `<font color='grey'>${safe(snapshot.project.displayPath)}\n${taskLine} · 已保存 ${snapshot.threadCount} 个会话\n${safe(snapshot.osLabel)} · 已运行 ${safe(snapshot.uptimeLabel)}</font>`,
          },
        ],
      },
    ],
  };
}

function safetyNote(snapshot: DeviceConsoleSnapshot): Record<string, unknown> {
  const network = snapshot.networkEnabled ? "网络已开启" : "网络已关闭";
  return {
    tag: "markdown",
    element_id: "device_safety_note",
    text_size: "device_caption",
    content: `<font color='grey'>${safe(snapshot.sandboxLabel)} · ${network} · 提交、推送、部署和 PR 仍需单独确认。合盖后 macOS 仍可能休眠。</font>`,
  };
}

function primaryActions(): Record<string, unknown> {
  return {
    tag: "column_set",
    element_id: "primary_actions",
    flex_mode: "none",
    horizontal_spacing: "8px",
    columns: [
      actionColumn("device_refresh", "刷新状态", "primary_filled", "device_refresh"),
      actionColumn("device_projects", "切换项目", "default", "device_projects"),
      actionColumn("device_new_session", "新会话", "default", "device_new_session", {
        title: "开启新会话？",
        text: "会清除当前聊天保存的 Codex 上下文，并停止未完成任务。",
      }),
    ],
  };
}

function workspaceActions(): Record<string, unknown> {
  return {
    tag: "column_set",
    element_id: "workspace_actions",
    flex_mode: "none",
    horizontal_spacing: "8px",
    columns: [
      actionColumn("device_settings", "模型设置", "default", "device_settings"),
      actionColumn("device_sessions", "历史会话", "default", "device_sessions"),
      actionColumn("device_tasks", "任务中心", "default", "device_tasks"),
    ],
  };
}

function recoveryActions(snapshot: DeviceConsoleSnapshot): Record<string, unknown> {
  const columns = [
    actionColumn("device_refresh", "重新检查", "primary_filled", "device_refresh"),
  ];
  if (snapshot.availability.state === "error") {
    columns.push(
      actionColumn("device_reconnect", "重连 Codex", "default", "device_reconnect"),
    );
  } else {
    columns.push(actionColumn("device_tasks", "查看任务", "default", "device_tasks"));
  }
  return {
    tag: "column_set",
    element_id: "recovery_actions",
    flex_mode: "none",
    horizontal_spacing: "8px",
    columns,
  };
}

function connectionNotice(snapshot: DeviceConsoleSnapshot): Record<string, unknown> {
  return {
    tag: "markdown",
    element_id: "connection_notice",
    text_size: "device_caption",
    content: `<font color='grey'>控制按钮已暂时隐藏，避免把无法送达的操作显示成可执行。${safe(snapshot.availability.nextAction)}</font>`,
  };
}

function remoteActions(snapshot: DeviceConsoleSnapshot): Record<string, unknown> | null {
  const remoteAction = snapshot.remoteReady.active
    ? "remote_ready_disable"
    : "remote_ready_enable";
  const remoteLabel = snapshot.remoteReady.active ? "关闭远程就绪" : "开启远程就绪";
  const columns: Record<string, unknown>[] = [];
  if (snapshot.remoteReady.supported) {
    columns.push(
      actionColumn(
        "remote_ready_toggle",
        remoteLabel,
        snapshot.remoteReady.active ? "default" : "primary_filled",
        remoteAction,
        snapshot.remoteReady.active
          ? undefined
          : {
              title: "开启远程就绪？",
              text: "桥接服务运行期间会阻止 macOS 因空闲自动睡眠，电池耗电可能增加。",
            },
      ),
    );
  }
  if (snapshot.activeTask) {
    columns.push(
      actionColumn("device_stop", "停止当前任务", "default", "device_stop", {
        title: "停止当前任务？",
        text: "已经完成的文件修改不会自动撤销。",
      }),
    );
  }
  return columns.length === 0 ? null : {
    tag: "column_set",
    element_id: "remote_actions",
    flex_mode: "none",
    horizontal_spacing: "8px",
    columns,
  };
}

function actionColumn(
  elementId: string,
  label: string,
  type: string,
  action:
    | "device_refresh"
    | "device_projects"
    | "device_settings"
    | "device_sessions"
    | "device_tasks"
    | "device_new_session"
    | "device_stop"
    | "device_reconnect"
    | "remote_ready_enable"
    | "remote_ready_disable",
  confirm?: { title: string; text: string },
): Record<string, unknown> {
  const button: Record<string, unknown> = {
    tag: "button",
    element_id: elementId,
    text: { tag: "plain_text", content: label },
    type,
    width: "fill",
    behaviors: [
      {
        type: "callback",
        value: { bridge: "feishu-codex-v4", action },
      },
    ],
  };
  if (confirm) {
    button.confirm = {
      title: { tag: "plain_text", content: confirm.title },
      text: { tag: "plain_text", content: confirm.text },
    };
  }
  return {
    tag: "column",
    width: "weighted",
    weight: 1,
    elements: [button],
  };
}

function statePresentation(state: DeviceAvailabilityState): {
  label: string;
  tag: string;
  metric: string;
  template: string;
  color: string;
  textColor: string;
  background: string;
} {
  switch (state) {
    case "online":
      return { label: "在线", tag: "可以执行", metric: "已连接", template: "blue", color: "green", textColor: "green", background: "blue-50" };
    case "degraded":
      return { label: "部分可用", tag: "部分可用", metric: "部分连接", template: "orange", color: "orange", textColor: "orange", background: "orange-50" };
    case "error":
      return { label: "异常", tag: "需要修复", metric: "连接正常", template: "red", color: "red", textColor: "red", background: "red-50" };
    case "maintenance":
      return { label: "维护中", tag: "暂停任务", metric: "维护中", template: "grey", color: "neutral", textColor: "grey", background: "grey-50" };
    case "offline":
      return { label: "离线", tag: "设备离线", metric: "已离线", template: "grey", color: "neutral", textColor: "grey", background: "grey-50" };
    case "connecting":
      return { label: "连接中", tag: "正在连接", metric: "连接中", template: "orange", color: "orange", textColor: "orange", background: "orange-50" };
  }
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "时间未知";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function safe(value: string): string {
  return value
    .replaceAll("&", "＆")
    .replaceAll("<", "＜")
    .replaceAll(">", "＞")
    .replaceAll("*", "＊")
    .replaceAll("_", "＿")
    .replaceAll("`", "｀")
    .replaceAll("[", "［")
    .replaceAll("]", "］");
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function truncatePlain(value: string, maxLength: number): string {
  return truncate(value.replaceAll("<", "＜").replaceAll(">", "＞"), maxLength);
}
