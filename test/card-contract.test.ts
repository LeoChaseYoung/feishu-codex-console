import { describe, expect, it } from "vitest";

import { renderExternalConfirmationCard } from "../src/confirmation-card.js";
import {
  reasoningEffortLabel,
  renderControlCenterCard,
} from "../src/control-card.js";
import type { CodexApprovalRequest, CodexQuestion } from "../src/codex-events.js";
import {
  renderDeviceCard,
  type DeviceConsoleSnapshot,
} from "../src/device-card.js";
import { renderPrivateHomeCard } from "../src/home-card.js";
import { renderOnboardingCard } from "../src/onboarding-card.js";
import { createTaskProgress, noteTask, startTask, succeedTask } from "../src/progress.js";
import { renderProjectCard } from "../src/project-card.js";
import type { CodexProject } from "../src/project-registry.js";
import { renderReviewCard } from "../src/review-card.js";
import { renderResponseCard } from "../src/response-card.js";
import { renderTaskResultCard } from "../src/result-card.js";
import { renderRunbookCenterCard } from "../src/runbook-card.js";
import { parseRunbookCatalog } from "../src/runbooks.js";
import {
  renderRuntimeApprovalCard,
  renderRuntimeQuestionCard,
} from "../src/runtime-card.js";
import { renderSessionCenterCard } from "../src/session-card.js";
import { renderTaskCard, type FeishuCard } from "../src/task-card.js";
import { renderTaskCenterCard } from "../src/task-center-card.js";
import { renderTeamDashboardCard } from "../src/team-card.js";

const ELEMENT_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,19}$/;

describe("Codex reasoning effort labels", () => {
  it("matches the labels used by the Codex interface", () => {
    expect([
      reasoningEffortLabel("low"),
      reasoningEffortLabel("medium"),
      reasoningEffortLabel("high"),
      reasoningEffortLabel("xhigh"),
      reasoningEffortLabel("ultra"),
    ]).toEqual(["轻度", "中", "高", "极高", "最高"]);
  });
});

function collectElementIds(value: unknown, result: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectElementIds(item, result);
    return result;
  }
  if (typeof value !== "object" || value === null) return result;
  for (const [key, child] of Object.entries(value)) {
    if (key === "element_id") result.push(String(child));
    collectElementIds(child, result);
  }
  return result;
}

const project: CodexProject = {
  name: "feishu-codex-bridge",
  path: "/Users/demo/work/feishu-codex-bridge",
  displayPath: "~/work/feishu-codex-bridge",
  isGitRepository: true,
  source: "codex",
};

const device: DeviceConsoleSnapshot = {
  deviceName: "Developer MacBook Pro",
  osLabel: "macOS 25.0 · arm64",
  uptimeLabel: "12 分钟",
  availability: {
    state: "online",
    title: "可以开始任务",
    detail: "飞书消息、卡片和 Codex 引擎均已连接。",
    nextAction: "直接发送完整任务，或先切换项目与模型。",
    canExecute: true,
    canInteract: true,
    sampledAt: "2026-07-16T12:00:00.000Z",
    lastSuccessfulTaskAt: "2026-07-16T11:00:00.000Z",
  },
  project,
  codex: { state: "online", pid: 42, restartCount: 1 },
  listener: { ready: true, restartCount: 0 },
  remoteReady: { supported: true, enabled: true, active: true },
  powerLabel: "外接电源 · 92%",
  activeTask: "task1234",
  queuedForConversation: 1,
  activeTasks: 1,
  queuedTasks: 2,
  maxConcurrentTasks: 2,
  threadCount: 4,
  sandboxLabel: "完全访问",
  networkEnabled: true,
  feedback: "远程就绪已开启。",
};

const approval: CodexApprovalRequest = {
  id: "approval-1",
  kind: "command",
  threadId: "thread-1",
  turnId: "turn-1",
  itemId: "item-1",
  title: "Codex 请求执行命令",
  detail: "npm test",
  cwd: project.path,
};

const quickQuestion: CodexQuestion = {
  id: "question-1",
  header: "实现方式",
  question: "你希望采用哪一种？",
  options: [
    { label: "方案 A", description: "改动更小" },
    { label: "方案 B", description: "能力更完整" },
  ],
  isOther: true,
  isSecret: false,
};

