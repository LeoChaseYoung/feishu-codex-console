import type { AccountQuotaSnapshot } from "./account-quota.js";
import { renderAccountQuotaSummary } from "./account-quota-card.js";
import type { CodexModel } from "./codex-runner.js";
import type { FeishuCard } from "./task-card.js";
import type { ReasoningEffort, SandboxMode, TeamRole } from "./types.js";

export interface ControlCenterSnapshot {
  projectName: string;
  role: TeamRole;
  models: CodexModel[];
  selectedModel: string;
  selectedEffort: ReasoningEffort;
  selectedSandbox: SandboxMode;
  sandboxModes: SandboxMode[];
  modelCatalogAvailable: boolean;
  accountQuota?: AccountQuotaSnapshot;
  fullAccessMaximum?: boolean;
  fullAccessLeaseLabel?: string;
  fullAccessSessionAvailable?: boolean;
  feedback?: string;
}

export function renderControlCenterCard(snapshot: ControlCenterSnapshot): FeishuCard {
  const models = modelOptions(snapshot.models, snapshot.selectedModel);
  const selected =
    snapshot.models.find((model) => model.model === snapshot.selectedModel) ??
    snapshot.models.find((model) => model.isDefault);
  const readOnly = snapshot.role === "viewer";
  const catalogEditable = !readOnly && snapshot.modelCatalogAvailable;
  const efforts = uniqueEfforts(
    selected?.supportedReasoningEfforts.length
      ? selected.supportedReasoningEfforts
      : ["minimal", "low", "medium", "high", "xhigh"],
  );
  const selectedEffort = efforts.includes(snapshot.selectedEffort)
    ? snapshot.selectedEffort
    : selected?.defaultReasoningEffort ?? efforts[0] ?? snapshot.selectedEffort;
  return {
    schema: "2.0",
    config: {
      update_multi: true,
      width_mode: "default",
      enable_forward: false,
      summary: { content: `Codex 控制中心 · ${safe(snapshot.projectName)}` },
    },
    header: {
      title: { tag: "plain_text", content: "Codex 控制中心" },
      subtitle: {
        tag: "plain_text",
        content: readOnly ? "只读查看当前会话设置" : "模型、推理与权限会在下一轮真实生效",
      },
      template: "turquoise",
      icon: { tag: "standard_icon", token: "settings_colorful" },
      text_tag_list: [
        {
          tag: "text_tag",
          text: { tag: "plain_text", content: roleLabel(snapshot.role) },
          color: snapshot.role === "admin" ? "violet" : "blue",
        },
        {
          tag: "text_tag",
          text: { tag: "plain_text", content: safe(snapshot.projectName).slice(0, 28) },
          color: "turquoise",
        },
        ...(!snapshot.modelCatalogAvailable
          ? [
              {
                tag: "text_tag",
                text: { tag: "plain_text", content: "兼容模式" },
                color: "neutral",
              },
            ]
          : []),
      ],
    },
    body: {
      direction: "vertical",
      padding: "12px 12px 18px 12px",
      vertical_spacing: "12px",
      elements: [
        ...(snapshot.feedback ? [feedbackPanel(snapshot.feedback)] : []),
        ...(snapshot.accountQuota
          ? [renderAccountQuotaSummary(snapshot.accountQuota, "cq")]
          : []),
        selectorPanel(
          "model_panel",
          "模型",
          readOnly
            ? "由会话操作者管理"
            : snapshot.modelCatalogAvailable
              ? "选择 Codex 模型"
              : "当前 Codex 未提供模型目录，保留已有配置",
          !catalogEditable
            ? readOnlyValue(
                "model_value",
                snapshot.selectedModel === "__default__"
                  ? `Codex 默认${selected ? ` · ${selected.displayName}` : ""}`
                  : selected?.displayName ?? snapshot.selectedModel,
              )
            : {
                tag: "select_static",
                element_id: "model_select",
                name: "model",
                width: "fill",
                initial_option: snapshot.selectedModel,
                options: models,
                behaviors: [callback("select_model")],
              },
        ),
        selectorPanel(
          "effort_panel",
          "推理强度",
          snapshot.modelCatalogAvailable
            ? effortDescription(selectedEffort)
            : "模型能力未知，沿用当前配置",
          !catalogEditable
            ? readOnlyValue("effort_value", reasoningEffortLabel(selectedEffort))
            : {
                tag: "select_static",
                element_id: "effort_select",
                name: "effort",
                width: "fill",
                initial_option: selectedEffort,
                options: efforts.map((effort) => ({
                  text: { tag: "plain_text", content: reasoningEffortLabel(effort) },
                  value: effort,
                })),
                behaviors: [callback("select_effort")],
              },
        ),
        selectorPanel(
          "access_panel",
          "默认任务权限",
          `${sandboxDescription(snapshot.selectedSandbox)}；长期设置最高为工作区写入`,
          readOnly
            ? readOnlyValue("access_value", sandboxLabel(snapshot.selectedSandbox))
            : {
                tag: "select_static",
                element_id: "access_select",
                name: "sandbox",
                width: "fill",
                initial_option: snapshot.selectedSandbox,
                options: snapshot.sandboxModes.map((mode) => ({
                  text: { tag: "plain_text", content: sandboxLabel(mode) },
                  value: mode,
                })),
                behaviors: [callback("select_sandbox")],
              },
        ),
        ...(snapshot.fullAccessMaximum
          ? [
              fullAccessPanel(
                readOnly,
                snapshot.fullAccessLeaseLabel,
                snapshot.fullAccessSessionAvailable === true,
              ),
            ]
          : []),
        actionGrid(
          "control_actions",
          [
            button("历史会话", "settings_sessions", "default"),
            button("任务中心", "settings_tasks", "default"),
            ...(readOnly ? [] : [button("新会话", "settings_new", "primary")]),
            button("刷新", "settings_refresh", "default"),
          ],
        ),
        {
          tag: "markdown",
          element_id: "control_safety",
          text_size: "notation",
          text_align: "center",
          content: readOnly
            ? "<font color='grey'>只读成员不能修改设置、创建会话或运行 Codex 任务。</font>"
            : "<font color='grey'>完全访问只通过临时租约启用；提交、推送、部署和 PR 始终需要单独确认。</font>",
        },
      ],
    },
  };
}

