import type { BridgeConfig } from "./config.js";
import type { FeishuMessageEvent } from "./types.js";

const TOPIC_MARKER = "::topic::";

export type WorkspaceSessionKind = "direct" | "group-main" | "group-topic";

export interface WorkspaceSessionAddress {
  conversationKey: string;
  baseConversationKey: string;
  kind: WorkspaceSessionKind;
  replyInThread: boolean;
  startsNewTopic: boolean;
  topicRootId?: string;
}

export function workspaceSessionForEvent(
  event: Pick<
    FeishuMessageEvent,
    "chat_id" | "chat_type" | "sender_id" | "message_id" | "root_id" | "thread_id"
  >,
  config: Pick<BridgeConfig, "groupSessionScope">,
): WorkspaceSessionAddress {
  const baseConversationKey = baseConversationForEvent(event, config);
  if (event.chat_type === "p2p") {
    return {
      conversationKey: event.chat_id,
      baseConversationKey: event.chat_id,
      kind: "direct",
      replyInThread: false,
      startsNewTopic: false,
    };
  }

  const topicRootId = normalizedTopicId(event.root_id) ?? normalizedTopicId(event.thread_id);
  if (topicRootId) {
    return {
      conversationKey: topicConversationKey(event.chat_id, topicRootId),
      baseConversationKey,
      kind: "group-topic",
      replyInThread: true,
      startsNewTopic: false,
      topicRootId,
    };
  }

  return {
    conversationKey: baseConversationKey,
    baseConversationKey,
    kind: "group-main",
    replyInThread: false,
    startsNewTopic: false,
  };
}

export function workspaceSessionForPrompt(
  event: Pick<
    FeishuMessageEvent,
    "chat_id" | "chat_type" | "sender_id" | "message_id" | "root_id" | "thread_id"
  >,
  config: Pick<BridgeConfig, "groupSessionScope">,
): WorkspaceSessionAddress {
  const current = workspaceSessionForEvent(event, config);
  if (current.kind !== "group-main") return current;
  return {
    conversationKey: topicConversationKey(event.chat_id, event.message_id),
    baseConversationKey: current.baseConversationKey,
    kind: "group-topic",
    replyInThread: true,
    startsNewTopic: true,
    topicRootId: event.message_id,
  };
}

export function baseConversationForEvent(
  event: Pick<FeishuMessageEvent, "chat_id" | "chat_type" | "sender_id">,
  config: Pick<BridgeConfig, "groupSessionScope">,
): string {
  if (event.chat_type === "group" && config.groupSessionScope === "member") {
    return `${event.chat_id}::${event.sender_id}`;
  }
  return event.chat_id;
}

export function topicConversationKey(chatId: string, topicRootId: string): string {
  return `${chatId}${TOPIC_MARKER}${topicRootId}`;
}

export function isTopicConversationKey(conversationKey: string): boolean {
  return conversationKey.includes(TOPIC_MARKER);
}

export function chatIdFromConversationKey(conversationKey: string): string {
  const boundary = conversationKey.indexOf("::");
  return boundary >= 0 ? conversationKey.slice(0, boundary) : conversationKey;
}

function normalizedTopicId(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}
