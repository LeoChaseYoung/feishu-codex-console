import path from "node:path";

const SECRET_NAME =
  "(?:app|client)[_-]?secret|access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|password|passwd|private[_-]?key|authorization|cookie|session[_-]?(?:id|token|secret)|webhook[_-]?url";

export function redactSensitiveText(value: string, maxChars = Number.POSITIVE_INFINITY): string {
  const redacted = value
    .replace(
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
      "[REDACTED PRIVATE KEY]",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [REDACTED]")
    .replace(/\bBasic\s+[A-Za-z0-9+/=]{8,}/gi, "Basic [REDACTED]")
    .replace(
      /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{12,})\b/g,
      "[REDACTED TOKEN]",
    )
    .replace(
      /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
      "[REDACTED JWT]",
    )
    .replace(
      new RegExp(`((?:"?(?:${SECRET_NAME})"?)\\s*[:=]\\s*)(?:"[^"]*"|'[^']*'|[^\\s,;]+)`, "gi"),
      "$1[REDACTED]",
    )
    .replace(
      /\b(https?:\/\/)([^\s/:@]+):([^\s/@]+)@/gi,
      "$1[REDACTED]:[REDACTED]@",
    );
  return redacted.slice(0, Math.max(0, maxChars));
}

export function prepareRemoteMarkdown(
  value: string,
  maxChars = Number.POSITIVE_INFINITY,
): string {
  const redacted = redactSensitiveText(value);
  const withoutLocalLinks = redacted.replace(
    /\[([^\]\r\n]+)\]\(\s*<?(?:(?:file|vscode):\/{2,}|\/(?:Users|home|private|var|tmp)\/|~\/|[A-Za-z]:[\\/])[^)\r\n>]*>?\s*\)/g,
    (_match, label: string) => `\`${label.replaceAll("`", "")}\``,
  );
  return withoutLocalLinks.slice(0, Math.max(0, maxChars));
}

export function redactDiagnosticText(
  value: string,
  options: { homeDirectory?: string; maxChars?: number } = {},
): string {
  let redacted = redactSensitiveText(value);
  if (options.homeDirectory) {
    const home = path.resolve(options.homeDirectory);
    redacted = redacted.split(home).join("~");
  }
  return redacted.slice(0, options.maxChars ?? Number.POSITIVE_INFINITY);
}

export function safeErrorText(error: unknown, maxChars = 2_000): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactSensitiveText(message.replace(/[\r\n]+/g, " "), maxChars);
}

let consoleRedactionInstalled = false;

export function installConsoleRedaction(target: Console = console): void {
  if (consoleRedactionInstalled) return;
  consoleRedactionInstalled = true;
  for (const level of ["debug", "info", "warn", "error"] as const) {
    const original = target[level].bind(target);
    target[level] = ((...args: unknown[]) => {
      original(...args.map((value) => redactLogValue(value)));
    }) as Console[typeof level];
  }
}

function redactLogValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return redactSensitiveText(value, 8_000);
  if (value instanceof Error) {
    const stack = value.stack ? redactSensitiveText(value.stack, 8_000) : "";
    return stack || `${value.name}: ${safeErrorText(value)}`;
  }
  if (Buffer.isBuffer(value)) return `[Buffer ${value.length} bytes]`;
  if (typeof value === "object" && value !== null) {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((entry) => redactLogValue(entry, seen));
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .slice(0, 50)
      .map(([key, entry]) => [key, redactLogValue(entry, seen)]);
    return Object.fromEntries(entries);
  }
  return value;
}
