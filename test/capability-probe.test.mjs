import { describe, expect, it } from "vitest";

import { eventProbeArgs, probeFeishuCapabilities } from "../scripts/capability-probe.mjs";

describe("Feishu installation capability probe", () => {
  it("checks the bot and both required event streams", () => {
    const calls = [];
    const report = probeFeishuCapabilities("lark-cli", {
      cwd: "/tmp/project",
      run(command, args, cwd) {
        calls.push({ command, args, cwd });
        return { status: 0, stdout: "", stderr: "" };
      },
    });
    expect(report.ok).toBe(true);
    expect(calls).toEqual([
      { command: "lark-cli", args: ["whoami", "--as", "bot"], cwd: "/tmp/project" },
      {
        command: "lark-cli",
        args: eventProbeArgs("im.message.receive_v1"),
        cwd: "/tmp/project",
      },
      {
        command: "lark-cli",
        args: eventProbeArgs("card.action.trigger"),
        cwd: "/tmp/project",
      },
      {
        command: "lark-cli",
        args: ["auth", "scopes", "--format", "json"],
        cwd: "/tmp/project",
      },
    ]);
    expect(report.projectChatStatus).toBe("unknown");
  });

  it("accepts an event stream already owned by the running bridge", () => {
    const report = probeFeishuCapabilities("lark-cli", {
      run(_command, args) {
        if (args[0] === "whoami") return { status: 0, stdout: "", stderr: "" };
        return {
          status: 2,
          stdout: JSON.stringify({
            error: { message: "another consumer (pid 42) is already running for this subscription" },
          }),
          stderr: "",
        };
      },
    });
    expect(report.ok).toBe(true);
    expect(report.checks[1].detail).toMatch(/运行中的事件消费者/);
  });

  it("returns a concrete remediation for missing event capability", () => {
    const report = probeFeishuCapabilities("lark-cli", {
      run(_command, args) {
        if (args[0] === "whoami") return { status: 0, stdout: "", stderr: "" };
        if (args.includes("im.message.receive_v1")) {
          return {
            status: 1,
            stdout: JSON.stringify({ error: { message: "missing required scope" } }),
            stderr: "",
          };
        }
        return { status: 0, stdout: "", stderr: "" };
      },
    });
    expect(report.ok).toBe(false);
    expect(report.checks[1]).toMatchObject({
      ok: false,
      detail: "missing required scope",
    });
    expect(report.checks[1].remediation).toMatch(/im.message.receive_v1/);
  });

  it("verifies all optional project-chat scopes when app scopes are available", () => {
    const report = probeFeishuCapabilities("lark-cli", {
      run(_command, args) {
        if (args[0] === "auth") {
          return {
            status: 0,
            stdout: JSON.stringify({
              tenantScopes: [
                "im:chat:create",
                "im:chat.members:write_only",
                "im:message.pins:write_only",
                "im:message.group_msg:readonly",
              ],
            }),
            stderr: "",
          };
        }
        return { status: 0, stdout: "", stderr: "" };
      },
    });
    expect(report.ok).toBe(true);
    expect(report.projectChatStatus).toBe("ready");
    expect(report.checks.slice(-4).every((check) => check.ok)).toBe(true);
  });

  it("reports missing project-chat scopes without blocking private-chat setup", () => {
    const report = probeFeishuCapabilities("lark-cli", {
      run(_command, args) {
        if (args[0] === "auth") {
          return {
            status: 0,
            stdout: JSON.stringify({ tenantScopes: ["im:chat:create"] }),
            stderr: "",
          };
        }
        return { status: 0, stdout: "", stderr: "" };
      },
    });
    expect(report.ok).toBe(true);
    expect(report.projectChatStatus).toBe("missing");
    expect(report.checks.find((check) => check.id === "project_chat_members_scope")).toMatchObject({
      ok: false,
      status: "missing",
    });
    expect(report.checks.find((check) => check.id === "project_chat_message_scope")).toMatchObject({
      ok: false,
      status: "missing",
    });
  });
});
