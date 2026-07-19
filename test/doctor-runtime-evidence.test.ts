import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { readProjectChatRuntimeEvidence } from "../src/doctor-runtime-evidence.js";

describe("doctor project-chat runtime evidence", () => {
  it("reads successful delivery evidence without mutating the runtime database", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "bridge-doctor-evidence-"));
    const databaseFile = path.join(directory, "state.sqlite");
    try {
      const database = new DatabaseSync(databaseFile);
      database.exec(`
        CREATE TABLE project_chats (
          members_status TEXT NOT NULL,
          workspace_status TEXT NOT NULL,
          pin_status TEXT NOT NULL,
          message_status TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO project_chats VALUES (
          'succeeded', 'succeeded', 'succeeded', 'succeeded',
          '2026-07-19T08:51:56.794Z'
        );
      `);
      database.close();

      expect(readProjectChatRuntimeEvidence(databaseFile)).toEqual({
        totalBindings: 1,
        readyBindings: 1,
        messageVerifiedBindings: 1,
        lastVerifiedAt: "2026-07-19T08:51:56.794Z",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
