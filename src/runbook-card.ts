import type { RunbookCatalog, RunbookDefinition } from "./runbooks.js";
import { runbookHasDefaultInputs } from "./runbooks.js";
import type { FeishuCard } from "./task-card.js";

export interface RunbookCenterSnapshot {
  projectName: string;
  catalog: RunbookCatalog;
  canOperate: boolean;
  feedback?: string;
}

export function renderRunbookCenterCard(snapshot: RunbookCenterSnapshot): FeishuCard {
  const ready = snapshot.catalog.status === "ready";
  return {
    schema: "2.0",
    config: {
      update_multi: true,
      width_mode: "default",
      enable_forward: false,
      summary: {
        content: `Codex 团队运行手册 · ${snapshot.projectName} · ${snapshot.catalog.runbooks.length} 项`,
      },
    },
    header: {
      title: { tag: "plain_text", content: "Codex 团队运行手册" },
      subtitle: {
        tag: "plain_text",
        content: "仓库内审核过的任务模板，一键运行也不会提升权限",
      },
      template: ready ? "violet" : "grey",
      icon: { tag: "standard_icon", token: "tasklist_colorful" },
      text_tag_list: [
        {
          tag: "text_tag",
          text: { tag: "plain_text", content: safe(snapshot.projectName).slice(0, 28) },
          color: "blue",
        },
        {
          tag: "text_tag",
          text: {
            tag: "plain_text",
            content: ready ? `${snapshot.catalog.runbooks.length} 个模板` : statusLabel(snapshot.catalog.status),
          },
          color: ready ? "violet" : "neutral",
        },
      ],
    },
    body: {
      direction: "vertical",
      padding: "12px 12px 18px 12px",
      vertical_spacing: "12px",
      elements: [
        ...(snapshot.feedback ? [feedbackPanel(snapshot.feedback)] : []),
        sourcePanel(snapshot),
        ...(snapshot.catalog.runbooks.length > 0
          ? snapshot.catalog.runbooks.slice(0, 12).map((runbook, index) =>
              runbookPanel(runbook, index, snapshot.canOperate),
            )
          : [emptyPanel(snapshot)]),
        actionGrid(),
        {
          tag: "markdown",
          element_id: "runbook_safety_note",
          text_size: "notation",
          text_align: "center",
          content:
            "<font color='grey'>模板只能降低权限；提交、推送、部署和 PR 不能通过一键运行预授权。</font>",
        },
      ],
    },
  };
}

function sourcePanel(snapshot: RunbookCenterSnapshot): Record<string, unknown> {
  const status = snapshot.catalog.status;
  const detail =
    status === "ready"
      ? "配置已通过格式与安全校验；任务仍按成员角色、项目 ACL 和仓库策略执行。"
      : status === "missing"
        ? "当前项目还没有运行手册。复制示例文件到仓库根目录并提交评审即可启用。"
        : `配置未启用：${snapshot.catalog.error ?? "未知格式错误"}`;
  return {
    tag: "column_set",
    element_id: "runbook_source",
    flex_mode: "none",
    columns: [
      {
        tag: "column",
        width: "weighted",
        weight: 1,
        background_style: status === "invalid" ? "red-50" : status === "ready" ? "blue-50" : "grey-50",
        padding: "10px 12px 10px 12px",
        elements: [
          {
            tag: "markdown",
            element_id: "runbook_source_text",
            content: `**${statusLabel(status)}**\n<font color='grey'>${safe(detail)}</font>`,
          },
        ],
      },
    ],
  };
}

