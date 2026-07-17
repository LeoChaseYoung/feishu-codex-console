import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

export interface AttachmentCleanupResult {
  removedFiles: number;
  reclaimedBytes: number;
}

export async function isSupportedImageFile(file: string): Promise<boolean> {
  const handle = await open(file, "r");
  try {
    const header = Buffer.alloc(16);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    const bytes = header.subarray(0, bytesRead);
    const png =
      bytes.length >= 8 &&
      bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const gif =
      bytes.length >= 6 &&
      (bytes.subarray(0, 6).toString("ascii") === "GIF87a" ||
        bytes.subarray(0, 6).toString("ascii") === "GIF89a");
    const webp =
      bytes.length >= 12 &&
      bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
      bytes.subarray(8, 12).toString("ascii") === "WEBP";
    return png || jpeg || gif || webp;
  } finally {
    await handle.close();
  }
}

export async function isUtf8TextFile(file: string): Promise<boolean> {
  try {
    const bytes = await readFile(file);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return !text.includes("\u0000");
  } catch {
    return false;
  }
}

export async function cleanupAttachmentCache(
  rootDirectory: string,
  olderThanMs: number,
  protectedPaths: Iterable<string> = [],
  now = Date.now(),
): Promise<AttachmentCleanupResult> {
  const root = path.resolve(rootDirectory);
  const protectedFiles = new Set([...protectedPaths].map((file) => path.resolve(file)));
  const result: AttachmentCleanupResult = { removedFiles: 0, reclaimedBytes: 0 };
  try {
    const rootDetails = await lstat(root);
    if (!rootDetails.isDirectory() || rootDetails.isSymbolicLink()) {
      throw new Error(`Unsafe attachment cache directory: ${root}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return result;
    throw error;
  }
  await walk(root, true);
  return result;

  async function walk(directory: string, isRoot: boolean): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    await chmod(directory, 0o700);
    for (const entry of entries) {
      const candidate = path.resolve(directory, entry.name);
      if (!isWithin(root, candidate) || entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walk(candidate, false);
        continue;
      }
      if (!entry.isFile() || protectedFiles.has(candidate)) continue;
      let details;
      try {
        details = await lstat(candidate);
      } catch {
        continue;
      }
      if (now - details.mtimeMs < olderThanMs) continue;
      await rm(candidate, { force: true });
      result.removedFiles += 1;
      result.reclaimedBytes += details.size;
    }
    if (!isRoot) {
      try {
        await rm(directory);
      } catch (error) {
        if (!["ENOTEMPTY", "ENOENT"].includes((error as NodeJS.ErrnoException).code ?? "")) {
          throw error;
        }
      }
    }
  }
}

export async function trimRuntimeLogs(logDirectory: string, maxBytes: number): Promise<number> {
  await mkdir(logDirectory, { recursive: true });
  const directoryDetails = await lstat(logDirectory);
  if (!directoryDetails.isDirectory() || directoryDetails.isSymbolicLink()) {
    throw new Error(`Unsafe log directory: ${logDirectory}`);
  }
  await chmod(logDirectory, 0o700);
  let trimmed = 0;
  for (const name of ["bridge.log", "bridge.error.log"]) {
    const file = path.join(logDirectory, name);
    let details;
    try {
      details = await stat(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (!details.isFile()) continue;
    await chmod(file, 0o600);
    if (details.size <= maxBytes) continue;
    const keepBytes = Math.min(Math.max(64 * 1024, Math.floor(maxBytes / 4)), 1024 * 1024);
    const handle = await open(file, "r");
    const tail = Buffer.alloc(Math.min(keepBytes, details.size));
    try {
      await handle.read(tail, 0, tail.length, details.size - tail.length);
    } finally {
      await handle.close();
    }
    await writeFile(`${file}.1`, tail, { mode: 0o600 });
    await writeFile(file, "", { mode: 0o600 });
    await chmod(file, 0o600);
    trimmed += 1;
  }
  return trimmed;
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
