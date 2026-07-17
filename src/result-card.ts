import {
  effectiveTestRuns,
  testEvidenceState,
  type TaskProgress,
} from "./progress.js";
import { prepareRemoteMarkdown, redactSensitiveText } from "./redaction.js";
import type { FeishuCard } from "./task-card.js";
import { taskModeLabel, taskModeOf } from "./task-intent.js";

const RESULT_DETAIL_LIMIT = 10_000;

export function renderTaskResultCard(progress: TaskProgress): FeishuCard {
  const mode = taskModeOf(progress);
  const response = progress.finalResponse || progress.partialResponse || "任务已完成，但没有返回文字说明。";
  const tests = effectiveTestRuns(progress.commandRuns);
  const testState = testEvidenceState(tests);
  const testLabel =
    testState === "passed"
      ? `${tests.length} 项通过`
      : testState === "failed"
        ? "存在失败"
        : testState === "running"
          ? "仍在运行"
          : "未运行";
  const changed = progress.review?.availability === "ready"
    ? progress.review.totalFiles
    : progress.changedFiles.length;
  const failed = testState === "failed";

  return {
    schema: "2.0",
    config: {
      update_multi: true,
      width_mode: "default",
      enable_forward: false,
      summary: { content: `完整结果 · ${safePlain(progress.projectLabel)}` },
    },
    header: {
      title: {
        tag: "plain_text",
        content: mode === "answer"
          ? "Codex 回答"
          : mode === "analyze"
            ? "分析结果"
            : mode === "write"
              ? "交付内容"
              : "Codex 完整结果",
      },
      subtitle: {
        tag: "plain_text",
        content: truncatePlain(redactSensitiveText(progress.prompt).replace(/\s+/g, " "), 72),
      },
      template: failed ? "red" : "green",
      icon: { tag: "standard_icon", token: "myai_colorful" },
      text_tag_list: [
        {
          tag: "text_tag",
          text: { tag: "plain_text", content: failed ? "测试未通过" : taskModeLabel(mode) },
          color: failed ? "red" : "green",
        },
        {
          tag: "text_tag",
          text: { tag: "plain_text", content: `#${truncatePlain(progress.taskId, 16)}` },
          color: "neutral",
        },
      ],
    },
    body: {
      direction: "vertical",
      padding: "12px 12px 18px 12px",
      vertical_spacing: "12px",
      elements: [
        {
          tag: "column_set",
          element_id: "result_panel",
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
                  element_id: "result_content",
                  content: safe(truncate(response, RESULT_DETAIL_LIMIT)),
                },
              ],
            },
          ],
        },
        {
          tag: "markdown",
          element_id: "result_evidence",
          text_size: "notation",
          content: resultEvidence(progress, testLabel, changed),
        },
        {
          tag: "column_set",
          element_id: "result_actions",
          flex_mode: "none",
          columns: [
            {
              tag: "column",
              width: "weighted",
              weight: 1,
              elements: [
                {
                  tag: "button",
                  element_id: "result_back_btn",
                  text: { tag: "plain_text", content: "返回结果摘要" },
                  type: "default",
                  width: "fill",
                  behaviors: [
                    {
                      type: "callback",
                      value: {
                        bridge: "feishu-codex-v3",
                        action: "result_back",
                        task_id: progress.taskId,
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          tag: "markdown",
          element_id: "result_footer",
          text_size: "notation",
          text_align: "center",
          content: "<font color='grey'>直接回复可继续当前会话；本地文件路径不会生成远端无效链接。</font>",
        },
      ],
    },
  };
}

function resultEvidence(progress: TaskProgress, testLabel: string, changed: number): string {
  const mode = taskModeOf(progress);
  if (mode === "answer") {
    return `<font color='grey'>上下文</font>  ${safePlain(progress.projectLabel)} · 当前 Codex 会话`;
  }
  if (mode === "analyze") {
    return `<font color='grey'>分析方式</font>  只读 · ${changed > 0 ? `发现 ${changed} 个文件变化` : "未修改文件"}`;
  }
  if (mode === "write") {
    const test = testLabel === "未运行" ? "" : ` · 检查 ${testLabel}`;
    return `<font color='grey'>交付</font>  文件 ${changed} 个${test}`;
  }
  return `<font color='grey'>验证</font>  测试 ${testLabel} · 文件 ${changed} 个`;
}

function safe(value: string): string {
  return prepareRemoteMarkdown(value)
    .replaceAll("<at", "＜at")
    .replaceAll("</at>", "＜/at＞")
    .replaceAll("<person", "＜person")
    .replaceAll("</person>", "＜/person＞");
}

function safePlain(value: string): string {
  return redactSensitiveText(value).replace(/\s+/g, " ").trim();
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 32))}\n\n[内容已截断，请在本机查看完整输出]`;
}

function truncatePlain(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}