function runbookPanel(
  runbook: RunbookDefinition,
  index: number,
  canOperate: boolean,
): Record<string, unknown> {
  const runnable = canOperate && runbookHasDefaultInputs(runbook);
  const parameterHint = runbook.parameters.length > 0
    ? `参数 ${runbook.parameters.map((parameter) => parameter.label).join("、")}`
    : "无需参数";
  const settingHint = [
    runbook.model ? `模型 ${runbook.model}` : "沿用模型",
    runbook.reasoningEffort ? `推理 ${runbook.reasoningEffort}` : "沿用推理",
    runbook.sandboxMode ? permissionLabel(runbook.sandboxMode) : "不提升权限",
  ].join(" · ");
  const elements: Record<string, unknown>[] = [
    {
      tag: "markdown",
      element_id: `runbook_text_${index}`,
      content:
        `**${safe(runbook.name)}**  <text_tag color='violet'>${safe(runbook.id)}</text_tag>\n` +
        `${safe(runbook.description)}\n` +
        `<font color='grey'>${safe(parameterHint)} · ${safe(settingHint)}</font>\n` +
        `<font color='grey'>任务预览</font>  ${safe(promptPreview(runbook.prompt))}`,
    },
  ];
  if (runnable) {
    elements.push(runButton(runbook, index));
  } else if (!canOperate) {
    elements.push({
      tag: "markdown",
      element_id: `runbook_readonly_${index}`,
      text_size: "notation",
      content: "<font color='grey'>只读成员不能启动运行手册。</font>",
    });
  } else {
    elements.push({
      tag: "markdown",
      element_id: `runbook_usage_${index}`,
      text_size: "notation",
      content: `<font color='blue'>发送 /run ${safe(runbook.id)} ${safe(parameterUsage(runbook))}</font>`,
    });
  }
  return {
    tag: "column_set",
    element_id: `runbook_${index}`,
    flex_mode: "none",
    columns: [
      {
        tag: "column",
        width: "weighted",
        weight: 1,
        background_style: "grey-50",
        padding: "12px 12px 12px 12px",
        vertical_spacing: "8px",
        elements,
      },
    ],
  };
}

function runButton(runbook: RunbookDefinition, index: number): Record<string, unknown> {
  return {
    tag: "button",
    element_id: `runbook_run_${index}`,
    text: { tag: "plain_text", content: "使用默认参数运行" },
    type: "primary_filled",
    width: "fill",
    confirm: {
      title: { tag: "plain_text", content: `运行“${runbook.name}”？` },
      text: {
        tag: "plain_text",
        content: "会在当前项目创建独立任务；实际权限不会高于你的当前设置。",
      },
    },
    behaviors: [
      {
        type: "callback",
        value: {
          bridge: "feishu-codex-v7",
          action: "runbook_run",
          runbook_id: runbook.id,
        },
      },
    ],
  };
}

function emptyPanel(snapshot: RunbookCenterSnapshot): Record<string, unknown> {
  return {
    tag: "column_set",
    element_id: "runbook_empty",
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
            content:
              snapshot.catalog.status === "invalid"
                ? "**运行手册已暂停**\n<font color='grey'>修复仓库配置后点击刷新；无效模板不会执行。</font>"
                : "**从一个小模板开始**\n<font color='grey'>建议先加入测试、检查或生成文档类任务。</font>",
          },
        ],
      },
    ],
  };
}

function feedbackPanel(feedback: string): Record<string, unknown> {
  return {
    tag: "column_set",
    element_id: "runbook_feedback",
    flex_mode: "none",
    columns: [
      {
        tag: "column",
        width: "weighted",
        weight: 1,
        background_style: "green-50",
        padding: "10px 12px 10px 12px",
        elements: [{ tag: "markdown", content: `<font color='green'>${safe(feedback)}</font>` }],
      },
    ],
  };
}

function actionGrid(): Record<string, unknown> {
  const actions = [
    button("项目工作台", "runbook_projects"),
    button("团队工作台", "runbook_team"),
    button("刷新", "runbook_refresh"),
  ];
  return {
    tag: "column_set",
    element_id: "runbook_actions",
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

function button(text: string, action: string): Record<string, unknown> {
  return {
    tag: "button",
    element_id: action,
    text: { tag: "plain_text", content: text },
    type: "default",
    width: "fill",
    behaviors: [
      {
        type: "callback",
        value: { bridge: "feishu-codex-v7", action },
      },
    ],
  };
}

function statusLabel(status: RunbookCatalog["status"]): string {
  if (status === "ready") return "配置已校验";
  if (status === "missing") return "尚未配置";
  return "配置需修复";
}

function permissionLabel(mode: "read-only" | "workspace-write"): string {
  return mode === "read-only" ? "只读" : "工作区写入";
}

function promptPreview(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, " ");
  return normalized.length > 140 ? `${normalized.slice(0, 139)}…` : normalized;
}

function parameterUsage(runbook: RunbookDefinition): string {
  return runbook.parameters
    .map((parameter) => `${parameter.name}="${parameter.defaultValue ?? parameter.label}"`)
    .join(" ");
}

function safe(value: string): string {
  return value
    .replaceAll("<", "＜")
    .replaceAll(">", "＞")
    .replaceAll("*", "＊")
    .replaceAll("`", "｀")
    .slice(0, 1_000);
}
