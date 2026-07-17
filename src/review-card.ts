import {
  effectiveTestRuns,
  testEvidenceState,
  type TaskCommandRun,
  type TaskPhase,
} from "./progress.js";
import type { FeishuCard } from "./task-card.js";
import type { TaskFileDiff, TaskReviewSnapshot } from "./task-review.js";

export interface ReviewCardSnapshot {
  taskId: string;
  projectLabel: string;
  prompt: string;
  phase: TaskPhase;
  review: TaskReviewSnapshot;
  commandRuns: TaskCommandRun[];
  page: number;
  pageSize: number;
  selectedFileIndex?: number;
  fileDiff?: TaskFileDiff;
  diffPage?: number;
  diffPageSize?: number;
  feedback?: string;
  embedded?: boolean;
}

export function renderReviewCard(snapshot: ReviewCardSnapshot): FeishuCard {
  const tests = effectiveTestRuns(snapshot.commandRuns);
  const testState = summarizeTests(tests);
  const body = snapshot.fileDiff
    ? renderDiffBody(snapshot)
    : renderOverviewBody(snapshot, tests, testState);
  return {
    schema: "2.0",
    config: {
      update_multi: true,
      width_mode: "default",
      enable_forward: false,
      summary: { content: `任务验证 · ${safePlain(snapshot.projectLabel)}` },
    },
    header: {
      title: { tag: "plain_text", content: "Codex 任务验证" },
      subtitle: {
        tag: "plain_text",
        content: truncatePlain(snapshot.prompt.replace(/\s+/g, " "), 72),
      },
      template:
        testState.state === "failed"
          ? "red"
          : snapshot.review.attribution === "mixed" || snapshot.review.attribution === "unknown"
            ? "orange"
            : "green",
      icon: { tag: "standard_icon", token: "tasklist_colorful" },
      text_tag_list: [
        {
          tag: "text_tag",
          text: { tag: "plain_text", content: reviewStatusLabel(snapshot.review) },
          color: snapshot.review.availability === "ready" ? "green" : "neutral",
        },
        {
          tag: "text_tag",
          text: { tag: "plain_text", content: testState.label },
          color: testState.state === "passed" ? "green" : testState.state === "failed" ? "red" : "neutral",
        },
        {
          tag: "text_tag",
          text: { tag: "plain_text", content: `#${snapshot.taskId.slice(0, 12)}` },
          color: "neutral",
        },
      ],
    },
    body: {
      direction: "vertical",
      padding: "12px 12px 18px 12px",
      vertical_spacing: "12px",
      elements: body,
    },
  };
}

function renderOverviewBody(
  snapshot: ReviewCardSnapshot,
  tests: TaskCommandRun[],
  testState: ReturnType<typeof summarizeTests>,
): Record<string, unknown>[] {
  const review = snapshot.review;
  const start = snapshot.page * snapshot.pageSize;
  const pageFiles = review.files.slice(start, start + snapshot.pageSize);
  const pageCount = Math.max(1, Math.ceil(review.files.length / snapshot.pageSize));
  if (review.availability === "no_changes" && tests.length === 0) {
    return [
      ...(snapshot.feedback ? [feedbackPanel(snapshot.feedback)] : []),
      {
        tag: "column_set",
        element_id: "review_empty",
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
                  "**这次任务没有可验证的代码结果**\n<font color='grey'>未发现文件变更，也没有运行测试；结果属于分析或说明，无需进入代码审阅。</font>",
              },
            ],
          },
        ],
      },
      overviewActions(snapshot.taskId, 0, false, false, snapshot.embedded ?? false),
    ];
  }
  const elements: Record<string, unknown>[] = [
    metadataRow(review, testState.label),
    reviewConfidencePanel(review),
  ];
  if (snapshot.feedback) elements.push(feedbackPanel(snapshot.feedback));
  elements.push(testPanel(tests));

  if (review.availability === "ready" && pageFiles.length > 0) {
    elements.push({
      tag: "markdown",
      element_id: "files_heading",
      content: `**文件变更**  <font color='grey'>第 ${snapshot.page + 1} / ${pageCount} 页</font>`,
    });
    pageFiles.forEach((file, index) => {
      elements.push(fileRow(snapshot.taskId, file, start + index, index));
    });
  } else {
    elements.push({
      tag: "column_set",
      element_id: "review_empty",
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
                review.availability === "no_changes"
                  ? "**未发现代码变更**\n<font color='grey'>任务可能只完成了分析，或修改已经提交且基线不可用。</font>"
                  : `**暂时无法生成 Diff**\n<font color='grey'>${safe(review.error ?? "请回到本机确认工作区状态。")}</font>`,
            },
          ],
        },
      ],
    });
  }

  elements.push(
    overviewActions(
      snapshot.taskId,
      snapshot.page,
      snapshot.page > 0,
      start + pageFiles.length < review.files.length,
      snapshot.embedded ?? false,
    ),
  );
  elements.push({
    tag: "markdown",
    element_id: "review_footer",
    text_size: "notation",
    text_align: "center",
    content:
      "<font color='grey'>审阅是只读操作；直接发送补充要求可继续修改。提交、推送、部署和 PR 仍需单独确认。</font>",
  });
  return elements;
}

