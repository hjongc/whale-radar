import { describe, expect, it } from "vitest";

import { FILING_ACTIONS, FILING_FORM_TYPES } from "@/lib/domain/enums";

describe("domain enum smoke", () => {
  it("keeps baseline filing actions available", () => {
    expect(FILING_ACTIONS).toEqual(["NEW", "ADD", "REDUCE", "KEEP"]);
  });

  it("exposes supported 13F form variants", () => {
    expect(FILING_FORM_TYPES).toEqual(["13F-HR", "13F-HR/A", "13F-NT", "13F-NT/A"]);
  });
});
