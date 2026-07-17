import { hasTaskValidation, type FeishuCard } from "./task-card.js";
import { taskModeLabel, taskModeOf } from "./task-intent.js";
import type { PersistedTaskState } from "./types.js";

export interface TaskCenterSnapshot {
  scopeLabel: string;
  tasks: PersistedTaskState[];
  running: number;
  queued: number;
  canOperate: boolean;
  people?: Record<string, { initiator: string; controller: string }>;
}

export function renderTaskCenterCard(snapshot: TaskCenterSnapshot): FeishuCard {
  return {
    schema: "2.0",
    config: {
      update_multi: true,
      width_mode: "default",
      enable_forward: false,
      summary: { content: `Codex 任务中心 · 运行 ${snapshot.running} · 排队 ${snapshot.queued}` },
    },
    header: {
      title: { tag: "plain_text", content: "Codex 任务中心" },
      subtitle: { tag: "plain_text", content: snapshot.scopeLabel },
      template: snapshot.running > 0 ? "blue" : "green",
      icon: { tag: "standard_icon", token: "tasklist_colorful" },
      text_tag_list: [
        { tag: "text_tag", text: { tag: "plain_text", content: `运行 ${snapshot.running}` }, color: "blue" },
        { tag: "text_tag", text: { tag: "plain_text", content: `排队 ${snapshot.queued}` }, color: "neutral" },
      ],
    },
    body: {
      direction: "vertical",
      padding: "12px 12px 18px 12px",
      vertical_spacing: "10px",
      elements: [
        ...(snapshot.tasks.length > 0
          ? snapshot.tasks
              .slice(0, 8)
              .map((task, index) =>
                taskRow(task, index, snapshot.canOperate, snapshot.people?.[task.id]),
              )
          : [
              {
                tag: "markdown",
                element_id: "tasks_empty",
                content: "**暂无任务**\n<font color='grey'>直接发送问题、分析要求、文档需求或代码任务即可开始。</font>",
              },
            ]),
        actionGrid(
          "task_actions",
          snapshot.canOperate
            ? [
                button("停止本会话", "tasks_stop", "danger", undefined, {
                  title: "停止本会话任务？",
                  text: "当前会话的运行和排队任务都会停止，已写入文件的修改不会撤销。",
                }),
                button("本会话重置", "tasks_new", "primary"),
                button("控制中心", "tasks_settings", "default"),
                button("刷新", "tasks_refresh", "default"),
              ]
            : [
                button("控制中心", "tasks_settings", "default"),
                button("刷新", "tasks_refresh", "default"),
              ],
        ),
      ],
    },
  };
}

function taskRow(
  task: PersistedTaskState,
  index: number,
  canOperate: boolean,
  people?: { initiator: string; controller: string },
): Record<string, unknown> {
  const final = task.progress.finalResponse || task.progress.error || task.progress.activity;
  const active = task.status === "running" || task.status === "queued";
  return {
    tag: "column_set",
    element_id: `task_row_${index}`,
    flex_mode: "none",
    columns: [
      {
        tag: "column",
        width: "weighted",
        weight: 1,
        background_style: task.status === "running" ? "blue-50" : "grey-50",
        padding: "10px 12px 10px 12px",
        vertical_spacing: "4px",
        elements: [
          {
            tag: "markdown",
            element_id: `task_title_${index}`,
            content: `**${safe(task.prompt).slice(0, 90)}**  ${statusTag(task.status)}  <text_tag color='turquoise'>${taskModeLabel(taskModeOf(task.progress))}</text_tag>\n<font color='grey'>#${safe(task.id).slice(0, 12)} · ${safe(task.project.name)} · ${relativeTime(task.updatedAt)}</font>${people ? `\n<font color='grey'>发起 ${safe(people.initiator)} · 控制 ${safe(people.controller)}</font>` : ""}\n${safe(final).slice(0, 160)}`,
          },
        ],
      },
      ...(active && canOperate
        ? [
            {
              tag: "column",
              width: "auto",
              vertical_align: "center",
              elements: [
                button("停止", "tasks_cancel_one", "danger", task.id, {
                  title: "停止这个任务？",
                  text: "已写入文件的修改不会自动撤销。",
                }, `task_cancel_${index}`),
              ],
            },
          ]
        : !active && hasTaskValidation(task.progress)
          ? [
              {
                tag: "column",
                width: "auto",
                vertical_align: "center",
                elements: [
                  button(
                    "审阅",
                    "tasks_review",
                    "primary",
                    task.id,
                    undefined,
                    `task_review_${index}`,
                  ),
                ],
              },
            ]
          : []),
    ],
  };
}

function button(
  text: string,
  action: string,
  type: "default" | "primary" | "danger",
  taskId?: string,
  confirm?: { title: string; text: string },
  elementId = action.slice(0, 20),
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    tag: "button",
    element_id: elementId,
    text: { tag: "plain_text", content: text },
    type: type === "danger" ? "danger_filled" : type === "primary" ? "primary_filled" : "default",
    width: "fill",
    behaviors: [
      {
        type: "callback",
        value: {
          bridge: "feishu-codex-v5",
          action,
          ...(taskId ? { task_id: taskId } : {}),
        },
      },
    ],
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

function statusTag(status: PersistedTaskState["status"]): string {
  if (status === "running") return "<text_tag color='blue'>运行中</text_tag>";
  if (status === "queued") return "<text_tag color='neutral'>排队中</text_tag>";
  if (status === "succeeded") return "<text_tag color='green'>已完成</text_tag>";
  if (status === "failed") return "<text_tag color='red'>失败</text_tag>";
  if (status === "interrupted") return "<text_tag color='neutral'>已中断</text_tag>";
  return "<text_tag color='neutral'>已停止</text_tag>";
}

function relativeTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "未知时间";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1_000));
  if (seconds < 60) return "刚刚";
  if (seconds < 3_600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)} 小时前`;
  return `${Math.floor(seconds / 86_400)} 天前`;
}

function safe(value: string): string {
  return value.replaceAll("<", "＜").replaceAll(">", "＞").replaceAll("*", "＊").replaceAll("`", "｀");
}