function renderDiffBody(snapshot: ReviewCardSnapshot): Record<string, unknown>[] {
  const diff = snapshot.fileDiff!;
  const pageSize = snapshot.diffPageSize ?? 7_000;
  const pageCount = Math.max(1, Math.ceil(diff.content.length / pageSize));
  const diffPage = Math.min(Math.max(0, snapshot.diffPage ?? 0), pageCount - 1);
  const visibleContent = diff.content.slice(diffPage * pageSize, (diffPage + 1) * pageSize);
  const selected =
    snapshot.selectedFileIndex === undefined
      ? undefined
      : snapshot.review.files[snapshot.selectedFileIndex];
  const warnings = [
    ...(selected?.attribution === "mixed"
      ? ["这个文件在任务开始前已有修改，下面是合并后的工作区 Diff。"]
      : []),
    ...(diff.stale ? ["文件在任务完成后又发生了变化，下面显示的是当前工作区内容。"] : []),
    ...(diff.sensitive ? ["敏感路径已隐藏正文。"] : []),
    ...(diff.truncated ? ["Diff 超过安全预览总量，最后一页会标记截断。"] : []),
  ];
  return [
    ...(snapshot.feedback ? [feedbackPanel(snapshot.feedback)] : []),
    {
      tag: "markdown",
      element_id: "diff_heading",
      content: `**${safe(diff.path)}**  <font color='grey'>Diff 第 ${diffPage + 1} / ${pageCount} 页</font>\n<font color='grey'>${warnings.length > 0 ? warnings.map(safe).join(" ") : "任务完成时的只读差异快照"}</font>`,
    },
    {
      tag: "column_set",
      element_id: "diff_panel",
      flex_mode: "none",
      columns: [
        {
          tag: "column",
          width: "weighted",
          weight: 1,
          background_style: diff.error || diff.sensitive ? "orange-50" : "grey-50",
          padding: "12px 12px 12px 12px",
          elements: [
            {
              tag: "markdown",
              element_id: "diff_content",
              content: `\`\`\`diff\n${safeCode(visibleContent)}\n\`\`\``,
            },
          ],
        },
      ],
    },
    diffActions(
      snapshot.taskId,
      snapshot.page,
      snapshot.selectedFileIndex ?? 0,
      diffPage,
      pageCount,
      snapshot.embedded ?? false,
    ),
  ];
}

function metadataRow(
  review: TaskReviewSnapshot,
  testLabel: string,
): Record<string, unknown> {
  return {
    tag: "column_set",
    element_id: "review_metadata",
    flex_mode: "none",
    horizontal_spacing: "8px",
    columns: [
      metric("文件", String(review.totalFiles), "left"),
      metric("新增 / 删除", `+${review.totalAdditions} / -${review.totalDeletions}`, "center"),
      metric("测试", testLabel, "right"),
    ],
  };
}

function metric(label: string, value: string, align: string): Record<string, unknown> {
  return {
    tag: "column",
    width: "weighted",
    weight: 1,
    background_style: "grey-50",
    padding: "8px 4px 8px 4px",
    elements: [
      {
        tag: "markdown",
        text_align: align,
        text_size: "notation",
        content: `<font color='grey'>${label}</font>\n**${safe(value)}**`,
      },
    ],
  };
}

