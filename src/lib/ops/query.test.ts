import { describe, expect, it } from "vitest";

import { DomainValidationError } from "@/lib/domain/validation";
import { parseOpsRunFlags } from "@/lib/ops/query";

describe("parseOpsRunFlags", () => {
  it("defaults to bounded priority manual mode", () => {
    const flags = parseOpsRunFlags(new URLSearchParams());

    expect(flags).toEqual({
      mode: "manual",
      dryRun: false,
      replay: false,
      priorityOnly: true,
      scope: "priority"
    });
  });

  it("parses explicit run-mode flags", () => {
    const flags = parseOpsRunFlags(
      new URLSearchParams({
        "dry-run": "true",
        replay: "1",
        "priority-only": "false",
        scope: "targeted",
        mode: "replay"
      })
    );

    expect(flags).toEqual({
      mode: "replay",
      dryRun: true,
      replay: true,
      priorityOnly: false,
      scope: "targeted"
    });
  });

  it("rejects invalid booleans and contradictory scope flags", () => {
    expect(() => parseOpsRunFlags(new URLSearchParams({ "dry-run": "maybe" }))).toThrow(DomainValidationError);

    expect(() =>
      parseOpsRunFlags(
        new URLSearchParams({
          scope: "targeted",
          "priority-only": "true"
        })
      )
    ).toThrow('"scope=targeted" and "priority-only=true" cannot be combined');
  });
});
