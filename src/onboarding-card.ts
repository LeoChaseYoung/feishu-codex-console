import type { FeishuCard } from "./task-card.js";
import type { OnboardingState, TeamRole } from "./types.js";

export interface OnboardingSnapshot {
  role: TeamRole;
  state: OnboardingState;
  projectName: string;
  projectAvailable: boolean;
  modelLabel: string;
  sandboxLabel: string;
  canWrite: boolean;
  deviceOnline: boolean;
  groupChatEnabled: boolean;
  feedback?: string;
}

export function renderOnboardingCard(snapshot: OnboardingSnapshot): FeishuCard {
  const completed = snapshot.state.status === "completed";
  const dismissed = snapshot.state.status === "dismissed";
  return {
    schema: "2.0",
    config: {
      update_multi: true,
      width_mode: "default",
      enable_forward: false,
      summary: {
        content: summary(snapshot),
      },
    },
    header: {
      title: {
        tag: "plain_text",
        content: headerTitle(snapshot),
      },
      subtitle: {
        tag: "plain_text",
        content: headerSubtitle(snapshot),
      },
      template:
        dismissed
          ? "grey"
          : !snapshot.deviceOnline || !snapshot.projectAvailable
            ? "orange"
            : completed
              ? "green"
              : "turquoise",
      icon: { tag: "standard_icon", token: "myai_colorful" },
      text_tag_list: [
        {
          tag: "text_tag",
          text: { tag: "plain_text", content: roleLabel(snapshot.role) },
          color: snapshot.role === "admin" ? "violet" : snapshot.role === "viewer" ? "neutral" : "blue",
        },
        {
          tag: "text_tag",
          text: {
            tag: "plain_text",
            content: snapshot.deviceOnline ? "设备在线" : "设备重连中",
          },
          color: snapshot.deviceOnline ? "green" : "orange",
        },
      ],
    },
    body: {
      direction: "vertical",
      padding: "12px 12px 18px 12px",
      vertical_spacing: "12px",
      elements: [
        ...(snapshot.feedback ? [feedbackPanel(snapshot.feedback)] : []),
        contentPanel(snapshot),
        ...actionRows(snapshot),
        {
          tag: "markdown",
          element_id: "onboard_safety",
          text_size: "notation",
          text_align: "center",
          content: `<font color='grey'>${footerText(snapshot)}</font>`,
        },
      ],
    },
  };
}

function feedbackPanel(feedback: string): Record<string, unknown> {
  return {
    tag: "column_set",
    element_id: "onboard_feedback",
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
            element_id: "onboard_notice",
            content: `<font color='blue'>${safe(feedback)}</font>`,
          },
        ],
      },
    ],
  };
}

function contentPanel(snapshot: OnboardingSnapshot): Record<string, unknown> {
  return {
    tag: "column_set",
    element_id: "onboard_content",
    flex_mode: "none",
    columns: [
      {
        tag: "column",
        width: "weighted",
        weight: 1,
        background_style: "grey-50",
        padding: "12px 12px 12px 12px",
        elements: [
          {
            tag: "markdown",
            element_id: "onboard_copy",
            content: content(snapshot),
          },
        ],
      },
    ],
  };
}

function content(snapshot: OnboardingSnapshot): string {
  if (snapshot.state.status === "dismissed") {
    return [
      "**引导已关闭，不影响继续使用。**",
      "",
      "你仍然可以正常使用机器人；任何时候发送 `新手引导`、`/onboarding` 或 `/start` 都能重新开始。",
    ].join("\n");
  }
  if (!snapshot.deviceOnline) {
    return [
      "**本地 Codex 正在重新连接。**",
      "",
      "先打开连接状态查看原因；恢复后回到聊天框，重新发送刚才的话即可。",
    ].join("\n");
  }
  if (!snapshot.projectAvailable) {
    return [
      "**先选择一个要使用的项目。**",
      "",
      "Codex 只会读取或修改已授权项目；不需要输入本机路径，直接从项目列表中选择即可。",
    ].join("\n");
  }
  if (snapshot.role === "viewer") {
    return [
      "**你现在是只读成员。**",
      "",
      `- 当前项目：${safe(snapshot.projectName)}`,
      "- 可以查看项目、历史会话和任务状态",
      "- 不能启动 Codex 或修改本地文件",
      "",
      "需要执行工作时，请联系管理员调整你的角色。",
    ].join("\n");
  }
  return [
    snapshot.state.status === "completed"
      ? "**可以开始了，直接在聊天框里说你想做什么。**"
      : "**直接在聊天框里说你想做什么。**",
    "",
    "你可以这样说：",
    "- `这个项目是做什么的？`",
    "- `找出登录慢的原因，先不要修改文件。`",
    snapshot.canWrite
      ? "- `运行测试，修复失败用例并说明改了什么。`"
      : "- `检查现有测试并说明风险，不要修改文件。`",
    "",
    "继续同一件事，直接回复上一条消息；新事情就发一条新消息。",
    "",
    snapshot.groupChatEnabled
      ? "**团队协作**：一个项目建一个群，每件新事发一条新消息。"
      : "**团队协作**：一个项目建一个群；团队群可以以后再开，不影响现在使用。",
    ...(snapshot.canWrite
      ? []
      : ["", "当前是只读模式；需要写文件时，可打开设置调整权限。"]),
  ].join("\n");
}

