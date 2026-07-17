import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

import type { FeishuCard } from "./task-card.js";
import type { FeishuMessageEvent } from "./types.js";
import { isTransientLarkFailure, larkRetryDelayMs } from "./lark-retry.js";
import { redactSensitiveText } from "./redaction.js";

export interface LarkCliOptions {
  binary: string;
  cwd: string;
  maxReplyChars: number;
  requestTimeoutMs?: number;
  maxRequestAttempts?: number;
}

export interface MessageResource {
  key: string;
  type: "image" | "file";
  localPath: string;
  sizeBytes: number;
}

export interface ConsumerHealth {
  eventKey: string;
  ready: boolean;
  restartCount: number;
  lastReadyAt?: number;
  lastExitAt?: number;
}

export interface LarkApiHealth {
  state: "idle" | "ready" | "degraded";
  consecutiveFailures: number;
  lastSuccessAt?: number;
  lastFailureAt?: number;
  lastError?: string;
}

function childEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1",
    LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1",
  };
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 35))}\n\n[回复过长，已在此处截断]`;
}

function safeIdempotencyKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50);
}

export class LarkCli {
  private readonly consumerHealth = new Map<string, ConsumerHealth>();
  private readonly apiHealth: LarkApiHealth = { state: "idle", consecutiveFailures: 0 };

  constructor(private readonly options: LarkCliOptions) {}

  getConsumerHealth(): ConsumerHealth[] {
    return [...this.consumerHealth.values()].map((health) => ({ ...health }));
  }

  getApiHealth(): LarkApiHealth {
    return { ...this.apiHealth };
  }

  async reply(messageId: string, text: string, idempotencyKey: string): Promise<void> {
    const body = truncate(text, this.options.maxReplyChars);
    await this.run([
      "im",
      "+messages-reply",
      "--message-id",
      messageId,
      "--text",
      body,
      "--as",
      "bot",
      "--idempotency-key",
      safeIdempotencyKey(idempotencyKey),
    ]);
  }

  async replyMarkdown(
    messageId: string,
    markdown: string,
    idempotencyKey: string,
    replyInThread = false,
  ): Promise<string | null> {
    const args = [
      "im",
      "+messages-reply",
      "--message-id",
      messageId,
      "--markdown",
      truncate(markdown, this.options.maxReplyChars),
      "--as",
      "bot",
      "--idempotency-key",
      safeIdempotencyKey(idempotencyKey),
      "--format",
      "json",
    ];
    if (replyInThread) args.push("--reply-in-thread");
    const response = await this.runJson(args);
    return findString(response, "message_id");
  }

  async updateMarkdown(messageId: string, markdown: string): Promise<void> {
    const body = truncate(markdown, this.options.maxReplyChars);
    await this.run([
      "api",
      "PUT",
      `/open-apis/im/v1/messages/${encodeURIComponent(messageId)}`,
      "--as",
      "bot",
      "--data",
      JSON.stringify({
        msg_type: "post",
        content: markdownPostContent(body),
      }),
      "--format",
      "json",
    ]);
  }

  async createCard(card: FeishuCard): Promise<string> {
    const response = await this.runJson([
      "api",
      "POST",
      "/open-apis/cardkit/v1/cards",
      "--as",
      "bot",
      "--data",
      JSON.stringify({ type: "card_json", data: JSON.stringify(card) }),
      "--format",
      "json",
    ]);
    const cardId = findString(response, "card_id");
    if (!cardId) throw new Error("CardKit create response did not include card_id");
    return cardId;
  }

  async replyCard(
    messageId: string,
    cardId: string,
    idempotencyKey: string,
    replyInThread = false,
  ): Promise<string | null> {
    const args = [
      "im",
      "+messages-reply",
      "--message-id",
      messageId,
      "--msg-type",
      "interactive",
      "--content",
      JSON.stringify({ type: "card", data: { card_id: cardId } }),
      "--as",
      "bot",
      "--idempotency-key",
      safeIdempotencyKey(idempotencyKey),
      "--format",
      "json",
    ];
    if (replyInThread) args.push("--reply-in-thread");
    const response = await this.runJson(args);
    return findString(response, "message_id");
  }

  async streamCardContent(
    cardId: string,
    elementId: string,
    content: string,
    sequence: number,
  ): Promise<void> {
    await this.run([
      "api",
      "PUT",
      `/open-apis/cardkit/v1/cards/${encodeURIComponent(cardId)}/elements/${encodeURIComponent(elementId)}/content`,
      "--as",
      "bot",
      "--data",
      JSON.stringify({ uuid: randomUUID(), content, sequence }),
      "--format",
      "json",
    ]);
  }

  async updateCard(cardId: string, card: FeishuCard, sequence: number): Promise<void> {
    await this.run([
      "api",
      "PUT",
      `/open-apis/cardkit/v1/cards/${encodeURIComponent(cardId)}`,
      "--as",
      "bot",
      "--data",
      JSON.stringify({
        card: { type: "card_json", data: JSON.stringify(card) },
        uuid: randomUUID(),
        sequence,
      }),
      "--format",
      "json",
    ]);
  }

  async downloadMessageResources(messageId: string): Promise<MessageResource[]> {
    const resourceRoot = path.resolve(this.options.cwd, "lark-im-resources");
    await ensurePrivateDirectory(resourceRoot);
    const response = await this.runJson([
      "im",
      "+messages-mget",
      "--message-ids",
      messageId,
      "--no-reactions",
      "--download-resources",
      "--as",
      "bot",
      "--format",
      "json",
    ]);
    const canonicalRoot = await realpath(resourceRoot);
    const resources: MessageResource[] = [];
    for (const resource of collectResources(response)) {
      if (resource.error || !resource.local_path) continue;
      const localPath = path.resolve(this.options.cwd, resource.local_path);
      if (!isWithin(resourceRoot, localPath)) {
        console.warn(`[lark] ignored resource outside download directory key=${logRef(resource.key)}`);
        continue;
      }
      try {
        const canonicalPath = await realpath(localPath);
        if (!isWithin(canonicalRoot, canonicalPath)) {
          console.warn(
            `[lark] ignored resource resolving outside download directory key=${logRef(resource.key)}`,
          );
          continue;
        }
        const details = await lstat(canonicalPath);
        if (!details.isFile()) continue;
        await chmod(canonicalPath, 0o600);
        resources.push({
          key: resource.key,
          type: resource.type,
          localPath: canonicalPath,
          sizeBytes: details.size,
        });
      } catch (error) {
        console.warn(
          `[lark] downloaded resource is unavailable key=${logRef(resource.key)}`,
          error,
        );
      }
    }
    return resources;
  }

  async consumeMessages(
    onEvent: (event: unknown) => Promise<void>,
    signal: AbortSignal,
    onReady?: () => void,
  ): Promise<void> {
    await this.consumeEvent("im.message.receive_v1", onEvent, signal, onReady);
  }

  async consumeEvent(
    eventKey: string,
    onEvent: (event: unknown) => Promise<void>,
    signal: AbortSignal,
    onReady?: () => void,
  ): Promise<void> {
    let retryMs = 1_000;
    let hasReportedReady = false;
    const health: ConsumerHealth = { eventKey, ready: false, restartCount: 0 };
    this.consumerHealth.set(eventKey, health);

    while (!signal.aborted) {
      const outcome = await this.consumeOnce(eventKey, onEvent, signal, () => {
        retryMs = 1_000;
        health.ready = true;
        health.lastReadyAt = Date.now();
        if (!hasReportedReady) {
          hasReportedReady = true;
          onReady?.();
        }
      });
      if (signal.aborted) break;
      health.ready = false;
      health.lastExitAt = Date.now();
      health.restartCount += 1;
      console.error(
        `[lark] event consumer ${eventKey} exited code=${outcome.code ?? "null"}; retrying in ${retryMs}ms`,
      );
      await wait(retryMs, signal);
      retryMs = Math.min(retryMs * 2, 30_000);
    }
  }

  private consumeOnce(
    eventKey: string,
    onEvent: (event: unknown) => Promise<void>,
    signal: AbortSignal,
    onReady: () => void,
  ): Promise<{ code: number | null }> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        this.options.binary,
        ["event", "consume", eventKey, "--as", "bot"],
        {
          cwd: this.options.cwd,
          env: childEnvironment(),
          shell: false,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );

      const stdout = readline.createInterface({ input: child.stdout });
      const stderr = readline.createInterface({ input: child.stderr });

      stdout.on("line", (line) => {
        if (!line.trim()) return;
        try {
          const parsed: unknown = JSON.parse(line);
          void onEvent(parsed).catch((error) => {
            console.error("[lark] event handler failed", error);
          });
        } catch (error) {
          console.error("[lark] ignored malformed event JSON", (error as Error).message);
        }
      });

      stderr.on("line", (line) => {
        if (line.includes(`[event] ready event_key=${eventKey}`)) onReady();
        console.error(`[lark-cli] ${redactCliOutput(line)}`);
      });

      let terminateTimer: NodeJS.Timeout | undefined;
      const abort = () => {
        child.stdin.end();
        terminateTimer = setTimeout(() => child.kill("SIGTERM"), 4_000);
        terminateTimer.unref();
      };
      signal.addEventListener("abort", abort, { once: true });

      child.once("error", (error) => {
        signal.removeEventListener("abort", abort);
        if (terminateTimer) clearTimeout(terminateTimer);
        reject(error);
      });
      child.once("exit", (code) => {
        signal.removeEventListener("abort", abort);
        if (terminateTimer) clearTimeout(terminateTimer);
        stdout.close();
        stderr.close();
        resolve({ code });
      });
    });
  }

  private async run(args: string[]): Promise<string> {
    const maxAttempts = Math.max(1, this.options.maxRequestAttempts ?? 3);
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const output = await this.runOnce(args);
        this.apiHealth.state = "ready";
        this.apiHealth.consecutiveFailures = 0;
        this.apiHealth.lastSuccessAt = Date.now();
        delete this.apiHealth.lastError;
        return output;
      } catch (error) {
        lastError = error;
        this.apiHealth.state = "degraded";
        this.apiHealth.consecutiveFailures += 1;
        this.apiHealth.lastFailureAt = Date.now();
        this.apiHealth.lastError = redactCliOutput(
          error instanceof Error ? error.message : String(error),
        ).slice(0, 500);
        if (attempt >= maxAttempts || !isTransientLarkFailure(error)) throw error;
        const delayMs = larkRetryDelayMs(attempt, error);
        console.warn(
          `[lark] transient API failure attempt=${attempt}/${maxAttempts}; retrying in ${delayMs}ms`,
        );
        await delay(delayMs);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private runOnce(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.options.binary, args, {
        cwd: this.options.cwd,
        env: childEnvironment(),
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;
      let forceKillTimer: NodeJS.Timeout | undefined;
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 2_000);
        forceKillTimer.unref();
      }, Math.max(1_000, this.options.requestTimeoutMs ?? 20_000));
      timeout.unref();
      const finish = (operation: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (forceKillTimer) clearTimeout(forceKillTimer);
        operation();
      };
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.once("error", (error) => finish(() => reject(error)));
      child.once("exit", (code) => {
        if (timedOut) {
          finish(() =>
            reject(
              new Error(
                `lark-cli request timed out after ${Math.max(1_000, this.options.requestTimeoutMs ?? 20_000)}ms`,
              ),
            ),
          );
          return;
        }
        if (code === 0) {
          finish(() => resolve(stdout));
          return;
        }
        finish(() =>
          reject(
            new Error(
              `lark-cli exited with code ${code}: ${redactCliOutput(stderr.trim() || stdout.trim())}`,
            ),
          ),
        );
      });
    });
  }

  private async runJson(args: string[]): Promise<unknown> {
    const stdout = await this.run(args);
    try {
      return JSON.parse(stdout) as unknown;
    } catch (error) {
      throw new Error(`Unable to parse lark-cli JSON response: ${(error as Error).message}`);
    }
  }
}

export function markdownPostContent(markdown: string): string {
  const presentation = markdownPostPresentation(markdown);
  return JSON.stringify({
    zh_cn: {
      ...(presentation.title ? { title: presentation.title } : {}),
      content: [[{ tag: "md", text: presentation.body }]],
    },
  });
}

interface MarkdownPostPresentation {
  title?: string;
  body: string;
}

const NATIVE_POST_TITLES = new Set([
  "一句话定位",
  "结论",
  "核心结论",
  "简要回答",
  "回答",
  "建议",
  "原因",
  "结果",
  "下一步",
  "summary",
  "answer",
  "recommendation",
]);

function markdownPostPresentation(markdown: string): MarkdownPostPresentation {
  const source = markdown.trim();
  if (!source) return { body: " " };

  const newlineIndex = source.indexOf("\n");
  const firstLine = (newlineIndex === -1 ? source : source.slice(0, newlineIndex)).trim();
  const remainder = newlineIndex === -1
    ? ""
    : source.slice(newlineIndex + 1).replace(/^\s*\n/, "").trim();

  const heading = firstLine.match(/^#{1,3}\s+(.+)$/);
  if (heading && remainder) {
    const title = cleanPostTitle(heading[1]!);
    if (title) return { title, body: remainder };
  }

  const standaloneBold = firstLine.match(/^\*\*([^*]+)\*\*$/);
  if (standaloneBold && remainder) {
    const title = cleanPostTitle(standaloneBold[1]!);
    if (title && title.length <= 36) return { title, body: remainder };
  }

  const emphasizedLabel = firstLine.match(/^\*\*([^*：:]{1,24})[：:]\*\*\s*(.+)$/);
  if (emphasizedLabel && isNativePostTitle(emphasizedLabel[1]!)) {
    const label = cleanPostTitle(emphasizedLabel[1]!);
    const lead = unwrapOuterBold(emphasizedLabel[2]!);
    return labelledPostPresentation(label, lead, remainder);
  }

  const labelledLead = firstLine.match(/^([^：:]{1,24})[：:]\s*(.+)$/);
  if (labelledLead && isNativePostTitle(labelledLead[1]!)) {
    const label = cleanPostTitle(labelledLead[1]!);
    const lead = unwrapOuterBold(labelledLead[2]!);
    return labelledPostPresentation(label, lead, remainder);
  }

  return { body: source };
}

function isNativePostTitle(value: string): boolean {
  return NATIVE_POST_TITLES.has(cleanPostTitle(value).toLowerCase());
}

function cleanPostTitle(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[\*_`~>#]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

