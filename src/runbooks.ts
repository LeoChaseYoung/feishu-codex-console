import { readFile } from "node:fs/promises";
import path from "node:path";

import { externalActionsForPrompt } from "./policy.js";
import type { ReasoningEffort, SandboxMode } from "./types.js";

export const RUNBOOK_FILE = ".feishu-codex-runbooks.json";
const MAX_RUNBOOK_FILE_BYTES = 256 * 1024;
const MAX_RUNBOOKS = 30;

export interface RunbookParameter {
  name: string;
  label: string;
  description?: string;
  required: boolean;
  defaultValue?: string;
}

export interface RunbookDefinition {
  id: string;
  name: string;
  description: string;
  prompt: string;
  sandboxMode?: Exclude<SandboxMode, "danger-full-access">;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  parameters: RunbookParameter[];
}

export interface RunbookCatalog {
  file: string;
  status: "ready" | "missing" | "invalid";
  runbooks: RunbookDefinition[];
  error?: string;
}

export interface RunbookInvocation {
  id: string;
  values: Record<string, string>;
}

export async function loadProjectRunbooks(projectPath: string): Promise<RunbookCatalog> {
  const file = path.join(projectPath, RUNBOOK_FILE);
  try {
    const source = await readFile(file);
    if (source.byteLength > MAX_RUNBOOK_FILE_BYTES) {
      throw new Error(`${RUNBOOK_FILE} 不能超过 ${MAX_RUNBOOK_FILE_BYTES / 1024} KB`);
    }
    return { file, status: "ready", runbooks: parseRunbookCatalog(source.toString("utf8")) };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { file, status: "missing", runbooks: [] };
    return {
      file,
      status: "invalid",
      runbooks: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function parseRunbookCatalog(source: string): RunbookDefinition[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error(`${RUNBOOK_FILE} 不是有效 JSON`);
  }
  if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.runbooks)) {
    throw new Error(`${RUNBOOK_FILE} 必须包含 version: 1 和 runbooks 数组`);
  }
  if (parsed.runbooks.length > MAX_RUNBOOKS) {
    throw new Error(`每个项目最多配置 ${MAX_RUNBOOKS} 个运行手册`);
  }
  const ids = new Set<string>();
  return parsed.runbooks.map((raw, index) => {
    if (!isRecord(raw)) throw new Error(`runbooks[${index}] 必须是对象`);
    const id = requiredString(raw.id, `runbooks[${index}].id`, 40);
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id)) {
      throw new Error(`运行手册 ID ${id} 只能包含字母、数字、下划线和连字符`);
    }
    if (ids.has(id)) throw new Error(`运行手册 ID 重复：${id}`);
    ids.add(id);
    const prompt = requiredString(raw.prompt, `${id}.prompt`, 8_000);
    if (externalActionsForPrompt(prompt).length > 0) {
      throw new Error(
        `${id}.prompt 包含提交、推送、部署或 PR 动作；一键运行手册不允许预授权外部动作`,
      );
    }
    const sandboxMode = optionalEnum(
      raw.sandboxMode,
      ["read-only", "workspace-write"] as const,
      `${id}.sandboxMode`,
    );
    const reasoningEffort = optionalEnum(
      raw.reasoningEffort,
      ["minimal", "low", "medium", "high", "xhigh", "ultra"] as const,
      `${id}.reasoningEffort`,
    );
    const parameters = parseParameters(raw.parameters, id);
    assertPromptParameters(prompt, parameters, id);
    return {
      id,
      name: requiredString(raw.name, `${id}.name`, 60),
      description: optionalString(raw.description, `${id}.description`, 180) ?? "团队审核过的任务模板",
      prompt,
      ...(sandboxMode ? { sandboxMode } : {}),
      ...(typeof raw.model === "string" && raw.model.trim()
        ? { model: requiredString(raw.model, `${id}.model`, 100) }
        : {}),
      ...(reasoningEffort ? { reasoningEffort } : {}),
      parameters,
    };
  });
}

