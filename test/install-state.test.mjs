import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  installStatePath,
  loadInstallState,
  recordInstallError,
  recordInstallStep,
} from "../scripts/install-state.mjs";

describe("resumable installation state", () => {
  it("persists ordered non-sensitive progress with private permissions", async () => {
    const sandbox = await mkdtemp(path.join(tmpdir(), "bridge-state-test-"));
    const config = path.join(sandbox, "config", "team.env");
    try {
      let state = await recordInstallStep(config, null, "environment_ready", {
        instanceId: "team",
        secret: "must-not-be-saved",
      });
      state = await recordInstallStep(config, state, "identity_discovered", {
        chatType: "p2p",
      });
      state = await recordInstallStep(config, state, "environment_ready");
      const loaded = await loadInstallState(config);
      expect(loaded.status).toBe("identity_discovered");
      expect(loaded.completedSteps).toEqual(["environment_ready", "identity_discovered"]);
      expect(loaded.instanceId).toBe("team");
      expect(loaded.chatType).toBe("p2p");
      expect(loaded.secret).toBeUndefined();
      expect((await stat(installStatePath(config))).mode & 0o777).toBe(0o600);

      const failed = await recordInstallError(config, loaded, new Error("doctor failed"));
      expect(failed.status).toBe("identity_discovered");
      expect((await loadInstallState(config)).lastError).toBe("doctor failed");
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });
});