function reviewConfidencePanel(review: TaskReviewSnapshot): Record<string, unknown> {
  const mixed = review.attribution !== "task";
  const detail =
    review.attribution === "task"
      ? "任务开始时已建立 Git 基线；列表排除了未被本任务触碰的既有修改。"
      : review.attribution === "mixed"
        ? "部分文件在任务开始前已经修改，Diff 可能同时包含你的原有内容；请逐文件确认。"
        : "任务基线不可用，文件列表主要来自 Codex 事件，不能保证完整归因。";
  const excluded = review.preexistingFilesExcluded > 0
    ? ` 已排除 ${review.preexistingFilesExcluded} 个未变化的既有脏文件。`
    : "";
  return {
    tag: "column_set",
    element_id: "confidence_panel",
    flex_mode: "none",
    columns: [
      {
        tag: "column",
        width: "weighted",
        weight: 1,
        background_style: mixed ? "orange-50" : "green-50",
        padding: "10px 12px 10px 12px",
        elements: [
          {
            tag: "markdown",
            content: `**${mixed ? "需要人工确认归因" : "任务基线清晰"}**\n${safe(detail + excluded)}`,
          },
        ],
      },
    ],
  };
}

function testPanel(tests: TaskCommandRun[]): Record<string, unknown> {
  const visible = tests.slice(-5);
  const lines =
    visible.length === 0
      ? ["<font color='grey'>未检测到测试命令。任务完成不等于测试通过。</font>"]
      : visible.map((run) => {
          const status = run.status === "passed" ? "通过" : run.status === "failed" ? "失败" : "运行中";
          const color = run.status === "passed" ? "green" : run.status === "failed" ? "red" : "blue";
          const output = run.status === "failed" && run.outputSummary
            ? `\n<font color='grey'>${safe(truncatePlain(run.outputSummary, 500))}</font>`
            : "";
          return `<font color='${color}'>${status}</font>  ${safe(truncatePlain(run.command, 140))}${run.exitCode === undefined ? "" : ` · 退出码 ${run.exitCode}`}${output}`;
        });
  return {
    tag: "column_set",
    element_id: "test_panel",
    flex_mode: "none",
    columns: [
      {
        tag: "column",
        width: "weighted",
        weight: 1,
        background_style: "grey-50",
        padding: "10px 12px 10px 12px",
        vertical_spacing: "4px",
        elements: [
          { tag: "markdown", content: ["**测试证据**", ...lines].join("\n\n") },
        ],
      },
    ],
  };
}

function fileRow(
  taskId: string,
  file: TaskReviewSnapshot["files"][number],
  absoluteIndex: number,
  rowIndex: number,
): Record<string, unknown> {
  const stats = file.binary
    ? "二进制"
    : file.additions === null || file.deletions === null
      ? "行数未知"
      : `+${file.additions} / -${file.deletions}`;
  const kind = file.kind === "add" ? "新增" : file.kind === "delete" ? "删除" : "修改";
  const flags = [
    file.attribution === "mixed" ? "含既有修改" : "任务变更",
    file.sensitive ? "内容受保护" : "",
  ].filter(Boolean).join(" · ");
  return {
    tag: "column_set",
    element_id: `review_file_${rowIndex}`,
    flex_mode: "none",
    columns: [
      {
        tag: "column",
        width: "weighted",
        weight: 1,
        background_style: file.attribution === "mixed" ? "orange-50" : "grey-50",
        padding: "9px 10px 9px 10px",
        elements: [
          {
            tag: "markdown",
            content: `**${safe(file.path)}**\n<font color='grey'>${kind} · ${stats} · ${flags}</font>`,
          },
        ],
      },
      {
        tag: "column",
        width: "auto",
        vertical_align: "center",
        elements: [
          actionButton(
            `file_open_${rowIndex}`,
            file.sensitive ? "说明" : "查看 Diff",
            "review_file",
            taskId,
            { file_index: absoluteIndex },
          ),
        ],
      },
    ],
  };
}

