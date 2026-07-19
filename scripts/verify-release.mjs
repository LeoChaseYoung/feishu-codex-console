import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
const tag = (process.env.GITHUB_REF_NAME ?? process.argv[2] ?? "").trim();

if (!tag) throw new Error("Release tag is required through GITHUB_REF_NAME or the first argument.");
if (tag !== `v${manifest.version}`) {
  throw new Error(`Tag ${tag} does not match package version ${manifest.version}. Expected v${manifest.version}.`);
}
if (manifest.private) throw new Error("package.json is still marked private.");
if (!manifest.bin?.["feishu-codex-bridge"]) {
  throw new Error("package.json does not expose the feishu-codex-bridge binary.");
}
if (!manifest.bin?.[manifest.name]) {
  throw new Error(`package.json does not expose a binary matching ${manifest.name}.`);
}
const compatibility = await readFile(path.join(packageRoot, "docs", "COMPATIBILITY.md"), "utf8");
for (const expected of [
  `@openai/codex \`${manifest.dependencies?.["@openai/codex"]}\``,
  `@larksuite/cli \`${manifest.dependencies?.["@larksuite/cli"]}\``,
  "BRIDGE_CONFIG_VERSION=1",
  "persisted state v6",
  "SQLite schema v3",
]) {
  if (!compatibility.includes(expected)) {
    throw new Error(`docs/COMPATIBILITY.md is missing release contract: ${expected}`);
  }
}
for (const required of ["README.en.md", "ROADMAP.md", "CONTRIBUTING.md"]) {
  if (!manifest.files?.includes(required)) {
    throw new Error(`Published file allowlist is missing ${required}.`);
  }
}
console.log(`Release metadata verified for ${manifest.name}@${manifest.version}.`);