export function parseRunbookInvocation(prompt: string): RunbookInvocation | null {
  const match = prompt
    .trim()
    .match(/^(?:运行手册|运行|run|\/run)\s+([a-z0-9][a-z0-9_-]*)(?:\s+(.+))?$/i);
  if (!match?.[1]) return null;
  const values: Record<string, string> = {};
  const source = match[2]?.trim() ?? "";
  if (source) {
    const tokenPattern = /([a-z][a-z0-9_-]*)=("[^"]*"|'[^']*'|\S+)/gi;
    let consumed = "";
    for (const token of source.matchAll(tokenPattern)) {
      const whole = token[0];
      const name = token[1];
      const rawValue = token[2];
      if (!whole || !name || rawValue === undefined) continue;
      consumed += `${whole} `;
      values[name] = unquote(rawValue).slice(0, 500);
    }
    const normalizedSource = source.replace(/\s+/g, " ").trim();
    const normalizedConsumed = consumed.replace(/\s+/g, " ").trim();
    if (normalizedSource !== normalizedConsumed) return null;
  }
  return { id: match[1], values };
}

export function renderRunbookPrompt(
  runbook: RunbookDefinition,
  values: Record<string, string> = {},
): string {
  const known = new Set(runbook.parameters.map((parameter) => parameter.name));
  const unknown = Object.keys(values).find((name) => !known.has(name));
  if (unknown) throw new Error(`运行手册不支持参数：${unknown}`);
  let prompt = runbook.prompt;
  for (const parameter of runbook.parameters) {
    const value = values[parameter.name]?.trim() || parameter.defaultValue;
    if (parameter.required && !value) throw new Error(`缺少参数：${parameter.label}`);
    const replacement = value ?? "";
    prompt = prompt.replaceAll(`{{${parameter.name}}}`, replacement);
  }
  return prompt;
}

export function runbookHasDefaultInputs(runbook: RunbookDefinition): boolean {
  return runbook.parameters.every(
    (parameter) => !parameter.required || Boolean(parameter.defaultValue),
  );
}

function parseParameters(value: unknown, runbookId: string): RunbookParameter[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 12) {
    throw new Error(`${runbookId}.parameters 必须是最多 12 项的数组`);
  }
  const names = new Set<string>();
  return value.map((raw, index) => {
    if (!isRecord(raw)) throw new Error(`${runbookId}.parameters[${index}] 必须是对象`);
    const name = requiredString(raw.name, `${runbookId}.parameters[${index}].name`, 40);
    if (!/^[a-z][a-z0-9_-]*$/i.test(name)) {
      throw new Error(`参数名 ${name} 格式无效`);
    }
    if (names.has(name)) throw new Error(`参数名重复：${name}`);
    names.add(name);
    const defaultValue = optionalString(
      raw.default,
      `${runbookId}.${name}.default`,
      500,
    );
    return {
      name,
      label: requiredString(raw.label, `${runbookId}.${name}.label`, 60),
      ...(typeof raw.description === "string" && raw.description.trim()
        ? {
            description: requiredString(
              raw.description,
              `${runbookId}.${name}.description`,
              120,
            ),
          }
        : {}),
      required: raw.required === true,
      ...(defaultValue !== undefined ? { defaultValue } : {}),
    };
  });
}

function assertPromptParameters(
  prompt: string,
  parameters: RunbookParameter[],
  runbookId: string,
): void {
  const declared = new Set(parameters.map((parameter) => parameter.name));
  const placeholders = [...prompt.matchAll(/\{\{([a-z][a-z0-9_-]*)\}\}/gi)].map(
    (match) => match[1]!,
  );
  const undeclared = placeholders.find((name) => !declared.has(name));
  if (undeclared) throw new Error(`${runbookId}.prompt 使用了未声明参数：${undeclared}`);
  const unused = parameters.find((parameter) => !placeholders.includes(parameter.name));
  if (unused) throw new Error(`${runbookId}.parameters 声明了未使用参数：${unused.name}`);
}

function requiredString(value: unknown, name: string, max: number): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} 必须是非空字符串`);
  const normalized = value.trim();
  if (normalized.length > max) throw new Error(`${name} 不能超过 ${max} 个字符`);
  return normalized;
}

function optionalString(value: unknown, name: string, max: number): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, name, max);
}

function optionalEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  name: string,
): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`${name} 必须是：${allowed.join("、")}`);
  }
  return value as T;
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
