import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  bridgeHealthPath,
  readBridgeHealth,
  removeBridgeHealth,
  writeBridgeHealth,
} from "../src/health-file.js";

describe("bridge health file", () => {
  it("writes private atomic health state and only removes its own marker", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "bridge-health-"));
    try {
      const written = await writeBridgeHealth(directory, {
        status: "ready",
        instanceId: "team",
        pid: 123,
        startedAt: "2026-07-16T00:00:00.000Z",
        configFile: "/tmp/team.env",
        consumers: [
          {
            eventKey: "im.message.receive_v1",
            ready: true,
            restartCount: 0,
            lastReadyAt: "2026-07-16T00:00:01.000Z",
          },
          { eventKey: "card.action.trigger", ready: true, restartCount: 0 },
        ],
        api: {
          state: "ready",
          consecutiveFailures: 0,
          lastSuccessAt: "2026-07-16T00:00:02.000Z",
        },
      });
      expect(written.status).toBe("ready");
      expect(await readBridgeHealth(directory)).toMatchObject({
        pid: 123,
        instanceId: "team",
        api: { state: "ready" },
      });
      expect((await stat(bridgeHealthPath(directory))).mode & 0o777).toBe(0o600);
      expect((await stat(directory)).mode & 0o777).toBe(0o700);

      await removeBridgeHealth(directory, 456);
      expect(await readBridgeHealth(directory)).not.toBeNull();
      await removeBridgeHealth(directory, 123);
      expect(await readBridgeHealth(directory)).toBeNull();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
