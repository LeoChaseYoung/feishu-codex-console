import type { FeishuCard } from "./task-card.js";
import type { CodexProject } from "./project-registry.js";
import type { ProjectGitStatus } from "./project-status.js";

export interface ProjectCardContext {
  gitStatus?: ProjectGitStatus | null;
  favoritePaths?: readonly string[];
  recentPaths?: readonly string[];
  canSwitch?: boolean;
  activeTasks?: number;
  queuedTasks?: number;
  hasSavedThread?: boolean;
  policyLabel?: string;
  projectChat?: {
    name: string;
    isCurrentChat: boolean;
    needsRepair?: boolean;
  };
  canCreateProjectChat?: boolean;
  requiresProjectBinding?: boolean;
}

export function projectGroupBindingCardFailureText(): string {
  return "项目绑定卡发送失败，因此本群仍未授权，也不会执行任务。请管理员检查 CardKit 卡片创建权限和 card.action.trigger 事件订阅，修复后在群里发送“项目”重试。";
}

export function renderProjectCard(
  projects: readonly CodexProject[],
  current: CodexProject,
  feedback = "",
  context: ProjectCardContext = {},
): FeishuCard {
  const gitCount = projects.filter((project) => project.isGitRepository).length;
  const folderCount = projects.length - gitCount;
  const fixedProjectChat = Boolean(context.projectChat?.isCurrentChat && context.canSwitch === false);

  return {
    schema: "2.0",
    config: {
      update_multi: true,
      width_mode: "default",
      enable_forward: false,
      summary: { content: `Codex 项目工作台 · 当前 ${safePlainText(current.name)}` },
      style: {
        text_size: {
          project_name: { default: "heading-4", pc: "heading-4", mobile: "normal" },
          caption: { default: "notation", pc: "notation", mobile: "notation" },
        },
      },
    },
    header: {
      title: {
        tag: "plain_text",
        content: context.requiresProjectBinding ? "为这个群选择项目" : "Codex 项目工作台",
      },
      subtitle: {
        tag: "plain_text",
        content: context.requiresProjectBinding
          ? "第一次选定后永久固定，不支持切换"
          : fixedProjectChat
            ? "本群只连接这一个项目；每个话题是一段独立会话"
          : "后续任务会在当前项目目录中执行",
      },
      template: "blue",
      icon: { tag: "standard_icon", token: "myai_colorful" },
      text_tag_list: fixedProjectChat
        ? [
            {
              tag: "text_tag",
              text: { tag: "plain_text", content: "项目已固定" },
              color: "green",
            },
            {
              tag: "text_tag",
              text: { tag: "plain_text", content: "话题隔离" },
              color: "blue",
            },
          ]
        : [
            {
              tag: "text_tag",
              text: { tag: "plain_text", content: `${projects.length} 个项目` },
              color: "blue",
            },
            {
              tag: "text_tag",
              text: { tag: "plain_text", content: "自动同步" },
              color: "violet",
            },
          ],
    },
    body: {
      direction: "vertical",
      padding: "12px 12px 20px 12px",
      vertical_spacing: "12px",
      elements: context.requiresProjectBinding
        ? [
            projectBindingIntro(feedback),
            projectSelector(projects, current, context),
            projectStats(projects.length, gitCount, folderCount),
          ]
        : fixedProjectChat
          ? [
              currentProjectBlock(current, feedback, context),
              ...projectChatPanel(context),
            ]
          : [
            currentProjectBlock(current, feedback, context),
            ...projectChatPanel(context),
            projectFavoriteAction(current, context),
            projectSelector(projects, current, context),
            projectStats(projects.length, gitCount, folderCount),
          ],
    },
  };
}

