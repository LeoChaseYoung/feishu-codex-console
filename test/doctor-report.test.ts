import { describe, expect, it } from "vitest";

import { buildDoctorReport } from "../src/doctor-report.js";

describe("machine-readable doctor report", () => {
  it("counts outcomes and redacts details", () => {
    const report = buildDoctorReport([
      { label: "配置", status: "ok", detail: "安全" },
      { label: "项目群", status: "warning", detail: "需要确认" },
      { label: "Codex", status: "failed", detail: "Bearer secret-doctor-token" },
    ]);

    expect(report).toMatchObject({
      contractVersion: 1,
      product: "feishu-codex-console",
      ok: false,
      summary: { ok: 1, warning: 1, failed: 1 },
    });
    expect(JSON.stringify(report)).not.toContain("secret-doctor-token");
    expect(JSON.stringify(report)).toContain("REDACTED");
  });
});
