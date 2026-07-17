import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import readline from "node:readline";

import { redactSensitiveText, safeErrorText } from "./redaction.js";

export type JsonRpcId = string | number;

export interface AppServerNotification {
  method: string;
  params?: unknown;
}

export interface AppServerRequest {
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface AppServerCommand {
  command: string;
  args: string[];
}

export interface AppServerClientOptions {
  env: NodeJS.ProcessEnv;
  command?: AppServerCommand;
  requestTimeoutMs?: number;
  onNotification?: (notification: AppServerNotification) => void;
  onRequest?: (request: AppServerRequest) => Promise<unknown>;
  onExit?: (error: Error) => void;
}

export interface AppServerHealth {
  ready: boolean;
  pid?: number;
  startedAt?: number;
  restartCount: number;
  lastExitAt?: number;
  lastError?: string;
}

interface PendingCall {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

interface RpcResponse {
  id: JsonRpcId;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

export class AppServerRpcError extends Error {
  constructor(
    message: string,
    readonly code?: number,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = "AppServerRpcError";
  }
}

export class CodexAppServerClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private lines: readline.Interface | null = null;
  private nextId = 1;
  private pending = new Map<string, PendingCall>();
  private startPromise: Promise<void> | null = null;
  private closing = false;
  private readonly health: AppServerHealth = { ready: false, restartCount: 0 };

  constructor(private readonly options: AppServerClientOptions) {}