function fullAccessPanel(
  readOnly: boolean,
  activeLease: string | undefined,
  sessionAvailable: boolean,
): Record<string, unknown> {
  const elements: Record<string, unknown>[] = [
    {
      tag: "markdown",
      element_id: "full_access_title",
      content: `**临时完全访问**\n<font color='grey'>${activeLease ? `当前：${safe(activeLease)}；租约到期后自动回退` : "当前未启用；租约到期后自动回到默认任务权限"}</font>`,
    },
  ];
  if (!readOnly) {
    elements.push(
      actionGrid(
        "lease_grant_actions",
        [
          button("下一任务", "lease_full_once", "danger", {
            title: "授权下一任务完全访问？",
            text: "30 分钟内启动的下一项任务可执行本机命令，用完立即失效。",
          }),
          button("30 分钟", "lease_full_30m", "danger", {
            title: "授权 30 分钟完全访问？",
            text: "当前成员会话在 30 分钟内启动的任务都可使用完全访问。",
          }),
          ...(sessionAvailable
            ? [
                button("当前会话", "lease_full_session", "danger", {
                  title: "授权当前 Codex 会话？",
                  text: "仅绑定当前 thread，最长 60 分钟；切换或重置会话后立即失效。",
                }),
              ]
            : []),
        ],
      ),
    );
    if (activeLease) {
      elements.push(
        actionGrid("lease_revoke_actions", [
          button("立即撤销", "lease_full_revoke", "default", {
            title: "撤销临时完全访问？",
            text: "不会中断已启动任务，但后续任务立即回到默认权限。",
          }),
        ]),
      );
    }
  }
  return {
    tag: "column_set",
    element_id: "full_access_panel",
    flex_mode: "none",
    columns: [
      {
        tag: "column",
        width: "weighted",
        weight: 1,
        background_style: activeLease ? "orange-50" : "grey-50",
        padding: "12px 12px 12px 12px",
        vertical_spacing: "10px",
        elements,
      },
    ],
  };
}

