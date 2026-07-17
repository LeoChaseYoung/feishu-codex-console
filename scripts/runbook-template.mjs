import { constants } from "node:fs";
import { chmod, copyFile, lstat } from "node:fs/promises";
import path from "node:path";

export const RUNBOOK_TEMPLATE_NAME = ".feishu-codex-runbooks.json";

export async function initializeRunbookTemplate({ projectDir, sourceFile }) {
  const project = path.resolve(projectDir);
  const source = path.resolve(sourceFile);
  await assertDirectory(project, "项目目录");
  await assertRegularFile(source, "运行手册示例");
  const target = path.join(project, RUNBOOK_TEMPLATE_NAME);

  try {
    await copyFile(source, target, constants.COPYFILE_EXCL);
    await chmod(target, 0o644);
    return { created: true, target };
  } catch (error) {
    if (error?.code === "EEXIST") return { created: false, target };
    throw error;
  }
}

async function assertDirectory(directory, label) {
  const details = await lstat(directory).catch(() => null);
  if (!details?.isDirectory() || details.isSymbolicLink()) {
    throw new Error(`${label}不存在或不是安全目录：${directory}`);
  }
}

async function assertRegularFile(file, label) {
  const details = await lstat(file).catch(() => null);
  if (!details?.isFile() || details.isSymbolicLink()) {
    throw new Error(`${label}不存在或不是安全文件：${file}`);
  }
}
