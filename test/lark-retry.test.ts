import { describe, expect, it } from "vitest";

import {
  isTransientLarkFailure,
  larkRetryDelayMs,
  retryAfterMs,
} from "../src/lark-retry.js";

describe("Lark API retry policy", () => {
  it("retries rate limits, server failures, timeouts, and network resets", () => {
    expect(isTransientLarkFailure(new Error("HTTP 429 too many requests"))).toBe(true);
    expect(isTransientLarkFailure(new Error("lark API 503"))).toBe(true);
    expect(isTransientLarkFailure(new Error("request timed out"))).toBe(true);
    expect(isTransientLarkFailure(new Error("read ECONNRESET"))).toBe(true);
    expect(isTransientLarkFailure(new Error("permission denied"))).toBe(false);
  });

  it("honors bounded Retry-After and otherwise applies exponential jitter", () => {
    expect(retryAfterMs(new Error("Retry-After: 2s"))).toBe(2_000);
    expect(larkRetryDelayMs(1, new Error("HTTP 503"), () => 0)).toBe(750);
    expect(larkRetryDelayMs(2, new Error("HTTP 503"), () => 0)).toBe(1_500);
    expect(larkRetryDelayMs(1, new Error("Retry-After: 90s"))).toBe(30_000);
  });
});
