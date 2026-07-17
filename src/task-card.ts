import {
  effectiveTestRuns,
  testEvidenceState,
  type TaskPhase,
  type TaskProgress,
} from "./progress.js";
import { taskFailurePresentation } from "./task-failure.js";
import { prepareRemoteMarkdown, redactSensitiveText } from "./redaction.js";
import {
  taskModeCapturesReview,
  taskModeExpectsTests,
  taskModeLabel,
  taskModeOf,
  type TaskMode,
} from "./task-intent.js";

export type FeishuCard = Record<string, unknown>;

const CARD_TEXT_LIMIT = 12_000;
const RESULT_SUMMARY_LIMIT = 1_800;

interface PhaseStyle {
  template: "blue" | "green" | "red" | "grey";
  tagColor: "blue" | "green" | "red" | "neutral";
  background: string;
  label: string;
  title: string;
}

const PHASE_STYLE: Record<TaskPhase, PhaseStyle> = {
  queued: {
    template: "grey",
    tagColor: "blue",
    background: "grey-50",
    label: "排队中",
    title: "Codex 等待开始",
  },
  running: {
    template: "blue",
    tagColor: "blue",
    background: "blue-50",
    label: "运行中",
    title: "Codex 正在工作",
  },
  succeeded: {
    template: "green",
    tagColor: "green",
    background: "grey-50",
    label: "已完成",
    title: "Codex 已完成",
  },
  failed: {
    template: "red",
    tagColor: "red",
    background: "red-50",
    label: "执行失败",
    title: "Codex 执行失败",
  },
  cancelled: {
    template: "grey",
    tagColor: "neutral",
    background: "grey-50",
    label: "已停止",
    title: "Codex 已停止",
  },
  interrupted: {
    template: "grey",
    tagColor: "neutral",
    background: "grey-50",
    label: "已中断",
    title: "Codex 任务已中断",
  },
};