function projectBindingIntro(feedback: string): Record<string, unknown> {
  return {
    tag: "column_set",
    element_id: "project_binding_intro",
    flex_mode: "none",
    columns: [
      {
        tag: "column",
        width: "weighted",
        weight: 1,
        background_style: "turquoise-50",
        padding: "12px 12px 12px 12px",
        vertical_spacing: "6px",
        elements: [
          {
            tag: "markdown",
            element_id: "project_binding_title",
            content: "**这个群还没有连接本地项目**",
          },
          {
            tag: "markdown",
            element_id: "project_binding_detail",
            text_size: "caption",
            content:
              "<font color='grey'>请选择一次。确认后，机器人会记住群与项目的关系；群内所有新任务都在该项目运行。</font>",
          },
          ...(feedback
            ? [
                {
                  tag: "markdown",
                  element_id: "project_binding_feedback",
                  text_size: "caption",
                  content: `<font color='red'>${safeMarkdown(feedback)}</font>`,
                },
              ]
            : []),
        ],
      },
    ],
  };
}

function projectChatPanel(context: ProjectCardContext): Record<string, unknown>[] {
  if (!context.projectChat && !context.canCreateProjectChat) return [];
  const current = context.projectChat?.isCurrentChat ?? false;
  const needsRepair = context.projectChat?.needsRepair ?? false;
  const title = current
    ? "本群已固定连接这个项目"
    : needsRepair
      ? `项目群待修复：${safeMarkdown(context.projectChat?.name ?? "")}`
      : context.projectChat
        ? `项目群：${safeMarkdown(context.projectChat.name)}`
        : "为这个项目创建专属群";
  const detail = current
    ? "群内每个新话题对应一段独立 Codex 会话；项目不能在本群内切换。"
    : needsRepair
      ? "群与项目已经绑定；点击后只补成员、工作台或置顶的未完成步骤，不会重复建群。"
      : context.projectChat
        ? "项目已经有专属群，点击即可在飞书中打开。"
        : "机器人会自动建群、绑定项目并发送工作区入口，不需要复制 chat_id 或修改配置。";
  const elements: Record<string, unknown>[] = [
    {
      tag: "markdown",
      element_id: "project_chat_copy",
      content: `**${title}**\n<font color='grey'>${detail}</font>`,
    },
  ];
  if (!current) {
    elements.push({
      tag: "button",
      element_id: "project_chat_action",
      text: {
        tag: "plain_text",
        content: needsRepair
          ? "修复并打开项目群"
          : context.projectChat
            ? "打开项目群"
            : "一键创建项目群",
      },
      type: "primary_filled",
      width: "fill",
      behaviors: [
        {
          type: "callback",
          value: { bridge: "feishu-codex-v3", action: "project_chat" },
        },
      ],
    });
  }
  return [
    {
      tag: "column_set",
      element_id: "project_chat_panel",
      flex_mode: "none",
      columns: [
        {
          tag: "column",
          width: "weighted",
          weight: 1,
          background_style: current ? "green-50" : "turquoise-50",
          padding: "12px 12px 12px 12px",
          vertical_spacing: "8px",
          elements,
        },
      ],
    },
  ];
}

