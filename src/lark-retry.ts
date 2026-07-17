const TRANSIENT_PATTERNS = [
  /\b429\b/,
  /rate[ -]?limit/i,
  /too many requests/i,
  /retry[ -]?after/i,
  /\b5\d\d\b/,
  /timeout|timed out/i,
  /econn(?:reset|refused|aborted)/i,
  /enetunreach|ehostunreach|eai_again/i,
  /socket hang up|network is unreachable/i,
  /temporar(?:y|ily) unavailable/i,
];

export function isTransientLarkFailure(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return TRANSIENT_PATTERNS.some((pattern) => pattern.test(text));
}

export function larkRetryDelayMs(
  failedAttempt: number,
  error: unknown,
  random = Math.random,
): number {
  const explicit = retryAfterMs(error);
  if (explicit !== undefined) return Math.min(Math.max(explicit, 250), 30_000);
  const exponential = Math.min(750 * 2 ** Math.max(0, failedAttempt - 1), 8_000);
  const jitter = Math.floor(exponential * 0.2 * Math.max(0, Math.min(1, random())));
  return exponential + jitter;
}

export function retryAfterMs(error: unknown): number | undefined {
  const text = error instanceof Error ? error.message : String(error);
  const milliseconds = text.match(/retry[- ]after\s*[:=]?\s*(\d+)\s*ms/i)?.[1];
  if (milliseconds) return Number.parseInt(milliseconds, 10);
  const seconds = text.match(/retry[- ]after\s*[:=]?\s*(\d+(?:\.\d+)?)\s*s(?:ec(?:ond)?s?)?/i)?.[1];
  if (seconds) return Math.ceil(Number.parseFloat(seconds) * 1_000);
  return undefined;
}
