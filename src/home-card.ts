import type { DeviceAvailability } from "./device-health.js";
import type { FeishuCard } from "./task-card.js";
import type { OnboardingState, TeamRole } from "./types.js";

export interface PrivateHomeSnapshot {
  deviceName: string;
  availability: DeviceAvailability;
  project: {
    name: string;
    isGitRepository: boolean;
  };
  role: TeamRole;
  modelLabel: string;
  sandboxLabel: string;
  hasSession: boolean;
  activeTask?: string;
  queuedTasks: number;
  canOperate: boolean;
  onboardingStatus?: OnboardingState["status"];
  projectChatName?: string;
  projectChatNeedsRepair?: boolean;
  feedback?: string;
}

export function renderPrivateHomeCard(snapshot: PrivateHomeSnapshot): FeishuCard {
  const firstRun = snapshot.onboardingStatus === "active" && snapshot.canOperate;
  return {
    schema: "2.0",
    config: {
      update_multi: true,
      width_mode: "default",
      enable_forward: false,
      summary: { content: summary(snapshot) },
    },
    header: {
      title: { tag: "plain_text", content: "Codex 首页" },
      subtitle: {
        tag: "plain_text",
        content: `${safe(snapshot.project.name)} · ${safe(snapshot.deviceName)}`,
      },
      template: headerTemplate(snapshot.availability.state),
      icon: { tag: "standard_icon", token: "myai_colorful" },
      text_tag_list: [
        {
          tag: "text_tag",
          text: { tag: "plain_text", content: availabilityTag(snapshot.availability.state) },
          color: availabilityColor(snapshot.availability.state),
        },
        {
          tag: "text_tag",
          text: { tag: "plain_text", content: roleLabel(snapshot.role) },
          color: snapshot.role === "admin" ? "violet" : snapshot.role === "viewer" ? "neutral" : "blue",
        },
      ],
    },
    body: {
      direction: "vertical",
      padding: "12px 12px 18px 12px",
      vertical_spacing: "12px",
      elements: [
        ...(snapshot.feedback ? [feedbackPanel(snapshot.feedback)] : []),
        statusPanel(snapshot),
        contextRow(snapshot),
        guidePanel(snapshot, firstRun),
        ...actionRows(snapshot, firstRun),
        {
          tag: "markdown",
          element_id: "home_footer",
          text_size: "notation",
          text_align: "center",
          content: "<font color='grey'>提交、推送、部署和 PR 仍需单独确认</font>",
        },
      ],
    },
  };
}

function feedbackPanel(feedback: string): Record<string, unknown> {
  return {
    tag: "column_set",
    element_id: "home_feedback",
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
            element_id: "home_notice",
            content: `<font color='blue'>${safe(feedback)}</font>`,
          },
        ],
      },
    ],
  };
}

function statusPanel(snapshot: PrivateHomeSnapshot): Record<string, unknown> {
  const ready = snapshot.availability.canExecute;
  const task = snapshot.activeTask
    ? `正在执行任务 \`${safe(snapshot.activeTask)}\``
    : snapshot.queuedTasks > 0
      ? `${snapshot.queuedTasks} 个任务正在排队`
      : ready
        ? "已连接，可以直接说你想做什么。"
        : snapshot.availability.detail;
  return {
    tag: "column_set",
    element_id: "home_status",
    flex_mode: "none",
    columns: [
      {
        tag: "column",
        width: "weighted",
        weight: 1,
        background_style: ready ? "green-50" : "orange-50",
        padding: "12px 12px 12px 12px",
        elements: [
          {
            tag: "markdown",
            element_id: "home_status_copy",
            content: `**${safe(snapshot.availability.title)}**\n${task}`,
          },
        ],
      },
    ],
  };
}

function contextRow(snapshot: PrivateHomeSnapshot): Record<string, unknown> {
  return {
    tag: "column_set",
    element_id: "home_context",
    flex_mode: "none",
    horizontal_spacing: "8px",
    columns: [
      metricColumn("home_session", "会话", snapshot.hasSession ? "继续当前" : "尚未开始"),
      metricColumn("home_permission", "权限", snapshot.sandboxLabel),
    ],
  };
}

function metricColumn(elementId: string, label: string, value: string): Record<string, unknown> {
  return {
    tag: "column",
    width: "weighted",
    weight: 1,
    background_style: "grey-50",
    padding: "10px 8px 10px 8px",
    elements: [
      {
        tag: "markdown",
        element_id: elementId,
        text_align: "center",
        content: `<font color='grey'>${label}</font>\n**${safe(value)}**`,
      },
    ],
  };
}

