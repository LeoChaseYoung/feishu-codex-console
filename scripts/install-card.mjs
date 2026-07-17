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
    modelLabel: "Codex 默认",
    sandboxLabel: options.sandboxLabel,
    deviceOnline: true,
    feedback: "安装成功，飞书、本地服务和 CardKit 已完成端到端验证。",
  });
  const cardId = await lark.createCard(card);
  await lark.replyCard(
    options.messageId,
    cardId,
    `install_${options.instanceId}_${options.messageId}`,
  );
  return { cardId };
}
