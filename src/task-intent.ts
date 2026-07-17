import type { SandboxMode } from "./types.js";

export type TaskMode = "answer" | "analyze" | "write" | "code";

const QUESTION_OPENING = /^(?:请问|问[:：]?|为什么|为何|什么是|是什么|怎么|如何|能否|能不能|是否|有没有|解释(?:一下)?|说明(?:一下)?|告诉我|帮我解释)/i;
const FOLLOWED_BY_MUTATION = /(?:[,，:：；;。]|并|然后|同时|顺便|接着).{0,16}(?:修复|修改|实现|开发|新增|添加|删除|重构|升级|接入|迁移|替换|改成|写入|优化|调整)/i;
const DOCUMENT_TARGET = /(?:文档|说明(?:书)?|报告|方案|总结|纪要|教程|指南|README|CHANGELOG|markdown|\.md\b)/i;
const DOCUMENT_ACTION = /(?:写|撰写|起草|生成|创建|整理|补充|更新|修改|完善|优化|润色|改写|翻译|输出)/i;
const GENERIC_WRITING = /(?:写(?:入|一个|一份)?(?:文件|内容)|保存为文件|落到文件)/i;
const CODE_MUTATION = /(?:修复|修改|改一下|改成|实现|开发|新增|添加|删除|移除|重构|升级|接入|迁移|替换|调整|优化|配置|部署|发布|编写.{0,12}(?:代码|脚本|组件|接口|测试)|补(?:齐|充)?.{0,8}(?:代码|测试)|运行.{0,8}(?:测试|lint|build|构建))/i;
const ANALYSIS_OPENING = /^(?:读取|阅读|查看|看看|看一下|分析|检查|审查|评审|诊断|定位|梳理|总结|评估|调研|研究|搜索|查找|找出|列出|统计|了解|解释这个项目)/i;
const ANALYSIS_PHRASE = /(?:原因是什么|有哪些问题|有没有问题|项目结构|代码结构|现状|差异|风险|可行性|给出建议)/i;

/**
 * Local presentation/safety routing only. Codex still receives the original
 * prompt unchanged, so a heuristic miss cannot alter the requested content.
 */
export function inferTaskMode(prompt: string): TaskMode {
  const normalized = prompt.trim().replace(/\s+/g, " ");
  if (!normalized) return "code";

  if (QUESTION_OPENING.test(normalized) && !FOLLOWED_BY_MUTATION.test(normalized)) {
    return "answer";
  }
  if (
    (DOCUMENT_TARGET.test(normalized) && DOCUMENT_ACTION.test(normalized)) ||
    GENERIC_WRITING.test(normalized)
  ) {
    return "write";
  }
  // “看看/分析有没有可以优化的地方” is a request for findings, not
  // authorization to modify the workspace. Only an explicit follow-up
  // mutation (“然后修复”) promotes an analysis opening into a write task.
  if (ANALYSIS_OPENING.test(normalized) && !FOLLOWED_BY_MUTATION.test(normalized)) {
    return "analyze";
  }
  if (CODE_MUTATION.test(normalized)) return "code";
  if (ANALYSIS_PHRASE.test(normalized)) return "analyze";
  if (/[?？]\s*$/.test(normalized)) return "answer";
  return "code";
}

export function taskModeOf(value: { taskMode?: TaskMode; prompt: string }): TaskMode {
  return value.taskMode ?? inferTaskMode(value.prompt);
}

export function taskModeLabel(mode: TaskMode): string {
  return {
    answer: "问答",
    analyze: "分析",
    write: "内容",
    code: "代码",
  }[mode];
}

export function taskModeAllowsWrites(mode: TaskMode): boolean {
  return mode === "write" || mode === "code";
}

export function taskModeCapturesReview(mode: TaskMode): boolean {
  return taskModeAllowsWrites(mode);
}

export function taskModeExpectsTests(mode: TaskMode): boolean {
  return mode === "code";
}

export function sandboxForTaskMode(mode: TaskMode, requested: SandboxMode): SandboxMode {
  return taskModeAllowsWrites(mode) ? requested : "read-only";
}

export function runningActivity(mode: TaskMode): string {
  return {
    answer: "Codex 正在回答",
    analyze: "Codex 正在分析",
    write: "Codex 正在生成内容",
    code: "Codex 正在执行任务",
  }[mode];
}

export function completedActivity(mode: TaskMode): string {
  return {
    answer: "回答完成",
    analyze: "分析完成",
    write: "内容已生成",
    code: "任务完成",
  }[mode];
}
