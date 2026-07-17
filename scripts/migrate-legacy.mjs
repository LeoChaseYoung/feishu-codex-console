import path from "node:path";

import {
  mergeEnvContent,
  parseEnvEntries,
  readEnvContent,
  writeManagedConfig,
} from "./config-file.mjs";
import { defaultSetupPaths, envValue, normalizeInstanceId, splitCsv, validateOpenIds } from "./setup-lib.mjs";

const SINGLE_PATH_KEYS = [
  "CODEX_PROJECT_STATE_FILE",
  "BRIDGE_DATABASE_FILE",
  "BRIDGE_STATE_FILE",
  "CODEX_CLI_PATH",
  "LARK_CLI_PATH",
];

export async function migrateLegacyInstallation({
  sourceDir,
  sourceConfig,
  targetConfig,
  instance,
  home,
  allowExisting = false,
  now,
}) {
  const legacyRoot = path.resolve(sourceDir);
  const legacyConfig = sourceConfig
    ? path.isAbsolute(sourceConfig)
      ? path.normalize(sourceConfig)
      : path.resolve(legacyRoot, sourceConfig)
    : path.join(legacyRoot, ".env");
  const sourceContent = await readEnvContent(legacyConfig);
  if (sourceContent === null) throw new Error(`没有找到旧源码配置：${legacyConfig}`);
  const entries = parseEnvEntries(sourceContent);
  validateLegacyEntries(entries, legacyConfig);

  const instanceId = normalizeInstanceId(instance ?? entries.BRIDGE_INSTANCE_ID ?? "default");
  const defaults = defaultSetupPaths(instanceId, home);
  const destination = path.resolve(targetConfig ?? defaults.configFile);
  if (destination === legacyConfig) {
    throw new Error("迁移目标不能与旧源码 .env 相同。请使用新的用户配置目录。");
  }
  const existingTarget = await readEnvContent(destination);
  if (existingTarget !== null && !allowExisting) {
    throw new Error(`目标配置已存在：${destination}。确认合并时添加 --force。`);
  }

  const dataDir = resolveLegacyPath(entries.BRIDGE_DATA_DIR, legacyRoot, path.join(legacyRoot, "var"));
  const workdir = resolveLegacyPath(entries.CODEX_WORKDIR, legacyRoot);
  const overrides = [
    "# Migrated by feishu-codex-console. The legacy source directory remains unchanged.",
    `BRIDGE_INSTANCE_ID=${envValue(instanceId)}`,
    `BRIDGE_DATA_DIR=${envValue(dataDir)}`,
    `CODEX_WORKDIR=${envValue(workdir)}`,
  ];
  const roots = splitCsv(entries.CODEX_PROJECT_ROOTS ?? "").map((root) =>
    resolveLegacyPath(root, legacyRoot),
  );
  if (roots.length > 0) overrides.push(`CODEX_PROJECT_ROOTS=${envValue(roots.join(","))}`);
  for (const key of SINGLE_PATH_KEYS) {
    const value = entries[key]?.trim();
    if (value) overrides.push(`${key}=${envValue(resolveLegacyPath(value, legacyRoot))}`);
  }

  const migratedContent = mergeEnvContent(sourceContent, `${overrides.join("\n")}\n`);
  const writeResult = await writeManagedConfig(destination, migratedContent, {
    ...(now ? { now } : {}),
  });
  return {
    sourceDir: legacyRoot,
    sourceConfig: legacyConfig,
    targetConfig: destination,
    instanceId,
    dataDir,
    workdir,
    reusedLegacyData: true,
    backupFile: writeResult.backupFile,
  };
}

function validateLegacyEntries(entries, configFile) {
  if (!entries.ALLOWED_FEISHU_OPEN_IDS?.trim()) {
    throw new Error(`旧配置缺少 ALLOWED_FEISHU_OPEN_IDS：${configFile}`);
  }
  validateOpenIds(entries.ALLOWED_FEISHU_OPEN_IDS, "旧配置操作者 open_id");
  if (!entries.CODEX_WORKDIR?.trim()) {
    throw new Error(`旧配置缺少 CODEX_WORKDIR：${configFile}`);
  }
}

function resolveLegacyPath(value, legacyRoot, fallback) {
  const selected = value?.trim() || fallback;
  if (!selected) throw new Error("旧配置包含空路径。");
  return path.isAbsolute(selected) ? path.normalize(selected) : path.resolve(legacyRoot, selected);
}