  async start(): Promise<void> {
    if (this.health.ready && this.child) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startInternal().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  async request<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T> {
    await this.start();
    return this.sendRequest<T>(method, params, timeoutMs);
  }

  notify(method: string, params?: unknown): void {
    if (!this.child || !this.child.stdin.writable) {
      throw new Error("Codex app-server is not connected");
    }
    this.write({ method, ...(params === undefined ? {} : { params }) });
  }

  getHealth(): AppServerHealth {
    return { ...this.health };
  }

  async close(): Promise<void> {
    this.closing = true;
    this.health.ready = false;
    const child = this.child;
    if (!child) return;
    this.child = null;
    this.lines?.close();
    this.lines = null;
    rejectPending(this.pending, new Error("Codex app-server closed"));
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
        resolve();
      }, 2_000);
      timer.unref();
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill("SIGTERM");
    });
  }

  private async startInternal(): Promise<void> {
    this.closing = false;
    const command = this.options.command ?? resolveBundledCodexCommand();
    const child = spawn(command.command, command.args, {
      env: this.options.env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    this.health.ready = false;
    this.health.startedAt = Date.now();
    if (child.pid !== undefined) this.health.pid = child.pid;
    else delete this.health.pid;
    delete this.health.lastError;

    let stderrTail = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderrTail = `${stderrTail}${chunk}`.slice(-4_000);
      for (const line of chunk.split(/\r?\n/).filter(Boolean)) {
        console.error(`[codex-app-server] ${redactSensitiveText(line, 1_000)}`);
      }
    });

    const spawned = new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.once("exit", (code, signal) => {
      this.handleExit(child, code, signal, stderrTail);
    });

    this.lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    this.lines.on("line", (line) => this.handleLine(line));

    try {
      await spawned;
      await this.sendRequest(
        "initialize",
        {
          clientInfo: {
            name: "feishu_codex_bridge",
            title: "Feishu Remote for Codex",
            version: "1.0.0-beta.2",
          },
          capabilities: {
            experimentalApi: true,
            requestAttestation: false,
          },
        },
        20_000,
      );
      this.notify("initialized", {});
      this.health.ready = true;
    } catch (error) {
      this.health.lastError = safeErrorText(error);
      if (!child.killed) child.kill("SIGTERM");
      throw error;
    }
  }

  private sendRequest<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T> {
    if (!this.child || !this.child.stdin.writable) {
      return Promise.reject(new Error("Codex app-server is not connected"));
    }
    const id = this.nextId++;
    const timeout = setTimeout(() => {
      const pending = this.pending.get(String(id));
      if (!pending) return;
      this.pending.delete(String(id));
      pending.reject(new Error(`Codex app-server request timed out: ${method}`));
    }, timeoutMs ?? this.options.requestTimeoutMs ?? 30_000);
    timeout.unref();

    const result = new Promise<T>((resolve, reject) => {
      this.pending.set(String(id), {
        method,
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      });
    });
    try {
      this.write({ method, id, ...(params === undefined ? {} : { params }) });
    } catch (error) {
      clearTimeout(timeout);
      this.pending.delete(String(id));
      return Promise.reject(error);
    }
    return result;
  }

  private write(message: unknown): void {
    const child = this.child;
    if (!child || !child.stdin.writable) throw new Error("Codex app-server stdin is unavailable");
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleLine(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      console.error(
        `[codex-app-server] ignored non-JSON output: ${redactSensitiveText(line, 500)}`,
      );
      return;
    }
    if (!isRecord(message)) return;
    if ((typeof message.id === "string" || typeof message.id === "number") && !message.method) {
      this.handleResponse(message as unknown as RpcResponse);
      return;
    }
    if (typeof message.method !== "string") return;
    if (typeof message.id === "string" || typeof message.id === "number") {
      void this.handleServerRequest({
        id: message.id,
        method: message.method,
        ...(message.params === undefined ? {} : { params: message.params }),
      });
      return;
    }
    try {
      this.options.onNotification?.({
        method: message.method,
        ...(message.params === undefined ? {} : { params: message.params }),
      });
    } catch (error) {
      console.error(`[codex-app-server] notification handler failed method=${message.method}`, error);
    }
  }

  private handleResponse(response: RpcResponse): void {
    const pending = this.pending.get(String(response.id));
    if (!pending) return;
    this.pending.delete(String(response.id));
    clearTimeout(pending.timeout);
    if (response.error) {
      pending.reject(
        new AppServerRpcError(
          response.error.message ?? `Codex app-server request failed: ${pending.method}`,
          response.error.code,
          response.error.data,
        ),
      );
      return;
    }
    pending.resolve(response.result);
  }

  private async handleServerRequest(request: AppServerRequest): Promise<void> {
    try {
      if (!this.options.onRequest) {
        throw new AppServerRpcError(`Unsupported server request: ${request.method}`, -32601);
      }
      const result = await this.options.onRequest(request);
      this.write({ id: request.id, result });
    } catch (error) {
      const rpcError = error instanceof AppServerRpcError ? error : null;
      try {
        this.write({
          id: request.id,
          error: {
            code: rpcError?.code ?? -32000,
            message: safeErrorText(error),
            ...(rpcError?.data === undefined ? {} : { data: rpcError.data }),
          },
        });
      } catch (writeError) {
        console.error(
          `[codex-app-server] unable to answer request method=${request.method}`,
          writeError,
        );
      }
    }
  }

  private handleExit(
    child: ChildProcessWithoutNullStreams,
    code: number | null,
    signal: NodeJS.Signals | null,
    stderrTail: string,
  ): void {
    if (this.child !== child) return;
    this.child = null;
    this.lines?.close();
    this.lines = null;
    this.health.ready = false;
    delete this.health.pid;
    this.health.lastExitAt = Date.now();
    if (!this.closing) this.health.restartCount += 1;
    const detail = signal ? `signal ${signal}` : `code ${code ?? 1}`;
    const suffix = stderrTail.trim()
      ? `: ${redactSensitiveText(stderrTail.trim().slice(-1_000))}`
      : "";
    const error = new Error(`Codex app-server exited with ${detail}${suffix}`);
    this.health.lastError = error.message;
    rejectPending(this.pending, error);
    if (!this.closing) this.options.onExit?.(error);
  }
}

export function resolveBundledCodexCommand(extraArgs: string[] = []): AppServerCommand {
  const require = createRequire(import.meta.url);
  const packageJson = require.resolve("@openai/codex/package.json");
  return {
    command: process.execPath,
    args: [path.join(path.dirname(packageJson), "bin", "codex.js"), "app-server", ...extraArgs],
  };
}

function rejectPending(pending: Map<string, PendingCall>, error: Error): void {
  for (const call of pending.values()) {
    clearTimeout(call.timeout);
    call.reject(error);
  }
  pending.clear();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
