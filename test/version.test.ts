import { describe, expect, it } from "vitest";

import {
  CODEX_PACKAGE_VERSION,
  LARK_CLI_PACKAGE_VERSION,
  PACKAGE_NAME,
  PACKAGE_VERSION,
} from "../src/version.js";

describe("runtime version metadata", () => {
  it("matches the packaged compatibility contract", () => {
    expect(PACKAGE_NAME).toBe("feishu-codex-console");
    expect(PACKAGE_VERSION).toMatch(/^\d+\.\d+\.\d+/);
    expect(CODEX_PACKAGE_VERSION).toMatch(/^\d+\.\d+\.\d+/);
    expect(LARK_CLI_PACKAGE_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
