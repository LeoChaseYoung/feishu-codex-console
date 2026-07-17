import { describe, expect, it } from "vitest";

import { renderQuotaCard } from "../src/quota-card.js";

function collectByKey(value: unknown, key: string, result: unknown[] = []): unknown[] {
  if (Array.isArray(value)) {
    for (const item of value) collectByKey(item, key, result);
    return result;
  }
  if (typeof value !== "object" || value === null) return result;
  for (const [entryKey, child] of Object.entries(value)) {
    if (entryKey === key) result.push(child);
    collectByKey(child, key, result);
  }
  return result;
}

describe("quota card", () => {
  it("shows full native windows on a dedicated surface with refresh and back actions", () => {
    const card = renderQuotaCard({
      deviceName: "Developer Mac",
      quota: {
        status: "available",
        sampledAt: "2026-07-16T12:00:00.000Z",
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
              resetsAt: "2026-07-20T12:00:00.000Z",
            },
          },
          {
            id: "spark",
            name: "GPT-5.3-Codex-Spark",
            primary: {
              usedPercent: 0,
              remainingPercent: 100,
              windowDurationMins: 300,
            },
          },
        ],
      },
    });
    const serialized = JSON.stringify(card);
    expect(serialized).toContain("Codex 账户额度");
    expect(serialized).toContain("剩余 18%");
    expect(serialized).toContain("剩余 100%");
    expect(serialized).toContain("可用重置次数 4");
    expect(collectByKey(card, "action")).toEqual(["quota_refresh", "quota_device"]);
    expect(serialized.length).toBeLessThan(30_000);
  });
});