function currentProjectBlock(
  current: CodexProject,
  feedback: string,
  context: ProjectCardContext,
): Record<string, unknown> {
  const favorite = context.favoritePaths?.includes(current.path) ?? false;
  const elements: Record<string, unknown>[] = [
    {
      tag: "markdown",
      element_id: "current_label",
      text_size: "caption",
      content: "<font color='blue'>当前项目</font>",
    },
    {
      tag: "markdown",
      element_id: "current_name",
      text_size: "project_name",
      content: `**<font color='blue'>${safeMarkdown(current.name)}</font>**  ${projectTag(current)}${favorite ? "  <text_tag color='yellow'>已收藏</text_tag>" : ""}`,
    },
    {
      tag: "markdown",
      element_id: "current_path",
      text_size: "caption",
      content: `<font color='grey'>${safeMarkdown(current.displayPath)}</font>`,
    },
  ];
  if (current.isGitRepository) {
    elements.push({
      tag: "markdown",
      element_id: "current_git_status",
      text_size: "caption",
      content: `<font color='grey'>${safeMarkdown(gitStatusLabel(context.gitStatus))}</font>`,
    });
  }
  if (context.policyLabel) {
    elements.push({
      tag: "markdown",
      element_id: "current_policy",
      text_size: "caption",
      content: `<font color='grey'>安全策略：${safeMarkdown(context.policyLabel)}</font>`,
    });
  }
  if (feedback) {
    elements.push({
      tag: "markdown",
      element_id: "switch_feedback",
      text_size: "caption",
      content: `<font color='blue'>${safeMarkdown(feedback)}</font>`,
    });
  }
  return {
    tag: "column_set",
    element_id: "current_panel",
    flex_mode: "none",
    columns: [
      {
        tag: "column",
        width: "weighted",
        weight: 1,
        background_style: "blue-50",
        padding: "12px 12px 12px 12px",
        vertical_spacing: "4px",
        elements,
      },
    ],
  };
}

function projectSelector(
  projects: readonly CodexProject[],
  current: CodexProject,
  context: ProjectCardContext,
): Record<string, unknown> {
  const canSwitch = context.canSwitch ?? true;
  const binding = context.requiresProjectBinding ?? false;
  const favorite = new Set(context.favoritePaths ?? []);
  const recent = new Set(context.recentPaths ?? []);
  const switchImpact = switchImpactLabel(context);
  return {
    tag: "column_set",
    element_id: "selector_panel",
    flex_mode: "none",
    columns: [
      {
        tag: "column",
        width: "weighted",
        weight: 1,
        background_style: "grey-50",
        padding: "12px 12px 12px 12px",
        vertical_spacing: "8px",
        elements: canSwitch ? [
          {
            tag: "markdown",
            element_id: "selector_title",
            content: binding
              ? "**选择这个群唯一对应的项目**\n<font color='grey'>可以输入项目名或路径搜索；请确认无误，绑定后不支持切换</font>"
              : "**查找并切换项目**\n<font color='grey'>可以输入项目名或路径搜索；收藏和最近使用排在前面</font>",
          },
          {
            tag: "select_static",
            element_id: "project_select",
            name: "project_path",
            width: "fill",
            placeholder: { tag: "plain_text", content: "选择一个项目" },
            ...(binding ? {} : { initial_option: current.path }),
            options: projects.slice(0, 100).map((project) => ({
              text: {
                tag: "plain_text",
                content: projectOptionLabel(project, favorite, recent),
              },
              value: project.path,
            })),
            confirm: {
              title: {
                tag: "plain_text",
                content: binding ? "确认绑定这个项目？" : "确认切换项目？",
              },
              text: {
                tag: "plain_text",
                content: binding
                  ? "选定后，这个群将永久固定到该项目，不支持切换。"
                  : switchImpact,
              },
            },
            behaviors: [
              {
                type: "callback",
                value: { bridge: "feishu-codex-v2", action: "select_project" },
              },
            ],
          },
          {
            tag: "markdown",
            element_id: "selector_hint",
            text_size: "caption",
            content:
              `<font color='grey'>${safeMarkdown(binding ? "绑定前不会执行任何 Codex 任务。" : switchImpact)}${projects.length > 100 ? `\n当前显示前 100 个；也可发送“切换 项目名或路径”搜索全部 ${projects.length} 个。` : ""}</font>`,
          },
        ] : [
          {
            tag: "markdown",
            element_id: "selector_readonly",
            content: context.projectChat?.isCurrentChat
              ? "**项目已锁定**\n<font color='grey'>这个群首次选定项目后不再支持切换；新话题会继续使用当前项目。</font>"
              : "**项目列表为只读**\n<font color='grey'>当前身份可以查看项目和收藏当前项目，但不能切换执行目录。</font>",
          },
        ],
      },
    ],
  };
}

