import type { CodexThreadSummary } from "./codex-runner.js";
import type { SessionCenterItem, ThreadActivitySource } from "./session-handoff.js";
import type { FeishuCard } from "./task-card.js";

export interface SessionCenterSnapshot {
  projectName: string;
  currentThreadId?: string;
  sessions: SessionCenterItem[];
  feedback?: string;
}

export function renderSessionCenterCard(snapshot: SessionCenterSnapshot): FeishuCard {
  const currentExists = snapshot.sessions.some((session) => session.id === snapshot.currentThreadId);
  const currentSession = snapshot.sessions.find((session) => session.id === snapshot.currentThreadId);
  return {
    schema: "2.0",
    config: {
      update_multi: true,
      width_mode: "default",
      enable_forward: false,
      summary: { content: `Codex 会话中心 · ${safe(snapshot.projectName)}` },
    },
    header: {
      title: { tag: "plain_text", content: "Codex 会话接力" },
      subtitle: { tag: "plain_text", content: `${snapshot.projectName} · 飞书与本机继续同一段上下文` },
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
        currentSession ? currentSessionBlock(currentSession) : emptyCurrentSession(),
        ...(snapshot.sessions.length > 0
          ? [
              {
                tag: "markdown",
                element_id: "session_select_hint",
                content:
                  "**绑定其他本地会话**\n<font color='grey'>输入会话名称搜索；确认后，后续飞书消息会继续所选上下文。</font>",
              },
            ]
          : []),
        snapshot.sessions.length > 0
          ? {
              tag: "select_static",
              element_id: "session_select",
              name: "thread_id",
              width: "fill",
              placeholder: { tag: "plain_text", content: "选择要绑定的本地 Codex 会话" },
              ...(currentExists ? { initial_option: snapshot.currentThreadId } : {}),
              options: snapshot.sessions.slice(0, 50).map((session) => ({
                text: {
                  tag: "plain_text",
                  content: `${session.id === snapshot.currentThreadId ? "当前 · " : ""}${sessionTitle(session)} · ${sourceLabel(session.activitySource)} · ${relativeTime(session.activityAt)}`.slice(0, 90),
                },
                value: session.id,
              })),
              confirm: {
                title: { tag: "plain_text", content: "确认绑定这个会话？" },
                text: {
                  tag: "plain_text",
                  content: "后续飞书消息会继续所选 Codex 上下文。运行或排队中的任务不会被强制切换。",
                },
              },
              behaviors: [callback("select_session")],
            }
          : {
              tag: "markdown",
              element_id: "session_empty",
              content: "**还没有历史会话**\n<font color='grey'>发送第一条开发任务后，会话会自动保存在这里。</font>",
            },
        ...snapshot.sessions
          .slice(0, 5)
          .map((session, index) => sessionRow(session, index, session.id === snapshot.currentThreadId)),
        ...(currentExists
          ? [button("在本机打开当前会话", "session_open_desktop", "primary")]
          : []),
        actionGrid("session_actions", [
          button("压缩当前会话", "session_compact", "default"),
          button("新会话", "session_new", "default"),
          button("返回设置", "session_settings", "default"),
          button("刷新", "session_refresh", "default"),
        ]),
        {
          tag: "markdown",
          element_id: "session_sync_note",
          text_size: "caption",
          content:
            "<font color='grey'>只接力 Codex 原生对话和上下文；飞书卡片、按钮、群聊普通消息不会写入 Codex 历史。</font>",
        },
      ],
    },
  };
}

function currentSessionBlock(session: SessionCenterItem): Record<string, unknown> {
  return {
    tag: "column_set",
    element_id: "current_session",
    flex_mode: "none",
    columns: [
      {
        tag: "column",
        width: "weighted",
        weight: 1,
        background_style: "blue-50",
        padding: "12px 12px 12px 12px",
        vertical_spacing: "4px",
        elements: [
          {
            tag: "markdown",
            element_id: "curr_session_title",
            content: `**当前接力会话**  ${sourceTag(session.activitySource)}\n${safe(sessionTitle(session))}`,
          },
          {
            tag: "markdown",
            element_id: "curr_session_time",
            text_size: "caption",
            content: `<font color='grey'>最近活动：${sourceLabel(session.activitySource)} · ${relativeTime(session.activityAt)}</font>`,
          },
        ],
      },
    ],
  };
}

function emptyCurrentSession(): Record<string, unknown> {
  return {
    tag: "markdown",
    element_id: "curr_session_empty",
    content:
      "**尚未绑定会话**\n<font color='grey'>选择一个本地历史会话，或发送第一条任务自动创建。</font>",
  };
}

function sessionRow(
  session: SessionCenterItem,
  index: number,
  current: boolean,
): Record<string, unknown> {
  return {
    tag: "markdown",
    element_id: `session_row_${index}`,
    content: `${current ? "<text_tag color='blue'>当前</text_tag>  " : ""}**${safe(sessionTitle(session))}**  ${sourceTag(session.activitySource)}  ${statusTag(session.status)}\n<font color='grey'>${safe(session.preview || "暂无摘要").slice(0, 160)} · ${relativeTime(session.activityAt)}</font>`,
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
  const milliseconds = timestamp < 10_000_000_000 ? timestamp * 1_000 : timestamp;
  const seconds = Math.max(0, Math.floor((Date.now() - milliseconds) / 1_000));
  if (seconds < 60) return "刚刚";
  if (seconds < 3_600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)} 小时前`;
  return `${Math.floor(seconds / 86_400)} 天前`;
}

function sourceLabel(source: ThreadActivitySource): string {
  if (source === "feishu") return "最近在飞书更新";
  if (source === "desktop") return "最近在本机更新";
  return "更新来源待确认";
}

function sourceTag(source: ThreadActivitySource): string {
  if (source === "feishu") return "<text_tag color='blue'>飞书</text_tag>";
  if (source === "desktop") return "<text_tag color='turquoise'>本机</text_tag>";
  return "<text_tag color='neutral'>来源未知</text_tag>";
}

function statusTag(status: CodexThreadSummary["status"]): string {
  if (status === "active") return "<text_tag color='green'>活跃</text_tag>";
  if (status === "error") return "<text_tag color='red'>异常</text_tag>";
  return "<text_tag color='neutral'>已保存</text_tag>";
}

function safe(value: string): string {
  return value.replaceAll("<", "＜").replaceAll(">", "＞").replaceAll("*", "＊").replaceAll("`", "｀");
}
