import { spawn } from "node:child_process";

export function parseDiscoveryEvent(line) {
  let value;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  if (value.type !== "im.message.receive_v1") return null;
  if (value.sender_type && value.sender_type !== "user") return null;
  if (typeof value.sender_id !== "string" || !/^ou_[A-Za-z0-9_-]+$/.test(value.sender_id)) {
    return null;
  }
  if (typeof value.chat_id !== "string" || !/^oc_[A-Za-z0-9_-]+$/.test(value.chat_id)) {
    return null;
  }
  if (value.chat_type !== "p2p" && value.chat_type !== "group") return null;
  return {
    senderId: value.sender_id,
    chatId: value.chat_id,
    chatType: value.chat_type,
    messageId: typeof value.message_id === "string" ? value.message_id : undefined,
  };
}

export function discoveryCommandArgs(timeout = "2m") {
  return [
    "event",
    "consume",
    "im.message.receive_v1",
    "--as",
    "bot",
    "--max-events",
    "1",
    "--timeout",
    timeout,
    "--quiet",
  ];
}

export function discoverFeishuIdentity(cliPath, options = {}) {
  const timeout = options.timeout ?? "2m";
  const cwd = options.cwd ?? process.cwd();
  const child = spawn(cliPath, discoveryCommandArgs(timeout), {
    cwd,
    env: options.env ?? process.env,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((resolve, reject) => {
    let buffer = "";
    let stderr = "";
    let discovered = null;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      while (buffer.includes("\n")) {
        const newline = buffer.indexOf("\n");
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        discovered ??= parseDiscoveryEvent(line);
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) => reject(error));
    child.once("exit", (code) => {
      discovered ??= parseDiscoveryEvent(buffer.trim());
      if (discovered) resolve(discovered);
      else if (code === 0) resolve(null);
      else reject(new Error(stderr.trim() || `lark-cli 退出，状态码 ${code ?? "unknown"}`));
    });
  });
}
