// The waiver season label and constant.
//
// One constant because three places must agree: the roster gate that asks, the
// team stamp that records, and the admin reading it back.

import { describe, expect, it } from "vitest";
import { CURRENT_WAIVER_SEASON, waiverSeasonLabel } from "@/lib/waiver-season";

describe("waiverSeasonLabel", () => {
  it("turns the stored value into something a coach reads", () => {
    expect(waiverSeasonLabel("fall-2026")).toBe("Fall 2026");
  });

  it("handles the other seasons", () => {
    expect(waiverSeasonLabel("spring-2027")).toBe("Spring 2027");
    expect(waiverSeasonLabel("summer-2026")).toBe("Summer 2026");
  });

  it("passes an unexpected value through rather than mangling it", () => {
    expect(waiverSeasonLabel("Fall 2026")).toBe("Fall 2026");
    expect(waiverSeasonLabel("")).toBe("");
  });

  it("matches the season the public waiver form offers", () => {
    // The form's options are spring-2026 / fall-2026 / spring-2027. A constant
    // outside that set would file a waiver nothing ever reads back.
    expect(["spring-2026", "fall-2026", "spring-2027"]).toContain(
      CURRENT_WAIVER_SEASON,
    );
  });
});
