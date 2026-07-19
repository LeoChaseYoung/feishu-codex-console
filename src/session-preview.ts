const INTERNAL_MARKERS = [
  "This request comes from a remote Feishu control surface",
  "This request came from an authorized Feishu user through a restricted bridge",
  "Operate only inside the selected project's configured working directory",
  "Do not commit, push, deploy, publish, release",
  "developerInstructions",
] as const;

const USER_REQUEST_MARKER = "User request:";

/** Never expose bridge/system instructions through the Feishu session center. */
export function sanitizeSessionPreview(
  value: string,
  fallback = "历史会话（暂无用户摘要）",
): string {
  let normalized = value.trim();
  if (!normalized) return fallback;

  if (INTERNAL_MARKERS.some((marker) => normalized.includes(marker))) {
    const userRequestIndex = normalized.lastIndexOf(USER_REQUEST_MARKER);
    if (userRequestIndex < 0) return fallback;
    normalized = normalized.slice(userRequestIndex + USER_REQUEST_MARKER.length).trim();
  }

  normalized = normalized
    .replace(/^(?:system|developer|assistant)\s*[:：]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized ? normalized.slice(0, 240) : fallback;
}
