import type {
  AccountQuotaLimit,
  AccountQuotaSnapshot,
  AccountQuotaWindow,
} from "./account-quota.js";

export interface AccountQuotaSummaryAction {
  bridge: "feishu-codex-v4" | "feishu-codex-v5";
  action: string;
}

export function renderAccountQuotaSummary(
  snapshot: AccountQuotaSnapshot,
  prefix: "dq" | "cq",
  detailsAction?: AccountQuotaSummaryAction,
): Record<string, unknown> {
  const elements: Record<string, unknown>[] = [];
  if (snapshot.status === "unavailable") {
    elements.push(
      markdown(`${prefix}_sum_title`, "**账户额度**  <text_tag color='neutral'>暂不可用</text_tag>"),
      markdown(`${prefix}_sum_body`, `<font color='grey'>${safe(snapshot.message)}</font>`, "notation"),
    );
  } else {
    const visible = snapshot.limits.slice(0, 3);
    const plan = visible.map((limit) => limit.planType).find(Boolean);
    const summary = visible.map((limit) => {
      const window = limit.primary ?? limit.secondary;
      return window
        ? `**${safe(shortLimitName(limit))} ${percent(window.remainingPercent)}**`
        : `**${safe(shortLimitName(limit))} 暂无数据**`;
    }).join("  ·  ");
    const nearestReset = visible
      .flatMap((limit) => [limit.primary, limit.secondary])
      .filter((window): window is AccountQuotaWindow => Boolean(window?.resetsAt))
      .sort((left, right) => Date.parse(left.resetsAt ?? "") - Date.parse(right.resetsAt ?? ""))[0];
    const note = [
      nearestReset?.resetsAt ? `最近 ${formatResetTime(nearestReset.resetsAt)} 重置` : "",
      snapshot.resetCredits > 0 ? `${snapshot.resetCredits} 次可用重置` : "",
    ].filter(Boolean).join(" · ");
    elements.push(
      markdown(
        `${prefix}_sum_title`,
        `**账户额度**${plan ? `  <text_tag color='neutral'>${safe(planLabel(plan))}</text_tag>` : ""}`,
      ),
      markdown(`${prefix}_sum_body`, summary || "<font color='grey'>暂未返回额度窗口</font>"),
      ...(note
        ? [markdown(`${prefix}_sum_note`, `<font color='grey'>${safe(note)}</font>`, "notation")]
        : []),
    );
  }
  if (detailsAction) {
    elements.push({
      tag: "button",
      element_id: `${prefix}_quota_more`,
      text: { tag: "plain_text", content: "查看额度详情" },
      type: "default",
      width: "fill",
      behaviors: [
        {
          type: "callback",
          value: detailsAction,
        },
      ],
    });
  }
  return panel(`${prefix}_sum`, "grey-50", elements);
}

export function renderAccountQuotaPanel(
  snapshot: AccountQuotaSnapshot,
  prefix: "dq" | "cq" | "qq",
): Record<string, unknown> {
  if (snapshot.status === "unavailable") {
    return panel(prefix, "grey-50", [
      markdown(`${prefix}_title`, "**账户额度**  <text_tag color='neutral'>暂不可用</text_tag>"),
      markdown(
        `${prefix}_body`,
        `<font color='grey'>${safe(snapshot.message)}\n采样 ${safe(formatSampleTime(snapshot.sampledAt))}</font>`,
        "notation",
      ),
    ]);
  }

  const visible = snapshot.limits.slice(0, 4);
  const remaining = visible.flatMap((limit) =>
    [limit.primary, limit.secondary]
      .filter((window): window is AccountQuotaWindow => Boolean(window))
      .map((window) => window.remainingPercent),
  );
  const minimumRemaining = remaining.length > 0 ? Math.min(...remaining) : 100;
  const reached = visible.some((limit) => Boolean(limit.reachedType));
  const tone = reached || minimumRemaining <= 10
    ? { background: "red-50", color: "red" }
    : minimumRemaining <= 25
      ? { background: "orange-50", color: "orange" }
      : { background: "blue-50", color: "blue" };
  const plan = visible.map((limit) => limit.planType).find(Boolean);
  const body = visible.length > 0
    ? visible.map(renderLimit).join("\n\n")
    : "<font color='grey'>当前账户没有返回可展示的额度窗口。</font>";
  const footer = [
    snapshot.resetCredits > 0 ? `可用重置次数 ${snapshot.resetCredits}` : "",
    `采样 ${formatSampleTime(snapshot.sampledAt)}`,
  ].filter(Boolean).join(" · ");

  return panel(prefix, tone.background, [
    markdown(
      `${prefix}_title`,
      `**<font color='${tone.color}'>账户额度</font>**${plan ? `  <text_tag color='neutral'>${safe(planLabel(plan))}</text_tag>` : ""}`,
    ),
    markdown(`${prefix}_body`, body),
    markdown(`${prefix}_foot`, `<font color='grey'>${safe(footer)}</font>`, "notation"),
  ]);
}