function readOnlyValue(elementId: string, value: string): Record<string, unknown> {
  return {
    tag: "markdown",
    element_id: elementId,
    content: `**${safe(value)}**`,
  };
}

function selectorPanel(
  id: string,
  title: string,
  description: string,
  selector: Record<string, unknown>,
): Record<string, unknown> {
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
        padding: "12px 12px 12px 12px",
        vertical_spacing: "8px",
        elements: [
          {
            tag: "markdown",
            element_id: `${id}_title`,
            content: `**${title}**\n<font color='grey'>${safe(description)}</font>`,
          },
          selector,
        ],
      },
    ],
  };
}

function feedbackPanel(feedback: string): Record<string, unknown> {
  return {
    tag: "column_set",
    element_id: "control_feedback",
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
            element_id: "feedback_text",
            content: `<font color='green'>${safe(feedback)}</font>`,
          },
        ],
      },
    ],
  };
}

function modelOptions(models: CodexModel[], selectedModel: string): Array<Record<string, unknown>> {
  const defaultModel = models.find((model) => model.isDefault);
  const options: Array<Record<string, unknown> & { value: string }> = [
    {
      text: {
        tag: "plain_text",
        content: `Codex 默认${defaultModel ? ` · ${defaultModel.displayName}` : ""}`.slice(0, 80),
      },
      value: "__default__",
    },
    ...models.slice(0, 39).map((model) => ({
      text: {
        tag: "plain_text",
        content: `${model.displayName}${model.isDefault ? " · 固定" : ""}`.slice(0, 80),
      },
      value: model.model,
    })),
  ];
  if (!options.some((option) => option.value === selectedModel)) {
    options.unshift({
      text: { tag: "plain_text", content: `${selectedModel} · 当前配置` },
      value: selectedModel,
    });
  }
  return options;
}

function callback(action: string): Record<string, unknown> {
  return { type: "callback", value: { bridge: "feishu-codex-v5", action } };
}

function button(
  text: string,
  action: string,
  type: "default" | "primary" | "danger",
  confirm?: { title: string; text: string },
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    tag: "button",
    element_id: action.slice(0, 20),
    text: { tag: "plain_text", content: text },
    type: type === "primary" ? "primary_filled" : type === "danger" ? "danger_filled" : "default",
    width: "fill",
    behaviors: [callback(action)],
  };
  if (confirm) {
    result.confirm = {
      title: { tag: "plain_text", content: confirm.title },
      text: { tag: "plain_text", content: confirm.text },
    };
  }
  return result;
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

function uniqueEfforts(values: ReasoningEffort[]): ReasoningEffort[] {
  return [...new Set(values)];
}

export function reasoningEffortLabel(value: ReasoningEffort): string {
  return {
    minimal: "最低",
    low: "轻度",
    medium: "中",
    high: "高",
    xhigh: "极高",
    ultra: "最高",
  }[value];
}

function effortDescription(value: ReasoningEffort): string {
  return `当前 ${reasoningEffortLabel(value)}；强度越高通常耗时越长`;
}

function sandboxLabel(value: SandboxMode): string {
  if (value === "read-only") return "只读分析";
  if (value === "workspace-write") return "工作区写入";
  return "完全访问";
}

function sandboxDescription(value: SandboxMode): string {
  if (value === "read-only") return "只能读取和分析，不修改文件";
  if (value === "workspace-write") return "可修改当前项目，越界操作需要确认";
  return "可执行本机命令；高风险外部动作仍需二次确认";
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
    .replaceAll("`", "｀");
}
