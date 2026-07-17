import type { CodexModel } from "./codex-runner.js";
import type { TaskExecutionSettings } from "./types.js";

export interface CompatibleModelSettings {
  settings: TaskExecutionSettings;
  effectiveModel?: CodexModel;
  notices: string[];
}

export function resolveModelPreference(
  conversationModel: string | undefined,
  configuredModel: string | undefined,
): string | undefined {
  if (conversationModel === "__default__") return undefined;
  return conversationModel ?? configuredModel;
}

export function compatibleModelSettings(
  requested: TaskExecutionSettings,
  models: readonly CodexModel[],
): CompatibleModelSettings {
  const settings = { ...requested };
  const notices: string[] = [];
  if (models.length === 0) return { settings, notices };

  let effectiveModel = settings.model
    ? models.find((model) => model.model === settings.model || model.id === settings.model)
    : models.find((model) => model.isDefault) ?? models[0];
  if (settings.model && !effectiveModel) {
    notices.push(`模型“${settings.model}”当前不可用，已回退到 Codex 默认模型`);
    delete settings.model;
    effectiveModel = models.find((model) => model.isDefault) ?? models[0];
  }

  if (
    settings.reasoningEffort &&
    effectiveModel &&
    effectiveModel.supportedReasoningEfforts.length > 0 &&
    !effectiveModel.supportedReasoningEfforts.includes(settings.reasoningEffort)
  ) {
    notices.push(
      `当前模型不支持推理强度“${settings.reasoningEffort}”，已回退到“${effectiveModel.defaultReasoningEffort}”`,
    );
    settings.reasoningEffort = effectiveModel.defaultReasoningEffort;
  }

  return {
    settings,
    ...(effectiveModel ? { effectiveModel } : {}),
    notices,
  };
}