export function formatAccountQuotaText(snapshot: AccountQuotaSnapshot): string[] {
  if (snapshot.status === "unavailable") return [`- 账户额度：${snapshot.message}`];
  const lines = snapshot.limits.flatMap((limit) => {
    const windows = [limit.primary, limit.secondary]
      .filter((window): window is AccountQuotaWindow => Boolean(window))
      .map((window) => `${windowLabel(window)}剩余 ${percent(window.remainingPercent)}${resetLabel(window)}`);
    return [`- ${limit.name}：${windows.join("；") || "未返回额度窗口"}`];
  });
  if (snapshot.resetCredits > 0) lines.push(`- 可用额度重置次数：${snapshot.resetCredits}`);
  return lines;
}

function renderLimit(limit: AccountQuotaLimit): string {
  const windows = [limit.primary, limit.secondary]
    .filter((window): window is AccountQuotaWindow => Boolean(window))
    .map((window) => renderWindow(window));
  const details = [
    ...windows,
    creditsLabel(limit),
    spendLimitLabel(limit),
    reachedLabel(limit.reachedType),
  ].filter(Boolean);
  return `**${safe(limit.name)}**${limit.id === "codex" ? "" : "  <text_tag color='neutral'>独立额度</text_tag>"}\n${details.join("\n") || "<font color='grey'>暂未返回额度窗口</font>"}`;
}

function shortLimitName(limit: AccountQuotaLimit): string {
  if (limit.id === "codex") return "Codex";
  if (/spark/i.test(limit.name)) return "Spark";
  return limit.name.length > 18 ? `${limit.name.slice(0, 17)}…` : limit.name;
}

function renderWindow(window: AccountQuotaWindow): string {
  const color = window.remainingPercent <= 10 ? "red" : window.remainingPercent <= 25 ? "orange" : "green";
  return `${quotaBar(window.remainingPercent)}  **<font color='${color}'>剩余 ${percent(window.remainingPercent)}</font>**\n<font color='grey'>${safe(windowLabel(window))}${safe(resetLabel(window))}</font>`;
}

function creditsLabel(limit: AccountQuotaLimit): string {
  if (limit.credits?.unlimited) return "<font color='grey'>积分额度不限</font>";
  if (limit.credits?.hasCredits && limit.credits.balance) {
    return `<font color='grey'>积分余额 ${safe(limit.credits.balance)}</font>`;
  }
  return "";
}

function spendLimitLabel(limit: AccountQuotaLimit): string {
  const spend = limit.individualLimit;
  if (!spend) return "";
  const reset = spend.resetsAt ? ` · ${formatResetTime(spend.resetsAt)} 重置` : "";
  return `<font color='grey'>个人用量上限剩余 ${percent(spend.remainingPercent)} · ${safe(spend.used)} / ${safe(spend.limit)}${safe(reset)}</font>`;
}

function reachedLabel(reachedType?: string): string {
  if (!reachedType) return "";
  return `<font color='red'>当前额度已受限：${safe(reachedTypeLabel(reachedType))}</font>`;
}

function quotaBar(remainingPercent: number): string {
  const filled = Math.max(0, Math.min(10, Math.round(remainingPercent / 10)));
  return `${"■".repeat(filled)}${"□".repeat(10 - filled)}`;
}

function windowLabel(window: AccountQuotaWindow): string {
  const minutes = window.windowDurationMins;
  if (!minutes) return "滚动窗口";
  if (minutes % (24 * 60) === 0) return `${minutes / (24 * 60)} 天窗口`;
  if (minutes % 60 === 0) return `${minutes / 60} 小时窗口`;
  return `${minutes} 分钟窗口`;
}

function resetLabel(window: AccountQuotaWindow): string {
  return window.resetsAt ? ` · ${formatResetTime(window.resetsAt)} 重置` : "";
}

function formatResetTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "时间未知";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatSampleTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "时间未知";
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function percent(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

function planLabel(value: string): string {
  return {
    free: "Free",
    go: "Go",
    plus: "Plus",
    pro: "Pro",
    prolite: "Pro Lite",
    team: "Team",
    self_serve_business_usage_based: "Business",
    business: "Business",
    enterprise_cbp_usage_based: "Enterprise",
    enterprise: "Enterprise",
    edu: "Edu",
    unknown: "Codex",
  }[value] ?? value;
}

function reachedTypeLabel(value: string): string {
  return {
    rate_limit_reached: "滚动额度已用尽",
    workspace_owner_credits_depleted: "工作区积分已用尽",
    workspace_member_credits_depleted: "成员积分已用尽",
    workspace_owner_usage_limit_reached: "工作区用量上限已达到",
    workspace_member_usage_limit_reached: "成员用量上限已达到",
  }[value] ?? value;
}

function panel(
  prefix: string,
  background: string,
  elements: Record<string, unknown>[],
): Record<string, unknown> {
  return {
    tag: "column_set",
    element_id: `${prefix}_panel`,
    flex_mode: "none",
    columns: [
      {
        tag: "column",
        width: "weighted",
        weight: 1,
        background_style: background,
        padding: "12px 12px 12px 12px",
        vertical_spacing: "6px",
        elements,
      },
    ],
  };
}

function markdown(
  elementId: string,
  content: string,
  textSize?: string,
): Record<string, unknown> {
  return {
    tag: "markdown",
    element_id: elementId,
    ...(textSize ? { text_size: textSize } : {}),
    content,
  };
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
