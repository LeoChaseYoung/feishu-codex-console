import { mkdtemp, readFile, stat, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  cleanupAttachmentCache,
  isSupportedImageFile,
  isUtf8TextFile,
  trimRuntimeLogs,
} from "../src/maintenance.js";

describe("runtime maintenance", () => {
  it("validates attachment contents instead of trusting extensions", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "feishu-codex-attachments-"));
    const png = path.join(directory, "image.png");
    const fake = path.join(directory, "fake.png");
    const text = path.join(directory, "source.ts");
    const binary = path.join(directory, "binary.txt");
    await writeFile(
      png,
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]),
    );
    await writeFile(fake, "not an image");
    await writeFile(text, "export const ok = true;\n");
    await writeFile(binary, Buffer.from([0xff, 0xfe, 0x00, 0x00]));

    expect(await isSupportedImageFile(png)).toBe(true);
    expect(await isSupportedImageFile(fake)).toBe(false);
    expect(await isUtf8TextFile(text)).toBe(true);
    expect(await isUtf8TextFile(binary)).toBe(false);
  });

  it("removes only expired, unprotected cached attachments", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "feishu-codex-cleanup-"));
    const expired = path.join(directory, "expired.txt");
    const protectedFile = path.join(directory, "protected.txt");
    const fresh = path.join(directory, "fresh.txt");
    await Promise.all([
      writeFile(expired, "expired"),
      writeFile(protectedFile, "protected"),
      writeFile(fresh, "fresh"),
    ]);
    const old = new Date(Date.now() - 10 * 60_000);
    await Promise.all([utimes(expired, old, old), utimes(protectedFile, old, old)]);

    const result = await cleanupAttachmentCache(
      directory,
      5 * 60_000,
      [protectedFile],
      Date.now(),
    );

    expect(result.removedFiles).toBe(1);
    await expect(stat(expired)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await stat(protectedFile)).isFile()).toBe(true);
    expect((await stat(fresh)).isFile()).toBe(true);
  });

  it("refuses to clean through a symlinked cache root", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "feishu-codex-symlink-"));
    const target = path.join(directory, "target");
    const root = path.join(directory, "cache");
    await writeFile(target, "not a directory");
    await symlink(target, root);

    await expect(cleanupAttachmentCache(root, 0)).rejects.toThrow(
      "Unsafe attachment cache directory",
    );
  });

  it("bounds launch-agent logs while retaining a private tail", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "feishu-codex-logs-"));
    const log = path.join(directory, "bridge.log");
    await writeFile(log, "x".repeat(2_000));

    expect(await trimRuntimeLogs(directory, 1_000)).toBe(1);
    expect((await stat(log)).size).toBe(0);
    expect((await readFile(`${log}.1`, "utf8")).length).toBeGreaterThan(0);
  });
});
