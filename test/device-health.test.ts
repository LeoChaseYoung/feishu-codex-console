import { describe, expect, it } from "vitest";

import { deriveDeviceAvailability } from "../src/device-health.js";

const readyConsumers = [
  { eventKey: "im.message.receive_v1", ready: true },
  { eventKey: "card.action.trigger", ready: true },
];

describe("device availability", () => {
  it("distinguishes online, connecting, degraded, error, offline, and maintenance", () => {
    expect(
      deriveDeviceAvailability({ consumers: readyConsumers, codex: { ready: false } }).state,
    ).toBe("online");
    expect(
      deriveDeviceAvailability({ consumers: [], codex: { ready: false } }).state,
    ).toBe("connecting");
    expect(
      deriveDeviceAvailability({
        consumers: [
          { eventKey: "im.message.receive_v1", ready: true },
          { eventKey: "card.action.trigger", ready: false },
        ],
        codex: { ready: false },
      }),
    ).toMatchObject({ state: "degraded", canExecute: true, canInteract: false });
    expect(
      deriveDeviceAvailability({
        consumers: readyConsumers,
        api: { state: "degraded", consecutiveFailures: 2 },
        codex: { ready: true },
      }),
    ).toMatchObject({ state: "degraded", canExecute: true, canInteract: true });
    expect(
      deriveDeviceAvailability({
        consumers: readyConsumers,
        codex: { ready: false, lastError: "login expired" },
      }),
    ).toMatchObject({ state: "error", canExecute: false, canInteract: true });
    expect(
      deriveDeviceAvailability({
        consumers: readyConsumers,
        codex: { ready: true },
        sampledAt: "2026-07-16T12:01:00.000Z",
        serviceHeartbeatAt: "2026-07-16T12:00:00.000Z",
      }),
    ).toMatchObject({ state: "offline", canExecute: false, canInteract: false });
    expect(
      deriveDeviceAvailability({
        consumers: readyConsumers,
        codex: { ready: true },
        maintenance: true,
      }).state,
    ).toBe("maintenance");
  });

  it("includes a privacy-safe last-success timestamp without task content", () => {
    expect(
      deriveDeviceAvailability({
        consumers: readyConsumers,
        codex: { ready: true },
        sampledAt: "2026-07-16T12:00:00.000Z",
        lastSuccessfulTaskAt: "2026-07-16T11:00:00.000Z",
      }),
    ).toMatchObject({
      state: "online",
      sampledAt: "2026-07-16T12:00:00.000Z",
      lastSuccessfulTaskAt: "2026-07-16T11:00:00.000Z",
    });
  });
});
