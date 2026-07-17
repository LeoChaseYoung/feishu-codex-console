import { chmod, copyFile, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export function parseEnvEntries(content = "") {
  const entries = {};
  for (const line of content.split(/\r?\n/)) {
    const parsed = parseAssignment(line);
    if (parsed) entries[parsed.key] = decodeEnvValue(parsed.value);
  }
  return entries;
}

export function mergeEnvContent(existing, generated) {
  if (!existing.trim()) return ensureFinalNewline(generated);
  const generatedAssignments = new Map();
  for (const line of generated.split(/\r?\n/)) {
    const parsed = parseAssignment(line);
    if (parsed) generatedAssignments.set(parsed.key, line);
  }

  const seen = new Set();
  const output = [];
  for (const line of existing.split(/\r?\n/)) {
    const parsed = parseAssignment(line);
    if (!parsed || !generatedAssignments.has(parsed.key)) {
      output.push(line);
      continue;
    }
    if (!seen.has(parsed.key)) output.push(generatedAssignments.get(parsed.key));
    seen.add(parsed.key);
  }

  const missing = [...generatedAssignments]
    .filter(([key]) => !seen.has(key))
    .map(([, line]) => line);
  if (missing.length > 0) {
    while (output.at(-1) === "") output.pop();
    output.push("", "# Managed by feishu-codex-console init", ...missing);
  }
  return ensureFinalNewline(output.join("\n"));
}

export async function readEnvFile(file) {
  const content = await readSafeFile(file);
  return content === null ? {} : parseEnvEntries(content);
}

export async function readEnvContent(file) {
  return await readSafeFile(file);
}

export async function writeManagedConfig(file, generated, options = {}) {
  const directory = path.dirname(file);
  await ensurePrivateDirectory(directory);
  const existing = await readSafeFile(file);
  const forceReset = Boolean(options.forceReset);
  const nextContent = existing === null || forceReset
    ? ensureFinalNewline(generated)
    : mergeEnvContent(existing, generated);
  let backupFile;
  if (existing !== null) {
    backupFile = `${file}.bak.${timestamp(options.now ?? new Date())}`;
    await copyFile(file, backupFile);
    await chmod(backupFile, 0o600);
  }

  const temporary = path.join(
    directory,
    `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    await writeFile(temporary, nextContent, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await chmod(temporary, 0o600);
    await rename(temporary, file);
    await chmod(file, 0o600);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return {
    created: existing === null,
    backupFile,
    entries: parseEnvEntries(nextContent),
  };
}

async function readSafeFile(file) {
  try {
    const details = await lstat(file);
    if (!details.isFile() || details.isSymbolicLink()) {
      throw new Error(`Unsafe configuration path: ${file}`);
    }
    return await readFile(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function ensurePrivateDirectory(directory) {
  let created = false;
  let details;
  try {
    details = await lstat(directory);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    details = await lstat(directory);
    created = true;
  }
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error(`Unsafe configuration directory: ${directory}`);
  }
  if (created) await chmod(directory, 0o700);
}

function parseAssignment(line) {
  const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  return match ? { key: match[1], value: match[2] ?? "" } : null;
}

function decodeEnvValue(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replaceAll('\\"', '"').replaceAll("\\\\", "\\");
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1);
  return trimmed;
}

function ensureFinalNewline(value) {
  return `${value.replace(/\n+$/, "")}\n`;
}

function timestamp(value) {
  return value.toISOString().replace(/[:.]/g, "-");
}
