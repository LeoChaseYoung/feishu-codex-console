import { prepareRemoteMarkdown } from "./redaction.js";
import type { FeishuCard } from "./task-card.js";

export type ResponseTone = "info" | "success" | "warning" | "error" | "neutral";

interface ResponsePresentation {
  tone: ResponseTone;
  title: string;
  tag: string;
  template: "blue" | "green" | "orange" | "red" | "grey";
  background: "blue-50" | "green-50" | "orange-50" | "red-50" | "grey-50";
  color: "blue" | "green" | "orange" | "red" | "neutral";
  hint: string;
}

export function renderResponseCard(text: string, phase = "info"): FeishuCard {
  const presentation = responsePresentation(phase, text);
  const content = safeMarkdown(normalizeResponseText(text));
  return {
    schema: "2.0",
    config: {
      update_multi: true,
      width_mode: "default",
      enable_forward: false,
      summary: { content: `${presentation.title} · ${truncatePlain(content, 70)}` },
    },
    header: {
      title: { tag: "plain_text", content: presentation.title },
      subtitle: { tag: "plain_text", content: "本地 Codex 控制台" },
      template: presentation.template,
      icon: { tag: "standard_icon", token: "myai_colorful" },
      text_tag_list: [
        {
          tag: "text_tag",
          text: { tag: "plain_text", content: presentation.tag },
          color: presentation.color,
        },
      ],
    },
    body: {
      direction: "vertical",
      padding: "12px 12px 16px 12px",
      vertical_spacing: "10px",
      elements: [
        {
          tag: "column_set",
          element_id: "resp_content_panel",
          flex_mode: "none",
          columns: [
            {
              tag: "column",
              width: "weighted",
              weight: 1,
              background_style: presentation.background,
              padding: "12px 12px 12px 12px",
              elements: [
                {
                  tag: "markdown",
                  element_id: "response_content",
                  content: truncate(content, 10_000),
                },
              ],
            },
          ],
        },
        {
          tag: "markdown",
          element_id: "response_hint",
          text_size: "notation",
          content: `<font color='grey'>${safeMarkdown(presentation.hint)}</font>`,
        },
      ],
    },
  };
}

export function responsePresentation(phase: string, text: string): ResponsePresentation {
  const key = `${phase} ${text}`.toLocaleLowerCase();
  const area = responseArea(phase);
  if (/denied|unauthorized|forbidden|权限|无权/.test(key)) {
    return style("warning", "权限受限", "需要确认", "权限没有变更；如需继续，请由项目或团队管理员检查授权。");
  }
  if (/failed|failure|error|invalid|unavailable|not-found|unsupported|失败|异常|无效|没有找到|不支持/.test(key)) {
    return style("error", `${area}未完成`, "未完成", "可以发送“状态”检查本机连接，或按消息中的建议重试。");
  }
  if (/expired|stale|queue-full|warning|confirm|过期|已满|确认|稍后|等待/.test(key)) {
    return style("warning", `${area}提醒`, "请留意", "按上方说明处理后即可继续；不会静默执行高风险动作。");
  }
  if (/cancel|stopped|revoke|取消|停止|撤销/.test(key)) {
    return style("neutral", `${area}已结束`, "已停止", "当前操作已经结束；需要继续时可重新发送任务或打开对应控制中心。");
  }
  if (/complete|success|accepted|approved|changed|switched|created|完成|成功|已接收|已切换|已创建|已更新|已开启/.test(key)) {
    return style("success", `${area}已更新`, "已完成", "后续可继续发送任务；需要查看全局状态时发送“控制台”。");
  }
  return style("info", area, "信息", "发送“帮助”查看常用命令，或发送“控制台”查看本机状态。");
}

function responseArea(phase: string): string {
  const normalized = phase.toLocaleLowerCase();
  if (/project|switch/.test(normalized)) return "项目";
  if (/session|compact|new/.test(normalized)) return "会话";
  if (/setting|model|effort|sandbox|permission|lease/.test(normalized)) return "设置";
  if (/task|queue|steer|prompt|cancel|stop|timeout/.test(normalized)) return "任务";
  if (/attachment|file|image/.test(normalized)) return "附件";
  if (/device|status|recovery|service|codex/.test(normalized)) return "本机服务";
  if (/audit|security|secret/.test(normalized)) return "安全提示";
  if (/help|onboarding/.test(normalized)) return "使用指南";
  return "操作结果";
}

function style(
  tone: ResponseTone,
  title: string,
  tag: string,
  hint: string,
): ResponsePresentation {
  if (tone === "success") {
    return { tone, title, tag, hint, template: "green", background: "green-50", color: "green" };
  }
  if (tone === "warning") {
    return { tone, title, tag, hint, template: "orange", background: "orange-50", color: "orange" };
  }
  if (tone === "error") {
    return { tone, title, tag, hint, template: "red", background: "red-50", color: "red" };
  }
  if (tone === "neutral") {
    return { tone, title, tag, hint, template: "grey", background: "grey-50", color: "neutral" };
  }
  return { tone, title, tag, hint, template: "blue", background: "blue-50", color: "blue" };
}

function normalizeResponseText(value: string): string {
  return prepareRemoteMarkdown(value)
    .replace(/^[\s✅✔️☑️ℹ️⚠️❌]+/u, "")
    .trim() || "操作已处理。";
}

function safeMarkdown(value: string): string {
  return value
    .replaceAll("<at", "＜at")
    .replaceAll("</at>", "＜/at＞")
    .replaceAll("<person", "＜person")
    .replaceAll("</person>", "＜/person＞");
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 18))}\n\n[内容已截断]`;
}

function truncatePlain(value: string, max: number): string {
  const plain = value.replace(/[*_`>#\[\]()]/g, "").replace(/\s+/g, " ").trim();
  if (plain.length <= max) return plain;
  return `${plain.slice(0, Math.max(0, max - 1))}…`;
}
