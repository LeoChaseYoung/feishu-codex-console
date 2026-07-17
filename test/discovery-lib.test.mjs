import { describe, expect, it } from "vitest";

import { discoveryCommandArgs, parseDiscoveryEvent } from "../scripts/discovery-lib.mjs";

describe("Feishu identity discovery", () => {
  it("extracts a user and conversation from lark-cli NDJSON", () => {
    expect(
      parseDiscoveryEvent(
        JSON.stringify({
          type: "im.message.receive_v1",
          sender_type: "user",
          sender_id: "ou_owner_1",
          chat_id: "oc_private_1",
          chat_type: "p2p",
          message_id: "om_message_1",
        }),
      ),
    ).toEqual({
      senderId: "ou_owner_1",
      chatId: "oc_private_1",
      chatType: "p2p",
      messageId: "om_message_1",
    });
  });

  it("ignores malformed, unrelated, and bot events", () => {
    expect(parseDiscoveryEvent("not-json")).toBeNull();
    expect(
      parseDiscoveryEvent(
        JSON.stringify({
          type: "card.action.trigger",
          sender_id: "ou_owner",
          chat_id: "oc_chat",
          chat_type: "p2p",
        }),
      ),
    ).toBeNull();
    expect(
      parseDiscoveryEvent(
        JSON.stringify({
          type: "im.message.receive_v1",
          sender_type: "bot",
          sender_id: "ou_bot",
          chat_id: "oc_chat",
          chat_type: "p2p",
        }),
      ),
    ).toBeNull();
  });

  it("uses a bounded read-only event subscription", () => {
    expect(discoveryCommandArgs("30s")).toEqual([
      "event",
      "consume",
      "im.message.receive_v1",
      "--as",
      "bot",
      "--max-events",
      "1",
      "--timeout",
      "30s",
      "--quiet",
    ]);
  });
});
