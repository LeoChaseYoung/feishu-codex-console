import "dotenv/config";

import { existsSync } from "node:fs";
import path from "node:path";

import { CodexRunner } from "./codex-runner.js";
import { loadConfig } from "./config.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const runner = new CodexRunner({
    ...config,
    sandboxMode: "read-only",
    networkAccessEnabled: false,
    webSearchMode: "disabled",
    codexTimeoutMs: 120_000,
  });
  try {
    const result = await runner.run(
      "smoke-test",
      "smoke",
      "Reply with exactly BRIDGE_SMOKE_OK. Do not run commands and do not modify files.",
      config.workdir,
      existsSync(path.join(config.workdir, ".git")),
    );
    process.stdout.write(`${result.finalResponse.trim()}\n`);
    if (result.finalResponse.trim() !== "BRIDGE_SMOKE_OK") process.exitCode = 1;
  } finally {
    await runner.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