function unwrapOuterBold(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^\*\*([\s\S]+)\*\*([。！？!?.,，；;]?)$/);
  return match ? `${match[1]}${match[2]}`.trim() : trimmed;
}

function labelledPostPresentation(
  label: string,
  lead: string,
  remainder: string,
): MarkdownPostPresentation {
  const conciseLead = cleanPostTitle(lead);
  if (remainder && conciseLead.length >= 4 && conciseLead.length <= 60) {
    return { title: conciseLead, body: remainder };
  }
  return {
    title: label,
    body: joinLeadAndRemainder(lead, remainder),
  };
}

function joinLeadAndRemainder(lead: string, remainder: string): string {
  if (!remainder) return lead || " ";
  if (!lead) return remainder;
  return `${lead}\n\n${remainder}`;
}

async function ensurePrivateDirectory(directory: string): Promise<void> {
  try {
    const details = await lstat(directory);
    if (!details.isDirectory() || details.isSymbolicLink()) {
      throw new Error(`Unsafe resource directory: ${directory}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await mkdir(directory, { recursive: true, mode: 0o700 });
  }
  await chmod(directory, 0o700);
}

interface RawMessageResource {
  key: string;
  type: "image" | "file";
  local_path?: string;
  error?: boolean;
}

function collectResources(value: unknown, result: RawMessageResource[] = []): RawMessageResource[] {
  if (Array.isArray(value)) {
    for (const entry of value) collectResources(entry, result);
    return result;
  }
  if (typeof value !== "object" || value === null) return result;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.resources)) {
    for (const entry of record.resources) {
      if (typeof entry !== "object" || entry === null) continue;
      const candidate = entry as Record<string, unknown>;
      if (
        typeof candidate.key === "string" &&
        (candidate.type === "image" || candidate.type === "file")
      ) {
        result.push({
          key: candidate.key,
          type: candidate.type,
          ...(typeof candidate.local_path === "string"
            ? { local_path: candidate.local_path }
            : {}),
          ...(candidate.error === true ? { error: true } : {}),
        });
      }
    }
  }
  for (const [key, entry] of Object.entries(record)) {
    if (key !== "resources") collectResources(entry, result);
  }
  return result;
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function findString(value: unknown, key: string, depth = 0): string | null {
  if (depth > 6 || typeof value !== "object" || value === null) return null;
  if (!Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (typeof record[key] === "string" && record[key]) return record[key];
    for (const nested of Object.values(record)) {
      const found = findString(nested, key, depth + 1);
      if (found) return found;
    }
    return null;
  }
  for (const nested of value) {
    const found = findString(nested, key, depth + 1);
    if (found) return found;
  }
  return null;
}

async function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    const abort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function eventSummary(event: FeishuMessageEvent): string {
  return `event=${logRef(event.event_id)} chat=${logRef(event.chat_id)} sender=${logRef(event.sender_id)} type=${event.message_type}`;
}

export function logRef(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 10);
}

function redactCliOutput(value: string): string {
  return redactSensitiveText(value, 4_000);
}
