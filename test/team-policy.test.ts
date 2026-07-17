import { describe, expect, it } from "vitest";

import type { BridgeConfig } from "../src/config.js";
import {
  canAccessProject,
  canControlOwnedResource,
  canControlTask,
  canTakeOverTask,
  canViewTask,
  conversationKeyForEvent,
  roleForSender,
  selectableSandboxModes,
} from "../src/team-policy.js";

function config(): BridgeConfig {
  return {
    allowedSenderIds: new Set(["ou-operator"]),
    adminSenderIds: new Set(["ou-admin"]),
    viewerSenderIds: new Set(["ou-viewer"]),
    groupSessionScope: "member",
    projectAcl: new Map([["bridge", new Set(["ou-operator", "ou-viewer"])]]),
  } as BridgeConfig;
}

describe("team policy", () => {
  it("isolates group conversations per member while keeping p2p stable", () => {
    const base = {
      type: "im.message.receive_v1" as const,
      event_id: "evt",
      message_id: "om",
      chat_id: "oc-team",
      sender_id: "ou-operator",
      message_type: "text",
      content: "hello",
    };
    expect(conversationKeyForEvent({ ...base, chat_type: "group" }, config())).toBe(
      "oc-team::ou-operator",
    );
    expect(conversationKeyForEvent({ ...base, chat_type: "p2p" }, config())).toBe("oc-team");
  });

  it("maps every member in one Feishu topic to the same shared Codex session", () => {
    const base = {
      type: "im.message.receive_v1" as const,
      event_id: "evt",
      message_id: "om-reply",
      chat_id: "oc-team",
      chat_type: "group" as const,
      message_type: "text",
      content: "continue",
      root_id: "om-root",
    };
    expect(
      conversationKeyForEvent({ ...base, sender_id: "ou-operator" }, config()),
    ).toBe("oc-team::topic::om-root");
    expect(
      conversationKeyForEvent({ ...base, sender_id: "ou-second" }, config()),
    ).toBe("oc-team::topic::om-root");
  });

  it("enforces role ownership and project ACLs", () => {
    const value = config();
    const project = {
      name: "bridge",
      path: "/repos/bridge",
      displayPath: "bridge",
    };
    expect(roleForSender(value, "ou-admin")).toBe("admin");
    expect(roleForSender(value, "ou-viewer")).toBe("viewer");
    expect(canControlOwnedResource(value, "ou-operator", "ou-operator")).toBe(true);
    expect(canControlOwnedResource(value, "ou-viewer", "ou-viewer")).toBe(false);
    expect(canControlOwnedResource(value, "ou-admin", "ou-operator")).toBe(true);
    expect(canAccessProject(value, "ou-operator", project)).toBe(true);
    expect(canAccessProject(value, "ou-admin", { ...project, name: "private" })).toBe(true);
  });

  it("moves task control explicitly while keeping the initiator able to view and reclaim", () => {
    const value = {
      ...config(),
      allowedSenderIds: new Set(["ou-operator", "ou-second"]),
    };
    const task = { ownerId: "ou-operator", controllerId: "ou-second" };
    expect(canControlTask(value, "ou-operator", task)).toBe(false);
    expect(canControlTask(value, "ou-second", task)).toBe(true);
    expect(canControlTask(value, "ou-admin", task)).toBe(true);
    expect(canViewTask(value, "ou-operator", task)).toBe(true);
    expect(canTakeOverTask(value, "ou-operator", task)).toBe(true);
    expect(canTakeOverTask(value, "ou-second", task)).toBe(false);
  });

  it("never offers a sandbox mode above the service maximum", () => {
    expect(selectableSandboxModes("workspace-write")).toEqual([
      "read-only",
      "workspace-write",
    ]);
  });
});
