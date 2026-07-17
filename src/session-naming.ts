export function sessionNameFromPrompt(prompt: string, projectName: string, maxLength = 56): string {
  const firstMeaningfulLine = prompt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
    ?.replace(/^[-*#>\s]+/, "")
    .replace(/\s+/g, " ")
    .trim();
  const fallback = `${projectName} 新任务`;
  const selected = firstMeaningfulLine || fallback;
  if (selected.length <= maxLength) return selected;
  return `${selected.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}
