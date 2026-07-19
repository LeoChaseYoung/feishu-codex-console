import { spawnSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");
const cli = path.join(projectRoot, "scripts", "cli.mjs");

function run(...args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
  });
}

describe("CLI help", () => {
  it.each([
    ["doctor", "--help"],
    ["doctor", "-h"],
    ["configure-feishu", "--help"],
  ])("supports help after a subcommand: %s %s", (...args) => {
    const result = run(...args);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("用法：");
    expect(result.stderr).not.toContain("缺少值");
    expect(result.stderr).not.toContain("at parseFlags");
  });

  it("reports invalid flags without leaking a stack trace", () => {
    const result = run("doctor", "--config");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("参数 --config 缺少值");
    expect(result.stderr).not.toContain("at parseFlags");
  });
});
