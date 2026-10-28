import { get, save } from "./db.ts";
export const ASSISTANT_MODELS = ["gpt-6.1-sol", "gpt-6-luna"] as const;
export const REASONING_EFFORTS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export function assistantSettings() {
  return {
    model: "gpt-6-luna",
    reasoningEffort: "medium",
    ...get("settings", "assistant"),
  };
}
export function validateSelection(value: any) {
  if (!ASSISTANT_MODELS.includes(value.model))
    throw new Error("模型仅支持 gpt-6.1-sol 或 gpt-6-luna");
  if (!REASONING_EFFORTS.includes(value.reasoningEffort))
    throw new Error("思考强度无效");
  return { model: value.model, reasoningEffort: value.reasoningEffort };
}
export function updateAssistantSettings(value: any) {
  return save("settings", {
    ...assistantSettings(),
    ...validateSelection({ ...assistantSettings(), ...value }),
    id: "assistant",
  });
}
export function taskSelection(task: any) {
  const current = assistantSettings();
  return validateSelection({
    model: task.model || current.model,
    reasoningEffort: task.reasoningEffort || current.reasoningEffort,
  });
}
