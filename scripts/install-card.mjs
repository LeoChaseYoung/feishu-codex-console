import path from "node:path";
import { pathToFileURL } from "node:url";

export async function sendInstallationCard(options) {
  const LarkCliClass = options.LarkCliClass ?? (await import(
    pathToFileURL(path.join(options.packageRoot, "dist", "lark-cli.js")).href
  )).LarkCli;
  const renderOnboardingCard = options.renderOnboardingCard ?? (await import(
    pathToFileURL(path.join(options.packageRoot, "dist", "onboarding-card.js")).href
  )).renderOnboardingCard;
  const lark = new LarkCliClass({
    binary: options.larkCliPath,
    cwd: options.packageRoot,
    maxReplyChars: 12_000,
  });
  const card = renderOnboardingCard({
    role: "admin",
    state: {
      ownerId: options.ownerId,
      status: "active",
      step: 1,
      updatedAt: new Date().toISOString(),
    },
    projectName: options.projectName,
    projectAvailable: Boolean(options.projectName),
    modelLabel: "Codex 默认",
    sandboxLabel: options.sandboxLabel,
    canWrite: !/只读/.test(options.sandboxLabel ?? ""),
    deviceOnline: true,
    groupChatEnabled: options.groupChatStatus === "ready",
    feedback: installFeedback(options.groupChatStatus),
  });
  const cardId = await lark.createCard(card);
  await lark.replyCard(
    options.messageId,
    cardId,
    `install_${options.instanceId}_${options.messageId}`,
  );
  return { cardId };
}

function installFeedback(groupChatStatus) {
  const suffix = groupChatStatus === "ready"
    ? "项目群权限也已验证。"
    : groupChatStatus === "missing"
      ? "私聊已可用；项目群仍有权限待补，创建时会显示具体修复项。"
      : "私聊已可用；项目群权限将在首次创建时逐步验证。";
  return `安装成功，飞书、本地服务和 CardKit 已完成端到端验证。${suffix}`;
}
