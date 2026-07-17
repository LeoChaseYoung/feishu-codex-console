import type { FeishuCard } from "./task-card.js";
import type { TeamRole } from "./types.js";

export interface TeamMemberMetric {
  label: string;
  role: TeamRole;
  tasks: number;
  active: number;
  controlled: number;
  succeeded: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
}

export interface TeamProjectMetric {
  label: string;
  tasks: number;
  active: number;
  members: number;
}

export interface TeamDashboardSnapshot {
  scopeLabel: string;
  periodLabel: string;
  members: TeamMemberMetric[];
  projects: TeamProjectMetric[];
  activeTasks: number;
  queuedTasks: number;
  completedTasks: number;
  successRate?: number;
  inputTokens: number;
  outputTokens: number;
  canAdminister: boolean;
  feedback?: string;
}

export function renderTeamDashboardCard(snapshot: TeamDashboardSnapshot): FeishuCard {
  return {
    schema: "2.0",
    config: {
      update_multi: true,
      width_mode: "default",
      enable_forward: false,
      summary: {
        content: `Codex 团队工作台 · 活跃 ${snapshot.activeTasks} · 成功率 ${successRateLabel(snapshot.successRate)}`,
      },
    },
    header: {
      title: { tag: "plain_text", content: "Codex 团队工作台" },
      subtitle: { tag: "plain_text", content: snapshot.scopeLabel },
      template: snapshot.activeTasks > 0 ? "blue" : "turquoise",
      icon: { tag: "standard_icon", token: "group_colorful" },
      text_tag_list: [
        {
          tag: "text_tag",
          text: { tag: "plain_text", content: snapshot.periodLabel },
          color: "neutral",
        },
        {
          tag: "text_tag",
          text: {
            tag: "plain_text",
            content: snapshot.canAdminister ? "团队视图" : "个人视图",
          },
          color: snapshot.canAdminister ? "violet" : "blue",
        },
      ],
    },
    body: {
      direction: "vertical",
      padding: "12px 12px 18px 12px",
      vertical_spacing: "12px",
      elements: [
        ...(snapshot.feedback ? [feedbackPanel(snapshot.feedback)] : []),
        metricRow(snapshot),
        usagePanel(snapshot),
        sectionTitle("team_members_title", "成员状态", `${snapshot.members.length} 位可见成员`),
        ...(snapshot.members.length > 0
          ? snapshot.members.slice(0, 8).map(memberPanel)
          : [emptyPanel("team_members_empty", "暂无成员任务数据")]),
        sectionTitle("team_projects_title", "项目负载", "按最近保留的任务记录统计"),
        ...(snapshot.projects.length > 0
          ? snapshot.projects.slice(0, 6).map(projectPanel)
          : [emptyPanel("team_projects_empty", "暂无项目任务数据")]),
        actionGrid(),
        {
          tag: "markdown",
          element_id: "team_privacy_note",
          text_size: "notation",
          text_align: "center",
          content:
            "<font color='grey'>团队面板不展示提示词、结果正文或 open_id；管理操作均写入本地审计。</font>",
        },
      ],
    },
  };
}

function metricRow(snapshot: TeamDashboardSnapshot): Record<string, unknown> {
  return {
    tag: "column_set",
    element_id: "team_metrics",
    flex_mode: "none",
    horizontal_spacing: "8px",
    columns: [
      metricColumn("活跃任务", String(snapshot.activeTasks), "blue"),
      metricColumn("排队任务", String(snapshot.queuedTasks), "grey"),
      metricColumn("成功率", successRateLabel(snapshot.successRate), "green"),
    ],
  };
}

function metricColumn(label: string, value: string, color: string): Record<string, unknown> {
  return {
    tag: "column",
    width: "weighted",
    weight: 1,
    background_style: `${color}-50`,
    padding: "10px 6px 10px 6px",
    vertical_spacing: "2px",
    elements: [
      {
        tag: "markdown",
        text_align: "center",
        text_size: "notation",
        content: `<font color='grey'>${safe(label)}</font>`,
      },
      {
        tag: "markdown",
        text_align: "center",
        content: `**${safe(value)}**`,
      },
    ],
  };
}

