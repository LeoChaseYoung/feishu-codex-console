import type { SandboxMode } from "./types.js";

export type TaskMode = "answer" | "analyze" | "write" | "code";

const QUESTION_OPENING = /^(?:请问|问[:：]?|为什么|为何|什么是|是什么|怎么|如何|能否|能不能|是否|有没有|解释(?:一下)?|说明(?:一下)?|告诉我|帮我解释)/i;
const FOLLOWED_BY_MUTATION = /(?:[,，:：；;。]|并|然后|同时|顺便|接着).{0,16}(?:修复|修改|实现|开发|新增|添加|删除|重构|升级|接入|迁移|替换|改成|写入|优化|调整)/i;
const DOCUMENT_TARGET = /(?:文档|说明(?:书)?|报告|方案|总结|纪要|教程|指南|README|CHANGELOG|markdown|\.md\b)/i;
const DOCUMENT_ACTION = /(?:写|撰写|起草|生成|创建|整理|补充|更新|修改|完善|优化|润色|改写|翻译|输出)/i;
const GENERIC_WRITING = /(?:写(?:入|一个|一份)?(?:文件|内容)|保存为文件|落到文件)/i;
const CODE_MUTATION = /(?:修复|修改|改一下|改成|实现|开发|新增|添加|删除|移除|重构|升级|接入|迁移|替换|调整|优化|配置|部署|发布|编写.{0,12}(?:代码|脚本|组件|接口|测试)|补(?:齐|充)?.{0,8}(?:代码|测试)|运行.{0,8}(?:测试|lint|build|构建))/i;
const ANALYSIS_OPENING = /^(?:(?:请|请帮我|帮我)\s*)?(?:继续\s*)?(?:读取|阅读|查看|看看|看一下|分析|检查|审查|评审|诊断|定位|梳理|总结|评估|调研|研究|搜索|查找|找出|列出|统计|了解|解释这个项目)/i;
const ANALYSIS_PHRASE = /(?:原因是什么|有哪些问题|有没有问题|项目结构|代码结构|现状|差异|风险|可行性|给出建议)/i;
const ANSWER_PHRASE = /(?:只读回答|回答(?:一下)?|告诉我|给出(?:优化)?建议|解释(?:一下)?)/i;
const EXPLICIT_READ_ONLY = /(?:只读|仅查看|只看|只分析|仅分析|不修改|不改代码|不要|无需|不用|不需要|禁止|别).{0,24}(?:修改|改代码|写入|实现|修复|运行|执行|测试|构建|build|lint|文件|代码)?/i;
const NEGATED_MUTATION = /(?:不要|无需|不用|不需要|禁止|别)\s*(?:先\s*)?(?:(?:执行|运行)\s*)?(?:修复|修改|实现|开发|新增|添加|删除|移除|重构|升级|接入|迁移|替换|改成|写入|优化|调整|配置|部署|发布|测试|lint|build|构建)[^，,。；;\n]{0,24}/gi;
const SHORT_CONTEXTUAL_FOLLOW_UP = /^(?:继续(?:一下|吧|做|处理)?|接着(?:来|做|处理)?|往下(?:做|继续)?|再(?:来(?:一次|一版)?|试(?:一次|一下)?|看看)|重试(?:一次|一下)?|然后呢|下一步呢|还有(?:呢|吗)?|(?:那|这个|那个|上面那个|前面那个)(?:呢|怎么办|可以吗)?|(?:按|照)(?:这个|上面(?:的)?)(?:来|做|处理)?|就(?:这样|这么办|按这个来)|好(?:的)?|可以|行)[吧呢啊呀嘛的]*[。！!？?…]*$/i;
const CLASSIFICATION_LABEL = /^(?:验收测试|测试|需求|问题|备注)\s*[:：]\s*/i;
const EXPLICIT_CONTEXT_REFERENCE = /(?:你刚才|你上面|上面(?:说|提|那个)|前面(?:说|提|那个)|上一条|上一个回答|第[一二三四五六七八九十\d]+(?:点|条|个)|上述|基于刚才|按刚才)/i;

/**
 * Local presentation/safety routing only. Codex still receives the original
 * prompt unchanged, so a heuristic miss cannot alter the requested content.
 */
export function inferTaskMode(prompt: string, previousMode?: TaskMode): TaskMode {
  const normalized = prompt.trim().replace(/\s+/g, " ");
  if (!normalized) return previousMode ?? "analyze";
  const semantic = normalized.replace(CLASSIFICATION_LABEL, "");
  const actionable = normalized.replace(NEGATED_MUTATION, "");

  if (QUESTION_OPENING.test(semantic) && !FOLLOWED_BY_MUTATION.test(actionable)) {
    return "answer";
  }
  if (
    (DOCUMENT_TARGET.test(actionable) && DOCUMENT_ACTION.test(actionable)) ||
    GENERIC_WRITING.test(actionable)
  ) {
    return "write";
  }
  // Explicitly read-only requests fail closed even when they contain words
  // such as “优化” or “测试” that would otherwise look like mutation verbs.
  if (EXPLICIT_READ_ONLY.test(normalized)) {
    if (ANALYSIS_OPENING.test(semantic)) return "analyze";
    return QUESTION_OPENING.test(semantic) || ANSWER_PHRASE.test(semantic) || /[?？]\s*$/.test(semantic)
      ? "answer"
      : "analyze";
  }
  // “看看/分析有没有可以优化的地方” is a request for findings, not
  // authorization to modify the workspace. Only an explicit follow-up
  // mutation (“然后修复”) promotes an analysis opening into a write task.
  if (ANALYSIS_OPENING.test(semantic) && !FOLLOWED_BY_MUTATION.test(actionable)) {
    return "analyze";
  }
  if (CODE_MUTATION.test(actionable)) return "code";
  if (ANALYSIS_PHRASE.test(semantic)) return "analyze";
  // Elliptical follow-ups only have a reliable meaning inside their current
  // Codex thread. Reuse that turn's presentation/sandbox mode; if no such
  // context exists, fail closed to read-only analysis instead of guessing a
  // writable code task.
  if (isContextualFollowUp(normalized)) return previousMode ?? "analyze";
  if (/[?？]\s*$/.test(normalized)) return "answer";
  return "code";
}

export function isContextualFollowUp(prompt: string): boolean {
  return SHORT_CONTEXTUAL_FOLLOW_UP.test(prompt.trim().replace(/\s+/g, " "));
}

export function shouldClarifyContextualFollowUp(
  prompt: string,
  context: { hasThread: boolean; hasActiveTask: boolean; queuedTasks: number },
): boolean {
  return (
    isContextualFollowUp(prompt) &&
    !context.hasThread &&
    !context.hasActiveTask &&
    context.queuedTasks === 0
  );
}

export function shouldStartFreshAnswerThread(
  prompt: string,
  context: { hasThread: boolean; isReply: boolean },
): boolean {
  if (!context.hasThread || context.isReply) return false;
  const normalized = prompt.trim().replace(/\s+/g, " ");
  return (
    inferTaskMode(normalized) === "answer" &&
    !isContextualFollowUp(normalized) &&
    !EXPLICIT_CONTEXT_REFERENCE.test(normalized)
  );
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
