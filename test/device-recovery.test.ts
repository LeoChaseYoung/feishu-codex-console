import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { readBridgeHealth, writeBridgeHealth } from "../src/health-file.js";
import { assessBridgeRecovery, shouldSendRecoveryNotice } from "../src/recovery-policy.js";
import { StateStore } from "../src/state-store.js";

describe("device restart recovery", () => {
  it("detects a stale ready heartbeat, restores cards, and rate-limits notices", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "device-recovery-"));
    const databaseFile = path.join(directory, "state.sqlite");
    try {
      await writeBridgeHealth(directory, {
        status: "ready",
        instanceId: "default",
        pid: 123,
        startedAt: "2026-07-16T11:00:00.000Z",
        configFile: "/tmp/default.env",
        consumers: [
          { eventKey: "im.message.receive_v1", ready: true, restartCount: 0 },
          { eventKey: "card.action.trigger", ready: true, restartCount: 0 },
        ],
      });
      const health = await readBridgeHealth(directory);
      expect(health).not.toBeNull();
      const heartbeat = Date.parse(health?.updatedAt ?? "");
      const decision = assessBridgeRecovery(health, {
        currentPid: 456,
        now: heartbeat + 60_000,
        processAlive: () => false,
      });
      expect(decision).toMatchObject({
        blockDuplicate: false,
        unexpected: true,
        offlineForMs: 60_000,
        notify: true,
      });

      const state = new StateStore(databaseFile, 10);
      await state.load();
      await state.upsertDeviceCard({
        messageId: "om-device",
        cardId: "card-device",
        conversationKey: "oc-1",
        ownerId: "ou-1",
        sequence: 2,
        createdAt: 1,
      });
      expect(state.listDeviceCards()).toHaveLength(1);
      expect(shouldSendRecoveryNotice(state.getLastDeviceRecoveryNotice("oc-1"), heartbeat)).toBe(true);
      await state.setLastDeviceRecoveryNotice("oc-1", new Date(heartbeat).toISOString());
      expect(shouldSendRecoveryNotice(state.getLastDeviceRecoveryNotice("oc-1"), heartbeat + 60_000)).toBe(false);
      expect(shouldSendRecoveryNotice(state.getLastDeviceRecoveryNotice("oc-1"), heartbeat + 16 * 60_000)).toBe(true);
      state.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("blocks a second process with a fresh live marker and ignores graceful stops", () => {
    const base = {
      version: 1 as const,
      instanceId: "default",
      pid: 123,
      startedAt: "2026-07-16T12:00:00.000Z",
      updatedAt: "2026-07-16T12:00:00.000Z",
      configFile: "/tmp/default.env",
      consumers: [],
    };
    expect(
      assessBridgeRecovery({ ...base, status: "ready" }, {
        currentPid: 456,
        now: Date.parse(base.updatedAt) + 5_000,
        processAlive: () => true,
      }),
    ).toMatchObject({ blockDuplicate: true, unexpected: false });
    expect(
      assessBridgeRecovery({ ...base, status: "stopping" }, {
        currentPid: 456,
        now: Date.parse(base.updatedAt) + 60_000,
        processAlive: () => false,
      }),
    ).toMatchObject({ blockDuplicate: false, unexpected: false, notify: false });
  });
});
