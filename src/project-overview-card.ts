import type { ProjectOverviewSnapshot } from "./project-overview.js";
import type { FeishuCard } from "./task-card.js";

export function renderProjectOverviewCard(snapshot: ProjectOverviewSnapshot): FeishuCard {
  const gitLabel = snapshot.gitStatus
    ? snapshot.gitStatus.dirty
      ? `${snapshot.gitStatus.changedFiles} 个变更`
      : "工作区干净"
    : snapshot.project.isGitRepository
      ? "Git 状态未知"
      : "普通文件夹";
  const branch = snapshot.gitStatus?.branch ?? "—";
  const stack = snapshot.stack.length > 0 ? snapshot.stack.join(" · ") : "未从 package.json 识别";
  const languages = snapshot.languages.length > 0 ? snapshot.languages.join(" · ") : "暂未识别";
  const directories = snapshot.topDirectories.length > 0
    ? snapshot.topDirectories.map((directory) => `\`${safeMarkdown(directory)}\``).join("  ")
    : "暂无目录索引";

  return {
    schema: "2.0",
    config: {
      update_multi: true,
      width_mode: "default",
      enable_forward: false,
      summary: { content: `项目概览 · ${safePlain(snapshot.project.name)}` },
    },
    header: {
      title: { tag: "plain_text", content: `${safePlain(snapshot.project.name)} · 项目概览` },
      subtitle: { tag: "plain_text", content: "本地确定性快照，不启动 Codex" },
      template: "blue",
      icon: { tag: "standard_icon", token: "folder_outlined" },
      text_tag_list: [
        {
          tag: "text_tag",
          text: { tag: "plain_text", content: "0 AI token" },
          color: "green",
        },
        {
          tag: "text_tag",
          text: {
            tag: "plain_text",
            content: snapshot.project.isGitRepository ? "Git" : "文件夹",
          },
          color: "blue",
        },
      ],
    },
    body: {
      direction: "vertical",
      padding: "12px 12px 20px 12px",
      vertical_spacing: "12px",
      elements: [
        {
          tag: "column_set",
          element_id: "overview_summary",
          flex_mode: "none",
          columns: [
            {
              tag: "column",
              width: "weighted",
              weight: 1,
              background_style: "blue-50",
              padding: "12px 12px 12px 12px",
              vertical_spacing: "6px",
              elements: [
                {
                  tag: "markdown",
                  element_id: "overview_description",
                  content: `**项目说明**\n${safeMarkdown(snapshot.description)}`,
                },
                {
                  tag: "markdown",
                  element_id: "overview_path",
                  text_size: "notation",
                  content: `<font color='grey'>路径</font>  ${safeMarkdown(snapshot.project.displayPath)}`,
                },
              ],
            },
          ],
        },
        {
          tag: "column_set",
          element_id: "overview_metrics",
          flex_mode: "none",
          horizontal_spacing: "8px",
          columns: [
            metric("文件", `${formatNumber(snapshot.fileCount)}${snapshot.indexTruncated ? "+" : ""}`),
            metric("分支", branch),
            metric("状态", gitLabel),
          ],
        },
        {
          tag: "column_set",
          element_id: "overview_tech",
          flex_mode: "none",
          columns: [
            {
              tag: "column",
              width: "weighted",
              weight: 1,
              background_style: "grey-50",
              padding: "12px 12px 12px 12px",
              vertical_spacing: "6px",
              elements: [
                {
                  tag: "markdown",
                  element_id: "overview_stack",
                  content: `**技术概况**\n<font color='grey'>技术栈</font>  ${safeMarkdown(stack)}\n<font color='grey'>语言</font>  ${safeMarkdown(languages)}\n<font color='grey'>包管理</font>  ${safeMarkdown(snapshot.packageManager)}${snapshot.workspace ? " · Workspace" : ""}${snapshot.commit ? `\n<font color='grey'>Commit</font>  \`${safeMarkdown(snapshot.commit)}\`` : ""}`,
                },
                {
                  tag: "markdown",
                  element_id: "overview_dirs",
                  content: `**主要目录**\n${directories}`,
                },
              ],
            },
          ],
        },
        {
          tag: "markdown",
          element_id: "overview_hint",
          text_size: "notation",
          text_align: "center",
          content: "<font color='grey'>“读取项目”只生成本地快照；发送“深入分析项目架构”才会启动 Codex。</font>",
        },
      ],
    },
  };
}

export function renderProjectOverviewText(snapshot: ProjectOverviewSnapshot): string {
  const git = snapshot.gitStatus
    ? `${snapshot.gitStatus.branch} · ${snapshot.gitStatus.dirty ? `${snapshot.gitStatus.changedFiles} 个变更` : "工作区干净"}`
    : snapshot.project.isGitRepository ? "Git 状态未知" : "普通文件夹";
  return [
    `项目概览 · ${snapshot.project.name}`,
    snapshot.description,
    "",
    `- 路径：${snapshot.project.displayPath}`,
    `- Git：${git}`,
    `- 文件：${snapshot.fileCount}${snapshot.indexTruncated ? "+" : ""}`,
    `- 技术栈：${snapshot.stack.join("、") || "未识别"}`,
    `- 语言：${snapshot.languages.join("、") || "未识别"}`,
    `- 包管理：${snapshot.packageManager}${snapshot.workspace ? " · Workspace" : ""}`,
    `- 主要目录：${snapshot.topDirectories.join("、") || "暂无"}`,
    "",
    "本次使用本地快照，AI token：0。发送“深入分析项目架构”才会启动 Codex。",
  ].join("\n");
}

function metric(label: string, value: string): Record<string, unknown> {
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
        text_align: "center",
        text_size: "notation",
        content: `<font color='grey'>${safeMarkdown(label)}</font>`,
      },
      {
        tag: "markdown",
        text_align: "center",
        content: `**${safeMarkdown(truncate(value, 24))}**`,
      },
    ],
  };
}

function safeMarkdown(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replace(/[<>&]/g, (character) => ({ "<": "＜", ">": "＞", "&": "＆" })[character]!)
    .replaceAll("`", "ˋ");
}

function safePlain(value: string): string {
  return value.replace(/[\r\n\u0000-\u001f\u007f]/g, " ").slice(0, 80);
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}
