import { homedir } from "node:os";

import type { DoctorCheckResult } from "./diagnostics.js";
import { redactDiagnosticText } from "./redaction.js";

export interface DoctorReport {
  contractVersion: 1;
  product: "feishu-codex-console";
  ok: boolean;
  summary: {
    ok: number;
    warning: number;
    failed: number;
  };
  checks: DoctorCheckResult[];
}

export function buildDoctorReport(results: readonly DoctorCheckResult[]): DoctorReport {
  const checks = results.map((result) => ({
    ...result,
    detail: redactDiagnosticText(result.detail, {
      homeDirectory: homedir(),
      maxChars: 2_000,
    }),
  }));
  const summary = {
    ok: checks.filter((result) => result.status === "ok").length,
    warning: checks.filter((result) => result.status === "warning").length,
    failed: checks.filter((result) => result.status === "failed").length,
  };
  return {
    contractVersion: 1,
    product: "feishu-codex-console",
    ok: summary.failed === 0,
    summary,
    checks,
  };
}
