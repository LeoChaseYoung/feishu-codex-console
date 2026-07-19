import { DatabaseSync } from "node:sqlite";

import type { ProjectChatRuntimeEvidence } from "./doctor-capabilities.js";

interface ProjectChatEvidenceRow {
  members_status: string;
  workspace_status: string;
  pin_status: string;
  message_status: string;
  updated_at: string;
}

export function readProjectChatRuntimeEvidence(
  databaseFile: string,
): ProjectChatRuntimeEvidence | undefined {
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(databaseFile, { readOnly: true });
    const rows = database
      .prepare(
        `SELECT members_status, workspace_status, pin_status, message_status, updated_at
         FROM project_chats`,
      )
      .all() as unknown as ProjectChatEvidenceRow[];
    const readyRows = rows.filter(
      (row) =>
        row.members_status === "succeeded" &&
        row.workspace_status === "succeeded" &&
        row.pin_status === "succeeded" &&
        row.message_status === "succeeded",
    );
    const messageRows = rows.filter((row) => row.message_status === "succeeded");
    const lastVerifiedAt = messageRows
      .map((row) => row.updated_at)
      .filter(Boolean)
      .sort()
      .at(-1) ?? null;
    return {
      totalBindings: rows.length,
      readyBindings: readyRows.length,
      messageVerifiedBindings: messageRows.length,
      lastVerifiedAt,
    };
  } catch {
    return undefined;
  } finally {
    database?.close();
  }
}