function cardFixtures(): Array<[string, FeishuCard]> {
  const running = noteTask(
    startTask(
      createTaskProgress(
        "task1234",
        "检查并修复测试",
        1,
        project.name,
        1_000,
        "工作区写入",
        {
          initiatorLabel: "Alice",
          controllerLabel: "Bob",
          controllerSelector: "member-bob",
          teamMode: true,
          handoffOptions: [
            { label: "Alice · 操作者", value: "member-alice" },
            { label: "Bob · 操作者", value: "member-bob" },
          ],
        },
      ),
      2_000,
    ),
    "已收到继续执行请求。",
  );
  const completed = succeedTask(running, "测试已经通过。", null, "thread-1", 3_000);
  const task = {
    id: "task1234",
    conversationKey: "oc-1",
    ownerId: "ou-1",
    controllerId: "ou-1",
    prompt: "检查并修复测试",
    replyToMessageId: "om-1",
    seed: "evt-1",
    project,
    status: "succeeded" as const,
    progress: completed,
    cardSequence: 0,
    attachments: [],
    allowedExternalActions: [],
    settings: { sandboxMode: "workspace-write" as const },
    createdAt: "2026-07-16T00:00:00Z",
    updatedAt: "2026-07-16T00:01:00Z",
  };

  return [
    [
      "private-home",
      renderPrivateHomeCard({
        deviceName: "Developer MacBook Pro",
        availability: device.availability,
        project: { name: project.name, isGitRepository: true },
        role: "operator",
        modelLabel: "gpt-5.4",
        sandboxLabel: "工作区写入",
        hasSession: true,
        queuedTasks: 0,
        canOperate: true,
        onboardingStatus: "completed",
      }),
    ],
    [
      "onboarding-active",
      renderOnboardingCard({
        role: "operator",
        state: {
          ownerId: "ou-1",
          status: "active",
          step: 2,
          updatedAt: "2026-07-16T00:00:00Z",
        },
        projectName: project.name,
        projectAvailable: true,
        modelLabel: "gpt-5.4",
        sandboxLabel: "工作区写入",
        canWrite: true,
        deviceOnline: true,
        groupChatEnabled: true,
        feedback: "工作区已确认。",
      }),
    ],
    [
      "onboarding-completed",
      renderOnboardingCard({
        role: "viewer",
        state: {
          ownerId: "ou-viewer",
          status: "completed",
          step: 4,
          updatedAt: "2026-07-16T00:01:00Z",
        },
        projectName: project.name,
        projectAvailable: true,
        modelLabel: "Codex 默认",
        sandboxLabel: "只读",
        canWrite: false,
        deviceOnline: true,
        groupChatEnabled: true,
      }),
    ],
    ["device", renderDeviceCard(device)],
    ["project", renderProjectCard([project], project, "已切换项目")],
    [
      "control",
      renderControlCenterCard({
        projectName: project.name,
        role: "admin",
        models: [
          {
            id: "gpt-5.4",
            model: "gpt-5.4",
            displayName: "GPT-5.4",
            description: "Latest model",
            isDefault: true,
            supportedReasoningEfforts: ["low", "medium", "high"],
            defaultReasoningEffort: "medium",
          },
        ],
        selectedModel: "gpt-5.4",
        selectedEffort: "high",
        selectedSandbox: "workspace-write",
        sandboxModes: ["read-only", "workspace-write"],
        modelCatalogAvailable: true,
        fullAccessMaximum: true,
        fullAccessLeaseLabel: "下一任务 · 30 分钟内有效",
        fullAccessSessionAvailable: true,
        feedback: "设置已保存",
      }),
    ],
    [
      "sessions",
      renderSessionCenterCard({
        projectName: project.name,
        currentThreadId: "thread-1",
        sessions: [
          {
            id: "thread-1",
            name: "V5 升级",
            preview: "继续完善飞书控制 Codex",
            cwd: project.path,
            createdAt: 1_000,
            updatedAt: 2_000,
            status: "idle",
          },
        ],
      }),
    ],
    [
      "task-center",
      renderTaskCenterCard({
        scopeLabel: project.name,
        tasks: [task],
        running: 0,
        queued: 0,
        canOperate: true,
      }),
    ],
    ["task-running", renderTaskCard(running, 2_500)],
    ["task-completed", renderTaskCard(completed, 3_000)],
    ["task-result", renderTaskResultCard(completed)],
    ["response-info", renderResponseCard("可以继续发送任务。", "help")],
    ["response-success", renderResponseCard("已创建新会话。", "session-created")],
    ["response-warning", renderResponseCard("队列已满，请稍后重试。", "task-queue-full")],
    ["response-error", renderResponseCard("任务执行失败。", "task-failed")],
    ["response-neutral", renderResponseCard("任务已取消。", "task-cancelled")],
    [
      "team-dashboard",
      renderTeamDashboardCard({
        scopeLabel: "工程团队",
        periodLabel: "最近 7 天",
        members: [
          {
            label: "前端同学",
            role: "operator",
            tasks: 3,
            active: 1,
            controlled: 1,
            succeeded: 2,
            failed: 0,
            inputTokens: 1_000,
            outputTokens: 200,
          },
        ],
        projects: [{ label: project.name, tasks: 3, active: 1, members: 1 }],
        activeTasks: 1,
        queuedTasks: 0,
        completedTasks: 2,
        successRate: 1,
        inputTokens: 1_000,
        outputTokens: 200,
        canAdminister: true,
      }),
    ],
    [
      "runbook-center",
      renderRunbookCenterCard({
        projectName: project.name,
        canOperate: true,
        catalog: {
          file: `${project.path}/.feishu-codex-runbooks.json`,
          status: "ready",
          runbooks: parseRunbookCatalog(
            JSON.stringify({
              version: 1,
              runbooks: [{ id: "verify", name: "验证项目", prompt: "运行测试并修复问题" }],
            }),
          ),
        },
      }),
    ],
    [
      "task-review",
      renderReviewCard({
        taskId: "task1234",
        projectLabel: project.name,
        prompt: "检查并修复测试",
        phase: "succeeded",
        review: {
          capturedAt: "2026-07-16T00:02:00Z",
          availability: "ready",
          attribution: "task",
          files: [
            {
              path: "src/index.ts",
              kind: "update",
              additions: 4,
              deletions: 1,
              binary: false,
              sensitive: false,
              attribution: "task",
              fingerprint: "file:20:1",
            },
          ],
          totalFiles: 1,
          totalAdditions: 4,
          totalDeletions: 1,
          binaryFiles: 0,
          preexistingFilesExcluded: 0,
          truncated: false,
        },
        commandRuns: [],
        page: 0,
        pageSize: 5,
      }),
    ],
    ["external-confirmation", renderExternalConfirmationCard("confirm-1", "提交项目", project.name, ["commit"])],
    ["external-confirmation-result", renderExternalConfirmationCard("confirm-1", "提交项目", project.name, ["commit"], "approved")],
    ["runtime-approval", renderRuntimeApprovalCard("request-1", approval, project.name)],
    ["runtime-approval-result", renderRuntimeApprovalCard("request-1", approval, project.name, "accepted")],
    ["runtime-question-buttons", renderRuntimeQuestionCard("request-q1", quickQuestion, { index: 1, total: 1 })],
    [
      "runtime-question-select",
      renderRuntimeQuestionCard(
        "request-q2",
        {
          ...quickQuestion,
          id: "question-2",
          options: [
            { label: "A" },
            { label: "B" },
            { label: "C" },
            { label: "D" },
          ],
        },
        { index: 1, total: 1 },
      ),
    ],
    ["runtime-question-result", renderRuntimeQuestionCard("request-q1", quickQuestion, { index: 1, total: 1 }, "answered", "方案 A")],
  ];
}

describe("Feishu CardKit contracts", () => {
  it("keeps every element ID unique and within the CardKit 20-character limit", () => {
    for (const [name, card] of cardFixtures()) {
      const ids = collectElementIds(card);
      expect(ids.length, `${name} should expose element IDs`).toBeGreaterThan(0);
      expect(new Set(ids).size, `${name} should not repeat element IDs`).toBe(ids.length);
      for (const id of ids) {
        expect(id, `${name} has an invalid element ID`).toMatch(ELEMENT_ID_PATTERN);
      }
    }
  });
});
