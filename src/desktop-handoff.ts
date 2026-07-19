import { execFile } from "node:child_process";

const CODEX_BUNDLE_ID = "com.openai.codex";
const THREAD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;

export type DesktopHandoffStatus = "opened" | "unsupported" | "failed";

export interface DesktopHandoffResult {
  status: DesktopHandoffStatus;
  threadId: string;
  url: string;
  fallbackCommand: string;
  reason?: string;
}

export interface DesktopHandoffOptions {
  platform?: NodeJS.Platform;
  launch?: (command: string, args: string[]) => Promise<void>;
}

export function codexThreadUrl(threadId: string): string {
  const safeThreadId = validatedThreadId(threadId);
  return `codex://threads/${encodeURIComponent(safeThreadId)}`;
}

export function codexResumeCommand(threadId: string): string {
  return `codex resume ${validatedThreadId(threadId)}`;
}

export async function openCodexThreadInDesktop(
  threadId: string,
  options: DesktopHandoffOptions = {},
): Promise<DesktopHandoffResult> {
  const url = codexThreadUrl(threadId);
  const fallbackCommand = codexResumeCommand(threadId);
  const platform = options.platform ?? process.platform;
  if (platform !== "darwin") {
    return {
      status: "unsupported",
      threadId,
      url,
      fallbackCommand,
      reason: `当前系统 ${platform} 暂不支持自动定位 Codex 桌面会话`,
    };
  }

  try {
    await (options.launch ?? launchProcess)("open", ["-b", CODEX_BUNDLE_ID, url]);
    return { status: "opened", threadId, url, fallbackCommand };
  } catch (error) {
    return {
      status: "failed",
      threadId,
      url,
      fallbackCommand,
      reason: error instanceof Error ? error.message : "无法启动 Codex 桌面端",
    };
  }
}

function validatedThreadId(threadId: string): string {
  if (!THREAD_ID_PATTERN.test(threadId)) {
    throw new Error("无效的 Codex 会话 ID");
  }
  return threadId;
}

function launchProcess(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout: 15_000, windowsHide: true },
      (error) => (error ? reject(error) : resolve()),
    );
  });
}