function overviewActions(
  taskId: string,
  page: number,
  hasPrevious: boolean,
  hasNext: boolean,
  embedded: boolean,
): Record<string, unknown> {
  const actions: Record<string, unknown>[] = [];
  if (hasPrevious) {
    actions.push(actionButton("review_prev", "上一页", "review_page", taskId, { page: page - 1 }));
  }
  if (hasNext) {
    actions.push(actionButton("review_next", "下一页", "review_page", taskId, { page: page + 1 }));
  }
  actions.push(actionButton("review_refresh", "刷新快照", "review_refresh", taskId));
  if (embedded) {
    actions.push(actionButton("review_close", "返回结果", "review_close", taskId));
  }
  return actionGrid("review_actions", actions);
}

function diffActions(
  taskId: string,
  page: number,
  fileIndex: number,
  diffPage: number,
  pageCount: number,
  embedded: boolean,
): Record<string, unknown> {
  const actions: Record<string, unknown>[] = [
    actionButton("review_back", "返回列表", "review_back", taskId, { page }),
  ];
  if (diffPage > 0) {
    actions.push(
      actionButton("diff_prev", "上一页", "review_diff_page", taskId, {
        page,
        file_index: fileIndex,
        diff_page: diffPage - 1,
      }),
    );
  }
  if (diffPage + 1 < pageCount) {
    actions.push(
      actionButton("diff_next", "下一页", "review_diff_page", taskId, {
        page,
        file_index: fileIndex,
        diff_page: diffPage + 1,
      }),
    );
  }
  if (pageCount === 1) {
    actions.push(
      actionButton("diff_refresh", "刷新 Diff", "review_refresh", taskId, {
        page,
        file_index: fileIndex,
        diff_page: diffPage,
      }),
    );
  }
  if (embedded) {
    actions.push(actionButton("review_close", "返回结果", "review_close", taskId));
  }
  return actionGrid("diff_actions", actions);
}

function actionButton(
  elementId: string,
  label: string,
  action:
    | "review_page"
    | "review_file"
    | "review_refresh"
    | "review_back"
    | "review_diff_page"
    | "review_close",
  taskId: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    tag: "button",
    element_id: elementId,
    text: { tag: "plain_text", content: label },
    type: action === "review_file" ? "primary_filled" : "default",
    width: "fill",
    behaviors: [
      {
        type: "callback",
        value: {
          bridge: "feishu-codex-v6",
          action,
          task_id: taskId,
          ...extra,
        },
      },
    ],
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

function feedbackPanel(feedback: string): Record<string, unknown> {
  return {
    tag: "column_set",
    element_id: "review_feedback",
    flex_mode: "none",
    columns: [
      {
        tag: "column",
        width: "weighted",
        weight: 1,
        background_style: "blue-50",
        padding: "9px 11px 9px 11px",
        elements: [{ tag: "markdown", content: `<font color='blue'>${safe(feedback)}</font>` }],
      },
    ],
  };
}

function summarizeTests(tests: TaskCommandRun[]): {
  state: "passed" | "failed" | "running" | "missing";
  label: string;
} {
  const state = testEvidenceState(tests);
  if (state === "missing") return { state, label: "未运行测试" };
  if (state === "failed") {
    return { state, label: `${tests.filter((run) => run.status === "failed").length} 次测试失败` };
  }
  if (state === "running") {
    return { state, label: `${tests.filter((run) => run.status === "running").length} 次测试运行中` };
  }
  return { state, label: `${tests.length} 次测试通过` };
}

function reviewStatusLabel(review: TaskReviewSnapshot): string {
  if (review.availability === "no_changes") return "无代码变更";
  if (review.availability === "unavailable") return "审阅不可用";
  return `${review.totalFiles} 个文件`;
}

function safe(value: string): string {
  return value
    .replaceAll("&", "＆")
    .replaceAll("<", "＜")
    .replaceAll(">", "＞")
    .replaceAll("*", "＊")
    .replaceAll("`", "｀")
    .replaceAll("_", "＿");
}

function safeCode(value: string): string {
  return value
    .replaceAll("<at", "＜at")
    .replaceAll("</at>", "＜/at＞")
    .replaceAll("```", "｀｀｀");
}

function safePlain(value: string): string {
  return value.replace(/[\r\n]/g, " ").slice(0, 80);
}

function truncatePlain(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}
