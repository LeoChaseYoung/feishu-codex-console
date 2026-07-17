import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  serviceHealthPath,
  validateServiceHealth,
  waitForServiceHealth,
} from "../scripts/service-health.mjs";

function readyHealth(overrides = {}) {
  return {
    version: 1,
    status: "ready",
    instanceId: "team",
    pid: 123,
    startedAt: "2026-07-16T00:00:00.000Z",
    updatedAt: new Date().toISOString(),
    configFile: "/tmp/team.env",
    consumers: [
      { eventKey: "im.message.receive_v1", ready: true, restartCount: 0 },
      { eventKey: "card.action.trigger", ready: true, restartCount: 0 },
    ],
    ...overrides,
  };
}

describe("service health validation", () => {
  it("requires a live ready process using the expected config", () => {
    expect(
      validateServiceHealth(readyHealth(), {
        instanceId: "team",
        configFile: "/tmp/team.env",
        processAlive: () => true,
      }),
    ).toEqual({ ok: true, reason: "服务健康且配置一致" });

    expect(
      validateServiceHealth(readyHealth({ configFile: "/tmp/other.env" }), {
        instanceId: "team",
        configFile: "/tmp/team.env",
        processAlive: () => true,
      }),
    ).toMatchObject({ ok: false, reason: expect.stringContaining("另一份配置") });
  });

  it("waits until a fresh marker becomes ready", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "service-health-"));
    try {
      await writeFile(serviceHealthPath(directory), JSON.stringify(readyHealth({ status: "starting" })));
      setTimeout(() => {
        void writeFile(serviceHealthPath(directory), JSON.stringify(readyHealth()));
      }, 20);
      const health = await waitForServiceHealth({
        dataDir: directory,
        instanceId: "team",
        configFile: "/tmp/team.env",
        timeoutMs: 500,
        pollIntervalMs: 10,
        processAlive: () => true,
      });
      expect(health.status).toBe("ready");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
