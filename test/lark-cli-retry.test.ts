import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { LarkCli, markdownPostContent } from "../src/lark-cli.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fakeCli(source: string): Promise<{ directory: string; executable: string }> {
  const directory = await mkdtemp(path.join(tmpdir(), "fake-lark-cli-"));
  temporaryDirectories.push(directory);
  const executable = path.join(directory, "lark-cli.mjs");
  await writeFile(executable, `#!/usr/bin/env node\n${source}\n`, { mode: 0o700 });
  await chmod(executable, 0o700);
  return { directory, executable };
}

describe("Lark CLI request retry", () => {
  it("sends natural Markdown replies in the Feishu thread and can update them", async () => {
    const { directory, executable } = await fakeCli(`
      import { appendFileSync } from "node:fs";
      import path from "node:path";
      import { fileURLToPath } from "node:url";
      const log = path.join(path.dirname(fileURLToPath(import.meta.url)), "args.ndjson");
      appendFileSync(log, JSON.stringify(process.argv.slice(2)) + "\\n");
      if (process.argv.includes("+messages-reply")) {
        process.stdout.write(JSON.stringify({ data: { message_id: "om-natural" } }));
      }
    `);
    const lark = new LarkCli({
      binary: executable,
      cwd: directory,
      maxReplyChars: 1_000,
      requestTimeoutMs: 2_000,
    });

    await expect(
      lark.replyMarkdown("om-root", "**正在思考**", "natural", true),
    ).resolves.toBe("om-natural");
    await expect(lark.updateMarkdown("om-natural", "回答完成")).resolves.toBeUndefined();

    const calls = (await readFile(path.join(directory, "args.ndjson"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[]);
    expect(calls[0]).toContain("--reply-in-thread");
    expect(calls[0]).toContain("--markdown");
    expect(calls[1]).toContain("PUT");
    expect(calls[1]).toContain("/open-apis/im/v1/messages/om-natural");
    expect(calls[1]).toContain(JSON.stringify({
      msg_type: "post",
      content: markdownPostContent("回答完成"),
    }));
  });

  it("retries transient failures and returns to healthy after success", async () => {
    const { directory, executable } = await fakeCli(`
      import { readFileSync, writeFileSync } from "node:fs";
      import path from "node:path";
      import { fileURLToPath } from "node:url";
      const counter = path.join(path.dirname(fileURLToPath(import.meta.url)), "count");
      let attempts = 0;
      try { attempts = Number(readFileSync(counter, "utf8")); } catch {}
      attempts += 1;
      writeFileSync(counter, String(attempts));
      if (attempts < 3) {
        console.error("HTTP 503 Retry-After: 1ms");
        process.exit(1);
      }
    `);
    const lark = new LarkCli({
      binary: executable,
      cwd: directory,
      maxReplyChars: 1_000,
      maxRequestAttempts: 3,
      requestTimeoutMs: 2_000,
    });

    await expect(lark.reply("om-test", "hello", "retry-test")).resolves.toBeUndefined();
    expect(await readFile(path.join(directory, "count"), "utf8")).toBe("3");
    expect(lark.getApiHealth()).toMatchObject({ state: "ready", consecutiveFailures: 0 });
  });

  it("promotes concise lead conclusions into native post titles", () => {
    expect(JSON.parse(markdownPostContent(
      "一句话定位：**统一前端门户和后续 AIGC 业务开发底座。**\n\n目前仍处于 MVP 阶段。",
    ))).toEqual({
      zh_cn: {
        title: "统一前端门户和后续 AIGC 业务开发底座。",
        content: [[{
          tag: "md",
          text: "目前仍处于 MVP 阶段。",
        }]],
      },
    });

    expect(JSON.parse(markdownPostContent(
      "## 核心建议\n\n先把普通问答做得像聊天。",
    ))).toEqual({
      zh_cn: {
        title: "核心建议",
        content: [[{
          tag: "md",
          text: "先把普通问答做得像聊天。",
        }]],
      },
    });
  });

  it("leaves ordinary Markdown without a synthetic title", () => {
    expect(JSON.parse(markdownPostContent("这是普通回答。"))).toEqual({
      zh_cn: {
        content: [[{ tag: "md", text: "这是普通回答。" }]],
      },
    });
  });

  it("does not retry a permanent permission failure", async () => {
    const { directory, executable } = await fakeCli(`
      import { writeFileSync } from "node:fs";
      import path from "node:path";
      import { fileURLToPath } from "node:url";
      writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "count"), "1");
      console.error("permission denied");
      process.exit(1);
    `);
    const lark = new LarkCli({
      binary: executable,
      cwd: directory,
      maxReplyChars: 1_000,
      maxRequestAttempts: 3,
      requestTimeoutMs: 2_000,
    });

    await expect(lark.reply("om-test", "hello", "permission-test")).rejects.toThrow(
      "permission denied",
    );
    expect(await readFile(path.join(directory, "count"), "utf8")).toBe("1");
    expect(lark.getApiHealth()).toMatchObject({ state: "degraded", consecutiveFailures: 1 });
  });
});
