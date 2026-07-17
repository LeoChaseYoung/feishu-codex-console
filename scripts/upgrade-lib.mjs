export function assessUpgradeReadiness(options) {
  const currentVersion = normalizeVersion(options.currentVersion);
  const targetVersion = normalizeVersion(options.targetVersion);
  const activeTasks = Math.max(
    Number(options.healthActiveTasks ?? 0),
    Number(options.databaseActiveTasks ?? 0),
  );
  const warnings = [];
  if (activeTasks > 0) {
    return {
      allowed: false,
      reason: `仍有 ${activeTasks} 个运行任务；请等待完成或在飞书停止后再升级`,
      currentVersion,
      targetVersion,
      warnings,
    };
  }
  if (currentVersion === "unknown") {
    warnings.push("当前服务未报告产品版本；数据仍会先备份，但失败时可能需要手工恢复旧包");
  } else {
    const direction = compareVersions(targetVersion, currentVersion);
    if (direction < 0 && !options.allowDowngrade) {
      return {
        allowed: false,
        reason: `目标 ${targetVersion} 低于当前 ${currentVersion}；降级需要 --allow-downgrade`,
        currentVersion,
        targetVersion,
        warnings,
      };
    }
    if (direction === 0 && !options.force) {
      return {
        allowed: false,
        upToDate: true,
        reason: `当前服务已经是 ${targetVersion}`,
        currentVersion,
        targetVersion,
        warnings,
      };
    }
  }
  return {
    allowed: true,
    currentVersion,
    targetVersion,
    warnings,
  };
}

export function parseBackupId(output) {
  const match = String(output).match(/备份 ID[：:]\s*([^\s]+)/);
  return match?.[1] ?? null;
}

export function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < 3; index += 1) {
    const delta = (a.core[index] ?? 0) - (b.core[index] ?? 0);
    if (delta !== 0) return Math.sign(delta);
  }
  if (a.pre.length === 0 && b.pre.length > 0) return 1;
  if (a.pre.length > 0 && b.pre.length === 0) return -1;
  const length = Math.max(a.pre.length, b.pre.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = a.pre[index];
    const rightPart = b.pre[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumber = Number(leftPart);
    const rightNumber = Number(rightPart);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
      return Math.sign(leftNumber - rightNumber);
    }
    if (Number.isFinite(leftNumber)) return -1;
    if (Number.isFinite(rightNumber)) return 1;
    return leftPart.localeCompare(rightPart);
  }
  return 0;
}

function normalizeVersion(value) {
  if (!value || value === "unknown") return "unknown";
  const normalized = String(value).trim().replace(/^v/, "");
  versionParts(normalized);
  return normalized;
}

function versionParts(value) {
  const match = String(value).match(
    /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/,
  );
  if (!match) throw new Error(`无效版本号：${value}`);
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4]?.split(".") ?? [],
  };
}
