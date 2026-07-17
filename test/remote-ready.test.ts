import { describe, expect, it } from "vitest";

import { parsePowerStatus } from "../src/remote-ready.js";

describe("Remote Ready power status", () => {
  it("parses AC and battery power from pmset output", () => {
    expect(
      parsePowerStatus("Now drawing from 'AC Power'\n -InternalBattery-0 92%; charging;"),
    ).toEqual({ source: "ac", percent: 92, label: "外接电源 · 92%" });
    expect(
      parsePowerStatus("Now drawing from 'Battery Power'\n -InternalBattery-0 41%; discharging;"),
    ).toEqual({ source: "battery", percent: 41, label: "电池供电 · 41%" });
  });

  it("degrades safely when power data is not recognized", () => {
    expect(parsePowerStatus("unavailable")).toEqual({
      source: "unknown",
      label: "电源状态未知",
    });
  });
});