function projectFavoriteAction(
  current: CodexProject,
  context: ProjectCardContext,
): Record<string, unknown> {
  const favorite = context.favoritePaths?.includes(current.path) ?? false;
  return {
    tag: "column_set",
    element_id: "project_fav_actions",
    flex_mode: "none",
    columns: [
      {
        tag: "column",
        width: "weighted",
        weight: 1,
        elements: [
          {
            tag: "button",
            element_id: "project_fav_toggle",
            text: { tag: "plain_text", content: favorite ? "取消收藏当前项目" : "收藏当前项目" },
            type: favorite ? "default" : "primary_filled",
            width: "fill",
            behaviors: [
              {
                type: "callback",
                value: { bridge: "feishu-codex-v2", action: "toggle_project_favorite" },
              },
            ],
          },
        ],
      },
    ],
  };
}

function projectStats(total: number, git: number, folders: number): Record<string, unknown> {
  return {
    tag: "column_set",
    element_id: "project_stats",
    flex_mode: "none",
    horizontal_spacing: "8px",
    columns: [
      metricColumn("stats_total", total, "全部项目"),
      metricColumn("stats_git", git, "Git 仓库"),
      metricColumn("stats_folder", folders, "普通文件夹"),
    ],
  };
}

function metricColumn(elementId: string, value: number, label: string): Record<string, unknown> {
  return {
    tag: "column",
    width: "weighted",
    weight: 1,
    background_style: "grey-50",
    padding: "8px 4px 8px 4px",
    vertical_spacing: "2px",
    elements: [
      {
        tag: "markdown",
        element_id: `${elementId}_value`,
        text_align: "center",
        content: `**${value}**`,
      },
      {
        tag: "markdown",
        element_id: `${elementId}_label`,
        text_align: "center",
        text_size: "caption",
        content: `<font color='grey'>${label}</font>`,
      },
    ],
  };
}

function projectTag(project: CodexProject): string {
  return project.isGitRepository
    ? "<text_tag color='blue'>Git</text_tag>"
    : "<text_tag color='neutral'>文件夹</text_tag>";
}

function projectType(project: CodexProject): string {
  return project.isGitRepository ? "Git" : "文件夹";
}

function projectOptionLabel(
  project: CodexProject,
  favorite: Set<string>,
  recent: Set<string>,
): string {
  const marker = favorite.has(project.path) ? "★" : recent.has(project.path) ? "最近" : "项目";
  return truncatePlain(
    `${marker} ${safePlainText(project.name)} · ${projectType(project)} · ${safePlainText(project.displayPath)}`,
    90,
  );
}

function gitStatusLabel(status: ProjectGitStatus | null | undefined): string {
  if (!status) return "Git 分支状态暂不可用";
  const branch = status.detached ? `分离状态 ${status.branch}` : `分支 ${status.branch}`;
  const worktree = status.dirty ? `${status.changedFiles} 个未提交变更` : "工作区干净";
  const divergence = [
    status.ahead > 0 ? `领先 ${status.ahead}` : "",
    status.behind > 0 ? `落后 ${status.behind}` : "",
  ].filter(Boolean).join(" · ");
  return `${branch} · ${worktree}${divergence ? ` · ${divergence}` : ""}`;
}

function switchImpactLabel(context: ProjectCardContext): string {
  const active = context.activeTasks ?? 0;
  const queued = context.queuedTasks ?? 0;
  const taskImpact = active + queued > 0
    ? `会停止 ${active} 个运行任务和 ${queued} 个排队任务`
    : "当前没有未完成任务";
  const sessionImpact = context.hasSavedThread
    ? "并清空当前聊天保存的 Codex 上下文"
    : "并从新会话开始";
  return `${taskImpact}，${sessionImpact}。`;
}

function safeMarkdown(value: string): string {
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

function safePlainText(value: string): string {
  return value.replaceAll("<", "＜").replaceAll(">", "＞");
}

function truncatePlain(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}