function usagePanel(snapshot: TeamDashboardSnapshot): Record<string, unknown> {
  return {
    tag: "column_set",
    element_id: "team_usage",
    flex_mode: "none",
    columns: [
      {
        tag: "column",
        width: "weighted",
        weight: 1,
        background_style: "grey-50",
        padding: "10px 12px 10px 12px",
        elements: [
          {
            tag: "markdown",
            element_id: "team_usage_text",
            content:
              `**资源概览**  已完成 ${formatNumber(snapshot.completedTasks)} 个任务\n` +
              `<font color='grey'>输入 / 输出 tokens</font>  ${formatNumber(snapshot.inputTokens)} / ${formatNumber(snapshot.outputTokens)}`,
          },
        ],
      },
    ],
  };
}

function memberPanel(member: TeamMemberMetric, index: number): Record<string, unknown> {
  const completed = member.succeeded + member.failed;
  const rate = completed > 0 ? member.succeeded / completed : undefined;
  return {
    tag: "column_set",
    element_id: `team_member_${index}`,
    flex_mode: "none",
    columns: [
      {
        tag: "column",
        width: "weighted",
        weight: 1,
        background_style: member.active > 0 ? "blue-50" : "grey-50",
        padding: "10px 12px 10px 12px",
        elements: [
          {
            tag: "markdown",
            element_id: `team_member_text_${index}`,
            content:
              `**${safe(member.label)}**  ${roleTag(member.role)}${member.active > 0 ? "  <text_tag color='blue'>执行中</text_tag>" : ""}\n` +
              `<font color='grey'>发起 ${member.tasks} · 控制 ${member.controlled} · 成功率 ${successRateLabel(rate)} · tokens ${formatCompact(member.inputTokens + member.outputTokens)}</font>`,
          },
        ],
      },
    ],
  };
}

function projectPanel(project: TeamProjectMetric, index: number): Record<string, unknown> {
  return {
    tag: "column_set",
    element_id: `team_project_${index}`,
    flex_mode: "none",
    columns: [
      {
        tag: "column",
        width: "weighted",
        weight: 1,
        background_style: project.active > 0 ? "blue-50" : "grey-50",
        padding: "10px 12px 10px 12px",
        elements: [
          {
            tag: "markdown",
            element_id: `team_project_text_${index}`,
            content:
              `**${safe(project.label)}**${project.active > 0 ? `  <text_tag color='blue'>活跃 ${project.active}</text_tag>` : ""}\n` +
              `<font color='grey'>${project.tasks} 个任务 · ${project.members} 位成员</font>`,
          },
        ],
      },
    ],
  };
}

function sectionTitle(id: string, title: string, detail: string): Record<string, unknown> {
  return {
    tag: "markdown",
    element_id: id,
    content: `**${safe(title)}**\n<font color='grey'>${safe(detail)}</font>`,
  };
}

function emptyPanel(id: string, text: string): Record<string, unknown> {
  return {
    tag: "column_set",
    element_id: id,
    flex_mode: "none",
    columns: [
      {
        tag: "column",
        width: "weighted",
        weight: 1,
        background_style: "grey-50",
        padding: "10px 12px 10px 12px",
        elements: [{ tag: "markdown", content: `<font color='grey'>${safe(text)}</font>` }],
      },
    ],
  };
}

function feedbackPanel(feedback: string): Record<string, unknown> {
  return {
    tag: "column_set",
    element_id: "team_feedback",
    flex_mode: "none",
    columns: [
      {
        tag: "column",
        width: "weighted",
        weight: 1,
        background_style: "green-50",
        padding: "10px 12px 10px 12px",
        elements: [
          {
            tag: "markdown",
            content: `<font color='green'>${safe(feedback)}</font>`,
          },
        ],
      },
    ],
  };
}

function actionGrid(): Record<string, unknown> {
  const actions = [
    button("任务中心", "team_tasks", "primary"),
    button("运行手册", "team_runbooks", "default"),
    button("项目工作台", "team_projects", "default"),
    button("刷新", "team_refresh", "default"),
  ];
  return {
    tag: "column_set",
    element_id: "team_actions",
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
    element_id: action,
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

function roleTag(role: TeamRole): string {
  if (role === "admin") return "<text_tag color='violet'>管理员</text_tag>";
  if (role === "operator") return "<text_tag color='blue'>操作者</text_tag>";
  return "<text_tag color='neutral'>只读成员</text_tag>";
}

function successRateLabel(value: number | undefined): string {
  return value === undefined ? "暂无" : `${Math.round(value * 100)}%`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatCompact(value: number): string {
  return new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(
    value,
  );
}

function safe(value: string): string {
  return value
    .replaceAll("<", "＜")
    .replaceAll(">", "＞")
    .replaceAll("*", "＊")
    .replaceAll("`", "｀")
    .slice(0, 160);
}
