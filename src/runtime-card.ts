import type { CodexApprovalRequest, CodexQuestion } from "./codex-events.js";
import type { FeishuCard } from "./task-card.js";
import { redactSensitiveText } from "./redaction.js";

export type RuntimeApprovalState = "pending" | "accepted" | "session" | "declined" | "expired";
export type RuntimeQuestionState = "pending" | "answered" | "cancelled" | "expired";

export function renderRuntimeApprovalCard(
  requestId: string,
  request: CodexApprovalRequest,
  projectLabel: string,
  state: RuntimeApprovalState = "pending",
  ttlMinutes = 10,
): FeishuCard {
  const pending = state === "pending";
  const kindLabel = approvalKindLabel(request.kind);
  const elements: Record<string, unknown>[] = [
    {
      tag: "column_set",
      element_id: "approval_detail",
      flex_mode: "none",
      columns: [
        {
          tag: "column",
          width: "weighted",
          weight: 1,
          background_style: pending ? "orange-50" : "grey-50",
          padding: "12px 12px 12px 12px",
          vertical_spacing: "6px",
          elements: [
            {
              tag: "markdown",
              content: `**${safe(request.title)}**\n${safe(truncate(request.detail, 2_000))}`,
            },
            {
              tag: "markdown",
              text_size: "notation",
              content: `<font color='grey'>类型：${kindLabel}\n项目：${safe(projectLabel)}${request.cwd ? `\n目录：${safe(request.cwd)}` : ""}${request.reason ? `\n原因：${safe(request.reason)}` : ""}\n范围：允许一次仅用于当前请求；本会话允许可能放行后续同类请求</font>`,
            },
          ],
        },
      ],
    },
  ];

  if (pending) {
    elements.push({
      tag: "column_set",
      element_id: "approval_actions",
      flex_mode: "none",
      horizontal_spacing: "8px",
      columns: [
        actionButton("allow_once", "允许一次", "primary_filled", requestId, "approve_runtime_once"),
        actionButton("allow_session", "本会话允许", "default", requestId, "approve_runtime_session", {
          title: "本会话持续允许？",
          text: "同类权限在当前 Codex 会话中可能不再询问。",
        }),
        actionButton("deny", "拒绝", "default", requestId, "reject_runtime"),
      ],
    });
  } else {
    elements.push({
      tag: "markdown",
      element_id: "approval_result",
      text_align: "center",
      content:
        state === "accepted"
          ? "<font color='green'>已允许一次</font>"
          : state === "session"
            ? "<font color='green'>已在本会话允许</font>"
            : state === "expired"
              ? "<font color='grey'>请求已过期，Codex 未获得权限。发送“任务”查看最新任务。</font>"
              : "<font color='grey'>已拒绝，Codex 未获得权限</font>",
    });
  }

  return {
    schema: "2.0",
    config: {
      update_multi: true,
      width_mode: "default",
      enable_forward: false,
      summary: { content: `Codex 运行时确认 · ${projectLabel}` },
    },
    header: {
      title: { tag: "plain_text", content: "Codex 需要你的确认" },
      subtitle: {
        tag: "plain_text",
        content: `这是本地 Codex 的实时权限请求；${ttlMinutes} 分钟内有效`,
      },
      template: pending ? "orange" : state === "accepted" || state === "session" ? "green" : "grey",
      icon: { tag: "standard_icon", token: "warning_colorful" },
      text_tag_list: [
        {
          tag: "text_tag",
          text: { tag: "plain_text", content: "运行时权限" },
          color: pending ? "orange" : "neutral",
        },
        {
          tag: "text_tag",
          text: { tag: "plain_text", content: kindLabel },
          color: "neutral",
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

export function renderRuntimeQuestionCard(
  requestId: string,
  question: CodexQuestion,
  position: { index: number; total: number },
  state: RuntimeQuestionState = "pending",
  answer = "",
  ttlMinutes = 10,
): FeishuCard {
  const pending = state === "pending";
  const answerAllowed = !question.isSecret;
  const elements: Record<string, unknown>[] = [
    {
      tag: "column_set",
      element_id: "question_detail",
      flex_mode: "none",
      columns: [
        {
          tag: "column",
          width: "weighted",
          weight: 1,
          background_style: pending ? "blue-50" : "grey-50",
          padding: "12px 12px 12px 12px",
          vertical_spacing: "6px",
          elements: [
            {
              tag: "markdown",
              text_size: "notation",
              content: `<font color='blue'>${safe(question.header)}</font>`,
            },
            { tag: "markdown", content: `**${safe(question.question)}**` },
          ],
        },
      ],
    },
  ];

  if (pending && answerAllowed && question.options.length > 0 && question.options.length <= 3) {
    elements.push({
      tag: "column_set",
      element_id: "question_options",
      flex_mode: "none",
      horizontal_spacing: "8px",
      columns: question.options.map((option, index) =>
        answerButton(
          `answer_${index}`,
          option.label,
          index === 0 ? "primary_filled" : "default",
          requestId,
          question.id,
          option.label,
        ),
      ),
    });
    const descriptions = question.options
      .filter((option) => option.description)
      .map((option) => `- **${safe(option.label)}**：${safe(option.description)}`);
    if (descriptions.length > 0) {
      elements.push({
        tag: "markdown",
        element_id: "option_descriptions",
        text_size: "notation",
        content: descriptions.join("\n"),
      });
    }
  } else if (pending && answerAllowed && question.options.length > 0) {
    elements.push({
      tag: "select_static",
      element_id: "question_select",
      name: "runtime_answer",
      width: "fill",
      placeholder: { tag: "plain_text", content: "选择答案" },
      options: question.options.map((option) => ({
        text: { tag: "plain_text", content: truncatePlain(option.label, 70) },
        value: option.label,
      })),
      behaviors: [
        {
          type: "callback",
          value: {
            bridge: "feishu-codex-v4",
            action: "answer_runtime",
            request_id: requestId,
            question_id: question.id,
          },
        },
      ],
    });
  }

  if (pending) {
    elements.push({
      tag: "markdown",
      element_id: "answer_hint",
      text_size: "notation",
      content: question.isSecret
        ? "<font color='red'>安全保护：此桥接器不会通过飞书收集或转发密码、令牌、密钥等敏感答案。请回本机处理，或点击“取消回答”。</font>"
        : question.isOther || question.options.length === 0
          ? "<font color='grey'>也可以直接发送下一条飞书消息作为答案。</font>"
          : "<font color='grey'>点击选项，或直接发送下一条飞书消息作为答案。</font>",
    });
    elements.push({
      tag: "column_set",
      element_id: "question_actions",
      flex_mode: "none",
      columns: [
        {
          tag: "column",
          width: "weighted",
          weight: 1,
          elements: [
            {
              tag: "button",
              element_id: "cancel_answer",
              text: { tag: "plain_text", content: "取消回答" },
              type: "default",
              width: "fill",
              behaviors: [
                {
                  type: "callback",
                  value: {
                    bridge: "feishu-codex-v4",
                    action: "cancel_runtime_question",
                    request_id: requestId,
                    question_id: question.id,
                  },
                },
              ],
            },
          ],
        },
      ],
    });
  } else {
    elements.push({
      tag: "markdown",
      element_id: "answer_result",
      text_align: "center",
      content:
        state === "answered"
          ? `<font color='green'>已回答：${safe(truncate(answer, 300))}</font>`
          : state === "cancelled"
            ? "<font color='grey'>已取消回答，Codex 将继续处理</font>"
          : "<font color='grey'>问题已过期，Codex 将继续处理。发送“任务”查看最新任务。</font>",
    });
  }

  return {
    schema: "2.0",
    config: {
      update_multi: true,
      width_mode: "default",
      enable_forward: false,
      summary: { content: `Codex 等待你的输入 · ${question.header}` },
    },
    header: {
      title: { tag: "plain_text", content: "Codex 在等你回答" },
      subtitle: {
        tag: "plain_text",
        content: `问题 ${position.index} / ${position.total} · ${ttlMinutes} 分钟内有效 · 回答后任务会自动继续`,
      },
      template: pending ? "blue" : state === "answered" ? "green" : "grey",
      icon: { tag: "standard_icon", token: "myai_colorful" },
      text_tag_list: [
        {
          tag: "text_tag",
          text: { tag: "plain_text", content: "实时追问" },
          color: pending ? "blue" : "neutral",
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

function actionButton(
  elementId: string,
  label: string,
  type: string,
  requestId: string,
  action: "approve_runtime_once" | "approve_runtime_session" | "reject_runtime",
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
        value: { bridge: "feishu-codex-v4", action, request_id: requestId },
      },
    ],
  };
  if (confirm) {
    button.confirm = {
      title: { tag: "plain_text", content: confirm.title },
      text: { tag: "plain_text", content: confirm.text },
    };
  }
  return { tag: "column", width: "weighted", weight: 1, elements: [button] };
}

function answerButton(
  elementId: string,
  label: string,
  type: string,
  requestId: string,
  questionId: string,
  answer: string,
): Record<string, unknown> {
  return {
    tag: "column",
    width: "weighted",
    weight: 1,
    elements: [
      {
        tag: "button",
        element_id: elementId,
        text: { tag: "plain_text", content: truncatePlain(label, 40) },
        type,
        width: "fill",
        behaviors: [
          {
            type: "callback",
            value: {
              bridge: "feishu-codex-v4",
              action: "answer_runtime",
              request_id: requestId,
              question_id: questionId,
              answer,
            },
          },
        ],
      },
    ],
  };
}

function safe(value: string): string {
  return redactSensitiveText(value)
    .replaceAll("&", "＆")
    .replaceAll("<", "＜")
    .replaceAll(">", "＞")
    .replaceAll("*", "＊")
    .replaceAll("_", "＿")
    .replaceAll("`", "｀")
    .replaceAll("<at", "＜at")
    .replaceAll("</at>", "＜/at＞");
}

function approvalKindLabel(kind: CodexApprovalRequest["kind"]): string {
  if (kind === "command") return "命令执行";
  if (kind === "file_change") return "越界写入";
  return "临时权限";
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function truncatePlain(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}
