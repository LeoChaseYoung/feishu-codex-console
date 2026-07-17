import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

interface PackageManifest {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
}

export const PACKAGE_ROOT = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const manifest = JSON.parse(
  readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8"),
) as PackageManifest;

export const PACKAGE_NAME = manifest.name;
export const PACKAGE_VERSION = manifest.version;
export const CODEX_PACKAGE_VERSION = manifest.dependencies?.["@openai/codex"] ?? "unknown";
export const LARK_CLI_PACKAGE_VERSION = manifest.dependencies?.["@larksuite/cli"] ?? "unknown";