function guidePanel(snapshot: PrivateHomeSnapshot, firstRun: boolean): Record<string, unknown> {
  const content = !snapshot.canOperate
    ? "**你现在是只读成员。**\n可以查看项目、会话和任务状态；执行工作需要管理员调整角色。"
    : firstRun
      ? "**先完成一次真实任务。**\n点击下方按钮，Codex 会只读了解当前项目，不会修改文件。"
      : snapshot.hasSession
        ? `**直接继续当前会话。**\n在聊天框说下一步即可；要处理另一件事，先点“新会话”。\n<font color='grey'>模型：${safe(snapshot.modelLabel)}</font>`
        : `**直接发送一句完整要求。**\n例如：\`找出登录慢的原因，先不要修改文件。\`\n<font color='grey'>模型：${safe(snapshot.modelLabel)}</font>`;
  return {
    tag: "column_set",
    element_id: "home_guide",
    flex_mode: "none",
    columns: [
      {
        tag: "column",
        width: "weighted",
        weight: 1,
        background_style: "grey-50",
        padding: "12px 12px 12px 12px",
        elements: [
          { tag: "markdown", element_id: "home_guide_copy", content },
        ],
      },
    ],
  };
}

function actionRows(
  snapshot: PrivateHomeSnapshot,
  firstRun: boolean,
): Record<string, unknown>[] {
  if (!snapshot.availability.canInteract) {
    return [actionRow("home_primary", [button("查看设备详情", "home_device", "primary")])];
  }
  if (!snapshot.canOperate) {
    return [
      actionRow("home_primary", [
        button("查看项目", "home_projects", "primary"),
        ...(snapshot.projectChatName
          ? [button(projectChatActionLabel(snapshot), "home_project_chat", "default")]
          : [button("查看设备详情", "home_device", "default")]),
      ]),
    ];
  }
  if (firstRun) {
    return [
      actionRow("home_primary", [
        button("了解当前项目（只读）", "home_first_task", "primary"),
      ]),
      actionRow("home_secondary", [
        button(
          projectChatActionLabel(snapshot),
          "home_project_chat",
          "default",
        ),
        button("切换项目", "home_projects", "default"),
      ]),
      actionRow("home_tertiary", [button("设备详情", "home_device", "default")]),
    ];
  }
  return [
    actionRow("home_primary", [
      button("新会话", "home_new_session", "primary"),
      button("历史会话", "home_sessions", "default"),
    ]),
    actionRow("home_secondary", [
      button(
        projectChatActionLabel(snapshot),
        "home_project_chat",
        "default",
      ),
      button("切换项目", "home_projects", "default"),
    ]),
    actionRow("home_tertiary", [button("设备详情", "home_device", "default")]),
  ];
}

function projectChatActionLabel(snapshot: PrivateHomeSnapshot): string {
  if (!snapshot.projectChatName) return "创建项目群";
  return snapshot.projectChatNeedsRepair ? "修复项目群" : "打开项目群";
}

function actionRow(elementId: string, actions: Record<string, unknown>[]): Record<string, unknown> {
  return {
    tag: "column_set",
    element_id: elementId,
    flex_mode: "none",
    horizontal_spacing: "8px",
    columns: actions.map((action) => ({
      tag: "column",
      width: "weighted",
      weight: 1,
      elements: [action],
    })),
  };
}

function button(
  text: string,
  action: string,
  type: "default" | "primary",
): Record<string, unknown> {
  return {
    tag: "button",
    element_id: action.replace("home_", "hm_").slice(0, 20),
    text: { tag: "plain_text", content: text },
    type: type === "primary" ? "primary_filled" : "default",
    width: "fill",
    behaviors: [
      {
        type: "callback",
        value: { bridge: "feishu-codex-v5", action },
      },
    ],
  };
}

function summary(snapshot: PrivateHomeSnapshot): string {
  if (!snapshot.availability.canExecute) return snapshot.availability.title;
  if (snapshot.activeTask) return `Codex 正在执行 · ${safe(snapshot.project.name)}`;
  return `Codex 已连接 · ${safe(snapshot.project.name)}`;
}

function headerTemplate(state: DeviceAvailability["state"]): string {
  if (state === "online") return "turquoise";
  if (state === "degraded") return "orange";
  if (state === "maintenance") return "indigo";
  return "red";
}

function availabilityTag(state: DeviceAvailability["state"]): string {
  if (state === "online") return "设备在线";
  if (state === "degraded") return "部分可用";
  if (state === "maintenance") return "维护中";
  if (state === "connecting") return "连接中";
  return "设备离线";
}

function availabilityColor(state: DeviceAvailability["state"]): string {
  if (state === "online") return "green";
  if (state === "degraded" || state === "connecting" || state === "maintenance") return "orange";
  return "red";
}

function roleLabel(role: TeamRole): string {
  if (role === "admin") return "管理员";
  if (role === "operator") return "操作者";
  return "只读成员";
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
