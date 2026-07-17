import { describe, expect, it } from "vitest";

import { renderAccountQuotaPanel } from "../src/account-quota-card.js";
import {
  normalizeAccountQuotaResponse,
  unavailableAccountQuota,
} from "../src/account-quota.js";

const response = {
  rateLimits: {
    limitId: "codex",
    limitName: null,
    primary: {
      usedPercent: 82,
      windowDurationMins: 10_080,
      resetsAt: 1_784_781_473,
    },
    secondary: null,
    credits: { hasCredits: false, unlimited: false, balance: "0" },
    individualLimit: null,
    planType: "pro",
    rateLimitReachedType: null,
  },
  rateLimitsByLimitId: {
    codex_bengalfox: {
      limitId: "codex_bengalfox",
      limitName: "GPT-5.3-Codex-Spark",
      primary: {
        usedPercent: 0,
        windowDurationMins: 10_080,
        resetsAt: 1_784_864_721,
      },
      secondary: null,
      credits: null,
      individualLimit: null,
      planType: "pro",
      rateLimitReachedType: null,
    },
    codex: {
      limitId: "codex",
      primary: { usedPercent: 82, windowDurationMins: 10_080 },
    },
  },
  rateLimitResetCredits: {
    availableCount: 4n,
    credits: [{ id: "secret-reset-credit-id" }],
  },
};

describe("Codex account quota", () => {
  it("normalizes independent limits, remaining percentages and reset credits", () => {
    const quota = normalizeAccountQuotaResponse(response, "2026-07-16T12:00:00.000Z");

    expect(quota).toMatchObject({
      status: "available",
      resetCredits: 4,
      limits: [
        {
          id: "codex",
          name: "Codex",
          planType: "pro",
          primary: {
            usedPercent: 82,
            remainingPercent: 18,
            windowDurationMins: 10_080,
            resetsAt: "2026-07-23T04:37:53.000Z",
          },
        },
        {
          id: "codex_bengalfox",
          name: "GPT-5.3-Codex-Spark",
          primary: { remainingPercent: 100 },
        },
      ],
    });
  });

  it("renders quota without leaking reset-credit identifiers", () => {
    const quota = normalizeAccountQuotaResponse(response, "2026-07-16T12:00:00.000Z");
    const serialized = JSON.stringify(renderAccountQuotaPanel(quota, "dq"));

    expect(serialized).toContain("剩余 18%");
    expect(serialized).toContain("GPT-5.3-Codex-Spark");
    expect(serialized).toContain("可用重置次数 4");
    expect(serialized).not.toContain("secret-reset-credit-id");
  });

  it("uses an explicit unavailable state instead of inventing quota values", () => {
    const serialized = JSON.stringify(
      renderAccountQuotaPanel(unavailableAccountQuota("2026-07-16T12:00:00.000Z"), "cq"),
    );
    expect(serialized).toContain("暂不可用");
    expect(serialized).not.toContain("剩余 100%");
  });
});