export function renderTaskCard(progress: TaskProgress, now = Date.now()): FeishuCard {
  const baseStyle = PHASE_STYLE[progress.phase];
  const mode = taskModeOf(progress);
  const modeStyle = {
    ...baseStyle,
    title: taskPhaseTitle(progress.phase, mode),
  };
  const style =
    progress.phase === "succeeded" && testEvidenceState(progress.commandRuns) === "failed"
      ? {
          ...modeStyle,
          template: "red" as const,
          tagColor: "red" as const,
          background: "red-50",
          label: "测试未通过",
          title: "Codex 已完成，测试未通过",
        }
      : modeStyle;
  const executionBlock: Record<string, unknown> = {
      tag: "column_set",
      element_id: "execution_block",
      flex_mode: "none",
      columns: [
        {
          tag: "column",
          width: "weighted",
          weight: 1,
          background_style: style.background,
          padding: "12px 12px 12px 12px",
          vertical_spacing: "4px",
          elements: [
            {
              tag: "markdown",
              element_id: "stream_text",
              content: renderStreamContent(progress),
            },
          ],
        },
      ],
    };
  const active = progress.phase === "queued" || progress.phase === "running";
  const elements: Record<string, unknown>[] = active
    ? [
        metadataRow(progress, now),
        executionContext(progress),
        ...(progress.initiatorLabel && progress.controllerLabel
          ? [collaborationPanel(progress)]
          : []),
        executionBlock,
      ]
    : [executionBlock, metadataRow(progress, now), executionContext(progress)];

  if (progress.actionNote) {
    elements.push({
      tag: "column_set",
      element_id: "action_note_panel",
      flex_mode: "none",
      columns: [
        {
          tag: "column",
          width: "weighted",
          weight: 1,
          background_style: "blue-50",
          padding: "10px 12px 10px 12px",
          elements: [
            {
              tag: "markdown",
              element_id: "action_note",
              text_size: "notation",
              content: `<font color='blue'>${safeUserText(progress.actionNote)}</font>`,
            },
          ],
        },
      ],
    });
  }

  elements.push(actionButtons(progress));
  elements.push({
    tag: "markdown",
    element_id: "safety_note",
    text_size: "notation",
    text_align: "center",
    content: `<font color='grey'>${followUpHint(progress, active)} · ${safeUserText(progress.permissionLabel)} · 提交、推送、部署和 PR 仍需确认</font>`,
  });

  return {
    schema: "2.0",
    config: {
      update_multi: true,
      width_mode: "default",
      enable_forward: false,
      streaming_mode: true,
      summary: { content: `${style.title} · ${progress.projectLabel}` },
      style: {
        text_size: {
          caption: { default: "notation", pc: "notation", mobile: "notation" },
        },
        color: {
          "bridge-muted": {
            light_mode: "rgba(100,106,115,1)",
            dark_mode: "rgba(150,155,163,1)",
          },
        },
      },
    },
    header: {
      title: { tag: "plain_text", content: style.title },
      subtitle: {
        tag: "plain_text",
        content: truncatePlain(redactSensitiveText(progress.prompt).replace(/\s+/g, " "), 72),
      },
      template: style.template,
      icon: { tag: "standard_icon", token: "myai_colorful" },
      text_tag_list: [
        {
          tag: "text_tag",
          text: { tag: "plain_text", content: style.label },
          color: style.tagColor,
        },
        {
          tag: "text_tag",
          text: { tag: "plain_text", content: taskModeLabel(mode) },
          color: "turquoise",
        },
        {
          tag: "text_tag",
          text: { tag: "plain_text", content: `#${truncatePlain(progress.taskId, 12)}` },
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

export function renderStreamContent(progress: TaskProgress): string {
  if (progress.phase === "succeeded") {
    const response = progress.finalResponse || progress.partialResponse;
    return [
      `**${resultSectionTitle(taskModeOf(progress))}**`,
      safeUserText(
        summarizeResponse(response || "任务已完成，但没有返回文字说明。"),
      ),
      renderTestLine(progress),
      renderReviewLine(progress),
      renderChangedFileLine(progress),
    ]
      .filter(Boolean)
      .join("\n\n");
  }
  if (progress.phase === "failed") {
    const error = progress.error || "未知错误";
    const presentation = taskFailurePresentation(error);
    return [
      `**${presentation.title}**`,
      `<font color='grey'>原因</font>  ${safeUserText(truncate(error, CARD_TEXT_LIMIT))}`,
      `**下一步**  ${safeUserText(presentation.nextAction)}`,
      renderTestLine(progress),
      renderReviewLine(progress),
      renderChangedFileLine(progress),
    ]
      .filter(Boolean)
      .join("\n\n");
  }
  if (progress.phase === "cancelled") {
    return [
      "**任务已停止**",
      safeUserText(truncate(progress.error || "已收到停止请求", CARD_TEXT_LIMIT)),
      progress.changedFiles.length > 0
        ? `已写入磁盘的 ${progress.changedFiles.length} 个文件变更已保留，不会自动撤销。`
        : "停止前没有记录到文件变更。",
      renderChangedFileLine(progress),
    ]
      .filter(Boolean)
      .join("\n\n");
  }
  if (progress.phase === "interrupted") {
    return [
      "**服务中断了这个任务**",
      safeUserText(truncate(progress.error || "桥接服务在任务运行期间停止", CARD_TEXT_LIMIT)),
      "为避免重复修改，任务没有自动重跑。请先查看文件变更，再决定是否重新执行。",
      renderChangedFileLine(progress),
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  const lines = progress.logs.length > 0 ? progress.logs : [progress.activity];
  const timeline = lines.map((line, index) => {
    const isCurrent = index === lines.length - 1;
    const state = isCurrent ? "进行中" : "已完成";
    const color = isCurrent ? "blue" : "grey";
    return `<font color='${color}'>${state}</font>  ${safeUserText(line)}`;
  });
  if (progress.partialResponse) {
    timeline.push(
      `<font color='blue'>回复中</font>  ${safeUserText(truncate(progress.partialResponse, 2_400))}`,
    );
  }
  const changed = renderChangedFileLine(progress);
  if (changed) timeline.push(changed);
  return [`**${activitySectionTitle(taskModeOf(progress))}**`, ...timeline].join("\n\n");
}

export function renderChangedFiles(progress: TaskProgress): string {
  if (progress.changedFiles.length === 0) return "这个任务尚未产生可见的文件变更。";
  const labels = { add: "新增", update: "修改", delete: "删除" } as const;
  return [
    `任务 ${progress.taskId} 的文件变更（${progress.changedFiles.length}）`,
    "",
    ...progress.changedFiles.map(
      (change) => `- ${labels[change.kind]}：${safeUserText(change.path)}`,
    ),
  ].join("\n");
}

function metadataRow(progress: TaskProgress, now: number): Record<string, unknown> {
  const elapsedFrom = progress.startedAt ?? progress.createdAt;
  const elapsedTo = progress.finishedAt ?? now;
  const elapsed = formatDuration(Math.max(0, elapsedTo - elapsedFrom));
  const uncachedInput = progress.usage ? newInputTokens(progress.usage) : 0;
  const value = progress.usage
    ? `${formatNumber(uncachedInput)} / ${formatNumber(progress.usage.cached_input_tokens)}`
    : progress.phase === "queued"
      ? `队列第 ${progress.queuePosition} 位`
      : elapsed;
  const label = progress.usage
    ? "新增 / 缓存"
    : progress.phase === "queued"
      ? "本会话队列"
      : "耗时";

  return {
    tag: "column_set",
    element_id: "task_metadata",
    flex_mode: "none",
    horizontal_spacing: "8px",
    columns: [
      metadataColumn("项目", progress.projectLabel, "left"),
      metadataColumn("权限", progress.permissionLabel, "center"),
      metadataColumn(label, value, "right"),
    ],
  };
}

function executionContext(progress: TaskProgress): Record<string, unknown> {
  const model = progress.modelLabel || "Codex 默认";
  const reasoning = progress.reasoningLabel || "默认推理";
  const session = progress.threadId
    ? `会话 #${progress.threadId.slice(0, 8)}`
    : progress.sessionLabel || "新会话";
  const steered = progress.steerCount ? ` · 已追加 ${progress.steerCount} 条` : "";
  const source = progress.runbookLabel
    ? `\n<font color='grey'>来源</font>  团队运行手册 · ${safeUserText(progress.runbookLabel)}`
    : "";
  const usage = progress.usage
    ? `\n<font color='grey'>用量</font>  累计输入 ${formatNumber(progress.usage.input_tokens)}（新增 ${formatNumber(newInputTokens(progress.usage))} · 缓存 ${formatNumber(progress.usage.cached_input_tokens)}） · 输出 ${formatNumber(progress.usage.output_tokens)}${progress.usage.model_calls ? ` · ${progress.usage.model_calls} 次模型调用` : ""}`
    : "";
  const task = ` · 任务 #${progress.taskId.slice(0, 8)}`;
  return {
    tag: "markdown",
    element_id: "execution_context",
    text_size: "notation",
    content: `<font color='grey'>模型</font>  ${safeUserText(model)} · ${safeUserText(reasoning)}\n<font color='grey'>上下文</font>  ${safeUserText(session)}${steered}${task}${source}${usage}`,
  };
}

function collaborationPanel(progress: TaskProgress): Record<string, unknown> {
  const active = progress.phase === "queued" || progress.phase === "running";
  const options = (progress.handoffOptions ?? []).slice(0, 50);
  const controls: Record<string, unknown>[] = [];
  if (active && progress.teamMode && options.length > 1) {
    controls.push({
      tag: "select_static",
      element_id: "task_handoff_select",
      name: "task_controller",
      width: "fill",
      ...(progress.controllerSelector
        ? { initial_option: progress.controllerSelector }
        : { placeholder: { tag: "plain_text", content: "选择新的任务控制者" } }),
      options: options.map((option) => ({
        text: { tag: "plain_text", content: truncatePlain(option.label, 60) },
        value: option.value,
      })),
      confirm: {
        title: { tag: "plain_text", content: "确认转交任务？" },
        text: {
          tag: "plain_text",
          content: "新的控制者可以停止任务和处理运行时确认；发起人与执行权限不会改变。",
        },
      },
      behaviors: [
        {
          type: "callback",
          value: {
            bridge: "feishu-codex-v3",
            action: "handoff",
            task_id: progress.taskId,
          },
        },
      ],
    });
    controls.push({
      tag: "button",
      element_id: "task_takeover_btn",
      text: { tag: "plain_text", content: "接管任务" },
      type: "default",
      width: "fill",
      confirm: {
        title: { tag: "plain_text", content: "接管这个任务？" },
        text: {
          tag: "plain_text",
          content: "仅任务发起人和团队管理员可以接管，操作会写入审计日志。",
        },
      },
      behaviors: [
        {
          type: "callback",
          value: {
            bridge: "feishu-codex-v3",
            action: "takeover",
            task_id: progress.taskId,
          },
        },
      ],
    });
  }
  return {
    tag: "column_set",
    element_id: "task_collaboration",
    flex_mode: "none",
    columns: [
      {
        tag: "column",
        width: "weighted",
        weight: 1,
        background_style: "grey-50",
        padding: "10px 12px 10px 12px",
        vertical_spacing: "8px",
        elements: [
          {
            tag: "markdown",
            element_id: "task_collab_summary",
            text_size: "notation",
            content:
              `<font color='grey'>发起人</font>  ${safeUserText(progress.initiatorLabel ?? "未知成员")}` +
              `\n<font color='grey'>当前控制者</font>  **${safeUserText(progress.controllerLabel ?? "未知成员")}**`,
          },
          ...controls,
        ],
      },
    ],
  };
}

function metadataColumn(
  label: string,
  value: string,
  align: "left" | "center" | "right",
): Record<string, unknown> {
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
        text_align: align,
        text_size: "notation",
        content: `<font color='grey'>${label}</font>`,
      },
      {
        tag: "markdown",
        text_align: align,
        content: `**${safeUserText(truncatePlain(value, 40))}**`,
      },
    ],
  };
}

function actionButtons(progress: TaskProgress): Record<string, unknown> {
  const active = progress.phase === "queued" || progress.phase === "running";
  const mode = taskModeOf(progress);
  const terminalActions: Record<string, unknown>[] = [];
  if (!active) {
    if (hasLongTaskResult(progress)) {
      terminalActions.push(
        buttonColumn("result_btn", "完整结果", "primary_filled", progress.taskId, "result"),
      );
    }
    if (hasTaskValidation(progress)) {
      terminalActions.push(
        buttonColumn(
          "review_btn",
          "查看验证",
          terminalActions.length === 0 ? "primary_filled" : "default",
          progress.taskId,
          "review",
        ),
      );
    }
    const retry = retryPresentation(mode);
    terminalActions.push(
      buttonColumn("retry_btn", retry.label, "default", progress.taskId, "retry", {
        title: retry.title,
        text: retry.detail,
      }),
    );
    if (terminalActions.length < 3) {
      terminalActions.push(
        buttonColumn("new_btn", "新会话", "default", progress.taskId, "new", {
          title: "开启新会话？",
          text: "当前聊天保存的 Codex 上下文会被清除。",
        }),
      );
    }
  }
  return {
    tag: "column_set",
    element_id: "task_actions",
    flex_mode: "none",
    horizontal_spacing: "8px",
    columns: active
      ? progress.phase === "running"
        ? [
            ...(taskModeCapturesReview(mode)
              ? [buttonColumn("review_btn", mode === "write" ? "查看文件" : "实时审阅", "primary_filled", progress.taskId, "review")]
              : []),
            buttonColumn("cancel_btn", "停止", taskModeCapturesReview(mode) ? "default" : "primary_filled", progress.taskId, "cancel", {
              title: `停止这次${taskModeLabel(mode)}？`,
              text: taskModeCapturesReview(mode)
                ? "已完成的文件修改不会自动撤销。"
                : "当前回答会停止，已生成的文字仍会保留。",
            }),
          ]
        : [
            buttonColumn("cancel_btn", "取消排队", "default", progress.taskId, "cancel", {
              title: "取消这个排队任务？",
              text: "任务尚未开始，不会产生新的文件修改。",
            }),
          ]
      : terminalActions,
  };
}

function buttonColumn(
  elementId: string,
  label: string,
  type: string,
  taskId: string,
  action: "cancel" | "retry" | "new" | "changes" | "review" | "result",
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
        value: { bridge: "feishu-codex-v3", action, task_id: taskId },
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

function renderChangedFileLine(progress: TaskProgress): string {
  if (progress.changedFiles.length === 0) return "";
  const visible = progress.changedFiles.slice(-3).map((change) => change.path);
  const extra =
    progress.changedFiles.length > visible.length
      ? ` 等 ${progress.changedFiles.length} 个文件`
      : "";
  return `<font color='grey'>文件变更</font>  ${safeUserText(visible.join("、"))}${extra}`;
}

function renderTestLine(progress: TaskProgress): string {
  const tests = effectiveTestRuns(progress.commandRuns);
  if (tests.length === 0) {
    return taskModeExpectsTests(taskModeOf(progress))
      ? "<font color='grey'>测试</font>  未检测到测试命令"
      : "";
  }
  const failed = tests.filter((run) => run.status === "failed").length;
  const running = tests.filter((run) => run.status === "running").length;
  const passed = tests.filter((run) => run.status === "passed").length;
  const result = failed > 0
    ? `${failed} 次失败 · ${passed} 次通过`
    : running > 0
      ? `${running} 次运行中 · ${passed} 次通过`
      : `${passed} 次通过`;
  return `<font color='grey'>测试</font>  ${result}`;
}

function renderReviewLine(progress: TaskProgress): string {
  if (!progress.review) return "";
  if (progress.review.availability === "no_changes") {
    return "";
  }
  if (progress.review.availability === "unavailable") {
    return `<font color='grey'>${taskModeOf(progress) === "write" ? "文件审阅" : "代码审阅"}</font>  基线不可用，请回本机确认`;
  }
  const attribution =
    progress.review.attribution === "task"
      ? "任务基线清晰"
      : progress.review.attribution === "mixed"
        ? "含任务前已有修改"
        : "归因待确认";
  return `<font color='grey'>${taskModeOf(progress) === "write" ? "文件审阅" : "代码审阅"}</font>  ${progress.review.totalFiles} 个文件 · +${progress.review.totalAdditions} / -${progress.review.totalDeletions} · ${attribution}`;
}

export function hasLongTaskResult(progress: TaskProgress): boolean {
  if (progress.phase !== "succeeded") return false;
  return (progress.finalResponse || progress.partialResponse).trim().length > RESULT_SUMMARY_LIMIT;
}

export function hasTaskValidation(progress: TaskProgress): boolean {
  const hasReview =
    progress.review?.availability === "ready" && progress.review.totalFiles > 0;
  return hasReview || testEvidenceState(progress.commandRuns) !== "missing";
}

function summarizeResponse(value: string): string {
  const normalized = truncate(value.trim(), CARD_TEXT_LIMIT);
  if (normalized.length <= RESULT_SUMMARY_LIMIT) return normalized;
  const candidate = normalized.slice(0, RESULT_SUMMARY_LIMIT - 90);
  const paragraphBreak = candidate.lastIndexOf("\n\n");
  const lineBreak = candidate.lastIndexOf("\n");
  const cutAt = Math.max(paragraphBreak, lineBreak, RESULT_SUMMARY_LIMIT - 420);
  return `${candidate.slice(0, cutAt).trimEnd()}\n\n<font color='grey'>内容较长，点击“完整结果”查看全部。</font>`;
}

function safeUserText(value: string): string {
  return prepareRemoteMarkdown(value)
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
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1_000);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes < 60) return `${minutes}分${remainder}秒`;
  return `${Math.floor(minutes / 60)}时${minutes % 60}分`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function newInputTokens(usage: NonNullable<TaskProgress["usage"]>): number {
  return Math.max(0, usage.input_tokens - usage.cached_input_tokens);
}

function taskPhaseTitle(phase: TaskPhase, mode: TaskMode): string {
  if (phase === "queued") {
    return { answer: "回答等待开始", analyze: "分析等待开始", write: "内容等待生成", code: "Codex 等待开始" }[mode];
  }
  if (phase === "running") {
    return { answer: "Codex 正在回答", analyze: "Codex 正在分析", write: "Codex 正在生成内容", code: "Codex 正在执行" }[mode];
  }
  if (phase === "succeeded") {
    return { answer: "回答已完成", analyze: "分析已完成", write: "内容已生成", code: "Codex 已完成" }[mode];
  }
  return PHASE_STYLE[phase].title;
}

function resultSectionTitle(mode: TaskMode): string {
  return { answer: "回答", analyze: "分析结论", write: "交付内容", code: "结果摘要" }[mode];
}

function activitySectionTitle(mode: TaskMode): string {
  return { answer: "回答进度", analyze: "分析进度", write: "生成进度", code: "执行动态" }[mode];
}

function retryPresentation(mode: TaskMode): { label: string; title: string; detail: string } {
  return {
    answer: {
      label: "再次回答",
      title: "再次回答这个问题？",
      detail: "会在同一项目中重新处理原问题。",
    },
    analyze: {
      label: "重新分析",
      title: "重新分析这个问题？",
      detail: "会重新读取当前项目，但不会主动修改文件。",
    },
    write: {
      label: "再次生成",
      title: "再次生成这些内容？",
      detail: "可能会再次写入或覆盖任务涉及的文件。",
    },
    code: {
      label: "重新执行",
      title: "重新执行这个任务？",
      detail: "可能会重复产生代码修改。",
    },
  }[mode];
}

function followUpHint(progress: TaskProgress, active: boolean): string {
  if (!active) return "直接回复可继续当前会话";
  const mode = taskModeOf(progress);
  return mode === "answer"
    ? "直接发送补充问题可加入当前回答"
    : mode === "analyze"
      ? "直接发送补充要求可加入当前分析"
      : "直接发送补充要求可追加到当前任务";
}
