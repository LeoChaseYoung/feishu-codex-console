import type { ExternalAction } from "./types.js";
import type { FeishuCard } from "./task-card.js";
import { redactSensitiveText } from "./redaction.js";

export type ConfirmationState = "pending" | "approved" | "rejected" | "expired";

const ACTION_LABELS: Record<ExternalAction, string> = {
  commit: "提交代码",
  push: "推送远端",
  deploy: "发布 / 部署",
  pull_request: "创建 / 合并 PR",
};

export function renderExternalConfirmationCard(
  requestId: string,
  prompt: string,
  projectLabel: string,
  actions: ExternalAction[],
  state: ConfirmationState = "pending",
  ttlMinutes = 10,
): FeishuCard {
  const labels = actions.map((action) => ACTION_LABELS[action]).join("、");
  const elements: Record<string, unknown>[] = [
    {
      tag: "column_set",
      element_id: "risk_summary",
      flex_mode: "none",
      columns: [
        {
          tag: "column",
          width: "weighted",
          weight: 1,
          background_style: state === "pending" ? "orange-50" : "grey-50",
          padding: "12px 12px 12px 12px",
          vertical_spacing: "4px",
          elements: [
            {
              tag: "markdown",
              content: `**外部动作**\n${safeText(labels)}\n\n<font color='grey'>项目：${safeText(projectLabel)}</font>`,
            },
          ],
        },
      ],
    },
    {
      tag: "markdown",
      element_id: "request_text",
      content: `**原始任务**\n${safeText(truncate(prompt, 1_500))}`,
    },
  ];

  if (state === "pending") {
    elements.push({
      tag: "column_set",
      element_id: "confirm_actions",
      flex_mode: "none",
      horizontal_spacing: "8px",
      columns: [
        buttonColumn("approve_btn", "确认并执行", "danger_filled", requestId, "approve_external", {
          title: "确认执行外部动作？",
          text: `Codex 将获得本次 ${labels} 的明确授权。`,
        }),
        buttonColumn("reject_btn", "取消", "default", requestId, "reject_external"),
      ],
    });
  } else {
    elements.push({
      tag: "markdown",
      element_id: "decision",
      text_align: "center",
      content:
        state === "approved"
          ? "<font color='green'>已确认，任务已进入执行队列</font>"
          : state === "expired"
            ? "<font color='grey'>确认已过期，请重新发送任务</font>"
            : "<font color='grey'>已取消，本次任务未执行</font>",
    });
  }

  return {
    schema: "2.0",
    config: {
      update_multi: true,
      width_mode: "default",
      enable_forward: false,
      summary: { content: `Codex 外部动作确认 · ${projectLabel}` },
    },
    header: {
      title: { tag: "plain_text", content: "需要你的确认" },
      subtitle: {
        tag: "plain_text",
        content: `外部动作不会被静默执行；确认 ${ttlMinutes} 分钟内有效`,
      },
      template: state === "pending" ? "orange" : state === "approved" ? "green" : "grey",
      icon: { tag: "standard_icon", token: "warning_colorful" },
      text_tag_list: [
        {
          tag: "text_tag",
          text: { tag: "plain_text", content: "完全访问门禁" },
          color: "orange",
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

function buttonColumn(
  elementId: string,
  label: string,
  type: string,
  requestId: string,
  action: "approve_external" | "reject_external",
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
        value: { bridge: "feishu-codex-v3", action, request_id: requestId },
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

function safeText(value: string): string {
  return redactSensitiveText(value)
    .replaceAll("<at", "＜at")
    .replaceAll("</at>", "＜/at＞")
    .replaceAll("<person", "＜person")
    .replaceAll("</person>", "＜/person＞");
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}
