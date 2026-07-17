import { execFile, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface RemoteReadyStatus {
  supported: boolean;
  enabled: boolean;
  active: boolean;
  pid?: number;
  lastError?: string;
}

export interface PowerStatus {
  source: "ac" | "battery" | "unknown";
  percent?: number;
  label: string;
}

export class RemoteReadyController {
  private child: ChildProcess | null = null;
  private enabled = false;
  private lastError?: string;

  get supported(): boolean {
    return process.platform === "darwin";
  }

  async setEnabled(enabled: boolean): Promise<RemoteReadyStatus> {
    this.enabled = enabled;
    if (!enabled) {
      this.stopAssertion();
      return this.getStatus();
    }
    if (!this.supported) {
      this.lastError = "Remote Ready 当前仅支持 macOS caffeinate";
      return this.getStatus();
    }
    if (this.child && this.child.exitCode === null && !this.child.killed) return this.getStatus();

    await new Promise<void>((resolve, reject) => {
      const child = execCaffeinate();
      this.child = child;
      const onError = (error: Error) => {
        if (this.child === child) this.child = null;
        this.lastError = error.message;
        reject(error);
      };
      child.once("error", onError);
      child.once("spawn", () => {
        child.off("error", onError);
        delete this.lastError;
        resolve();
      });
      child.once("exit", (code, signal) => {
        if (this.child !== child) return;
        this.child = null;
        if (this.enabled && code !== 0) {
          this.lastError = `caffeinate 已退出（${signal ?? code ?? "unknown"}）`;
        }
      });
    });
    return this.getStatus();
  }

  getStatus(): RemoteReadyStatus {
    const active = Boolean(this.child && this.child.exitCode === null && !this.child.killed);
    return {
      supported: this.supported,
      enabled: this.enabled,
      active,
      ...(active && this.child?.pid !== undefined ? { pid: this.child.pid } : {}),
      ...(this.lastError ? { lastError: this.lastError } : {}),
    };
  }

  close(): void {
    this.enabled = false;
    this.stopAssertion();
  }

  private stopAssertion(): void {
    const child = this.child;
    this.child = null;
    if (child && child.exitCode === null && !child.killed) child.kill("SIGTERM");
  }
}

export async function readPowerStatus(): Promise<PowerStatus> {
  if (process.platform !== "darwin") {
    return { source: "unknown", label: "电源状态不可用" };
  }
  try {
    const { stdout } = await execFileAsync("/usr/bin/pmset", ["-g", "batt"], {
      timeout: 3_000,
    });
    return parsePowerStatus(stdout);
  } catch {
    return { source: "unknown", label: "电源状态不可用" };
  }
}

export function parsePowerStatus(output: string): PowerStatus {
  const source = /AC Power/i.test(output)
    ? "ac"
    : /Battery Power/i.test(output)
      ? "battery"
      : "unknown";
  const percentMatch = output.match(/(\d{1,3})%/);
  const rawPercent = percentMatch?.[1]
    ? Number.parseInt(percentMatch[1], 10)
    : undefined;
  const percent = rawPercent !== undefined
    ? Math.max(0, Math.min(100, rawPercent))
    : undefined;
  return {
    source,
    ...(percent !== undefined ? { percent } : {}),
    label:
      source === "ac"
        ? `外接电源${percent !== undefined ? ` · ${percent}%` : ""}`
        : source === "battery"
          ? `电池供电${percent !== undefined ? ` · ${percent}%` : ""}`
          : "电源状态未知",
  };
}

function execCaffeinate(): ChildProcess {
  return spawn("/usr/bin/caffeinate", ["-i", "-w", String(process.pid)], {
    shell: false,
    stdio: "ignore",
  });
}