function actionRows(snapshot: OnboardingSnapshot): Record<string, unknown>[] {
  if (snapshot.state.status === "dismissed") {
    return [
      actionRow("onboard_primary", [
        button("重新打开引导", "onboarding_restart", "primary"),
      ]),
    ];
  }
  if (!snapshot.deviceOnline) {
    return [
      actionRow("onboard_primary", [
        button("查看连接状态", "onboarding_device", "primary"),
      ]),
      actionRow("onboard_secondary", [
        button("稍后再说", "onboarding_dismiss", "default"),
      ]),
    ];
  }
  if (!snapshot.projectAvailable) {
    return [
      actionRow("onboard_primary", [
        button("选择项目", "onboarding_projects", "primary"),
      ]),
      actionRow("onboard_secondary", [
        button("稍后再说", "onboarding_dismiss", "default"),
      ]),
    ];
  }
  if (snapshot.state.status === "completed") {
    return [
      actionRow("onboard_actions", [
        button("打开控制台", "onboarding_device", "primary"),
        button("重新查看引导", "onboarding_restart", "default"),
      ]),
    ];
  }
  if (snapshot.role === "viewer") {
    return [
      actionRow("onboard_primary", [
        button("我知道了", "onboarding_finish", "primary"),
      ]),
      actionRow("onboard_secondary", [
        button("查看项目", "onboarding_projects", "default"),
        button("任务中心", "onboarding_tasks", "default"),
      ]),
    ];
  }
  return [
    actionRow("onboard_primary", [
      button("知道了，开始使用", "onboarding_finish", "primary"),
    ]),
    actionRow("onboard_secondary", [
      button("换项目", "onboarding_projects", "default"),
      button("调整设置", "onboarding_settings", "default"),
    ]),
  ];
}

function actionRow(
  elementId: string,
  actions: Record<string, unknown>[],
): Record<string, unknown> {
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

function summary(snapshot: OnboardingSnapshot): string {
  if (snapshot.state.status === "dismissed") return "Codex 新手引导已关闭";
  if (!snapshot.deviceOnline) return "本地 Codex 正在重新连接";
  if (!snapshot.projectAvailable) return "Codex 等待选择项目";
  if (snapshot.state.status === "completed") return "Codex 已准备好";
  return `Codex 已连接 · ${safe(snapshot.projectName)}`;
}

function headerTitle(snapshot: OnboardingSnapshot): string {
  if (snapshot.state.status === "dismissed") return "引导已关闭";
  if (!snapshot.deviceOnline) return "正在连接本地 Codex";
  if (!snapshot.projectAvailable) return "先选择一个项目";
  if (snapshot.state.status === "completed") return "可以开始了";
  return snapshot.role === "viewer" ? "欢迎使用 Codex" : "开始使用 Codex";
}

function headerSubtitle(snapshot: OnboardingSnapshot): string {
  if (snapshot.state.status === "dismissed") return "需要时发送“新手引导”即可重新打开";
  if (!snapshot.deviceOnline) return "查看连接状态，恢复后即可继续";
  if (!snapshot.projectAvailable) return "只需从已授权项目中选择";
  if (snapshot.role === "viewer") return `${safe(snapshot.projectName)} · 只读`;
  return `${safe(snapshot.projectName)} · ${safe(snapshot.sandboxLabel)}`;
}

function footerText(snapshot: OnboardingSnapshot): string {
  if (!snapshot.deviceOnline) return "本地连接恢复后才能执行工作。";
  if (!snapshot.projectAvailable) return "这里只会显示管理员已经授权的项目。";
  if (snapshot.role === "viewer") return "只读成员不会触发本地执行或文件修改。";
  return "任务只会在当前项目中运行；提交、推送、部署和 PR 仍需单独确认。";
}

function button(
  text: string,
  action: string,
  type: "default" | "primary",
): Record<string, unknown> {
  return {
    tag: "button",
    element_id: action.replace("onboarding_", "ob_").slice(0, 20),
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
