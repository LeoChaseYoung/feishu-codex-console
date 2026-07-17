import { describe, expect, it } from "vitest";

import {
  workspaceSessionForEvent,
  workspaceSessionForPrompt,
} from "../src/workspace-session.js";

const config = { groupSessionScope: "member" as const };

describe("workspace session routing", () => {
  it("turns a top-level group prompt into a new topic session", () => {
    const session = workspaceSessionForPrompt(
      {
        chat_id: "oc-team",
        chat_type: "group",
        sender_id: "ou-owner",
        message_id: "om-root",
      },
      config,
    );
    expect(session).toMatchObject({
      conversationKey: "oc-team::topic::om-root",
      baseConversationKey: "oc-team::ou-owner",
      kind: "group-topic",
      replyInThread: true,
      startsNewTopic: true,
    });
  });

  it("uses root_id so later replies resume the same topic session", () => {
    const session = workspaceSessionForEvent(
      {
        chat_id: "oc-team",
        chat_type: "group",
        sender_id: "ou-second",
        message_id: "om-reply",
        root_id: "om-root",
        thread_id: "omt-thread",
      },
      config,
    );
    expect(session.conversationKey).toBe("oc-team::topic::om-root");
    expect(session.startsNewTopic).toBe(false);
  });

  it("keeps direct messages as one continuous session", () => {
    const session = workspaceSessionForPrompt(
      {
        chat_id: "oc-direct",
        chat_type: "p2p",
        sender_id: "ou-owner",
        message_id: "om-message",
      },
      config,
    );
    expect(session).toMatchObject({
      conversationKey: "oc-direct",
      kind: "direct",
      replyInThread: false,
    });
  });
});
