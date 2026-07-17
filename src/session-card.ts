import type { CodexThreadSummary } from "./codex-runner.js";
import type { FeishuCard } from "./task-card.js";

export interface SessionCenterSnapshot {
  projectName: string;
  currentThreadId?: string;
  sessions: CodexThreadSummary[];
  feedback?: string;
}

export function renderSessionCenterCard(snapshot: SessionCenterSnapshot): FeishuCard {
  const currentExists = snapshot.sessions.some((session) => session.id === snapshot.currentThreadId);
  return {
    schema: "2.0",
    config: {
      update_multi: true,
      width_mode: "default",
      enable_forward: false,
      summary: { content: `Codex 会话中心 · ${safe(snapshot.projectName)}` },
    },
    header: {
      title: { tag: "plain_text", content: "Codex 会话中心" },
      subtitle: { tag: "plain_text", content: `恢复 ${snapshot.projectName} 的历史上下文` },
      template: "blue",
      icon: { tag: "standard_icon", token: "history_colorful" },
      text_tag_list: [
        {
          tag: "text_tag",
          text: { tag: "plain_text", content: `${snapshot.sessions.length} 个最近会话` },
          color: "blue",
        },
      ],
    },
    body: {
      direction: "vertical",
      padding: "12px 12px 18px 12px",
      vertical_spacing: "12px",
      elements: [
        ...(snapshot.feedback ? [notice(snapshot.feedback)] : []),
        snapshot.sessions.length > 0
          ? {
              tag: "select_static",
              element_id: "session_select",
              name: "thread_id",
              width: "fill",
              placeholder: { tag: "plain_text", content: "选择要恢复的会话" },
              ...(currentExists ? { initial_option: snapshot.currentThreadId } : {}),
              options: snapshot.sessions.slice(0, 20).map((session) => ({
                text: {
                  tag: "plain_text",
                  content: `${sessionTitle(session)} · ${relativeTime(session.updatedAt)}`.slice(0, 90),
                },
                value: session.id,
              })),
              behaviors: [callback("select_session")],
            }
          : {
              tag: "markdown",
              element_id: "session_empty",
              content: "**还没有历史会话**\n<font color='grey'>发送第一条开发任务后，会话会自动保存在这里。</font>",
            },
        ...snapshot.sessions.slice(0, 5).map((session, index) => sessionRow(session, index)),
        actionGrid("session_actions", [
          button("压缩当前会话", "session_compact", "default"),
          button("新会话", "session_new", "primary"),
          button("返回设置", "session_settings", "default"),
          button("刷新", "session_refresh", "default"),
        ]),
      ],
    },
  };
}

function sessionRow(session: CodexThreadSummary, index: number): Record<string, unknown> {
  return {
    tag: "markdown",
    element_id: `session_row_${index}`,
    content: `**${safe(sessionTitle(session))}**  ${statusTag(session.status)}\n<font color='grey'>${safe(session.preview || "暂无摘要").slice(0, 160)}</font>`,
  };
}

function notice(text: string): Record<string, unknown> {
  return {
    tag: "markdown",
    element_id: "session_feedback",
    content: `<font color='blue'>${safe(text)}</font>`,
  };
}

function callback(action: string): Record<string, unknown> {
  return { type: "callback", value: { bridge: "feishu-codex-v5", action } };
}

function button(text: string, action: string, type: "default" | "primary"): Record<string, unknown> {
  return {
    tag: "button",
    element_id: action.slice(0, 20),
    text: { tag: "plain_text", content: text },
    type: type === "primary" ? "primary_filled" : "default",
    width: "fill",
    behaviors: [callback(action)],
  };
}

function actionGrid(id: string, actions: Record<string, unknown>[]): Record<string, unknown> {
  return {
    tag: "column_set",
    element_id: id,
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

function sessionTitle(session: CodexThreadSummary): string {
  return session.name || session.preview || session.id.slice(0, 8);
}

function relativeTime(timestamp: number): string {
  if (!timestamp) return "未知时间";
  const seconds = Math.max(0, Math.floor(Date.now() / 1_000 - timestamp));
  if (seconds < 60) return "刚刚";
  if (seconds < 3_600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)} 小时前`;
  return `${Math.floor(seconds / 86_400)} 天前`;
}

function statusTag(status: CodexThreadSummary["status"]): string {
  if (status === "active") return "<text_tag color='green'>活跃</text_tag>";
  if (status === "error") return "<text_tag color='red'>异常</text_tag>";
  return "<text_tag color='neutral'>已保存</text_tag>";
}

function safe(value: string): string {
  return value.replaceAll("<", "＜").replaceAll(">", "＞").replaceAll("*", "＊").replaceAll("`", "｀");
}
