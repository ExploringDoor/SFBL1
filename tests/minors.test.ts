// Contract tests for the minor / age-as-of-cutoff math.
//
// The cases here are not hypothetical: they are Helena Softball Association's
// actual published rule ("fifteen (15) years of age by the end of the year
// (December 31)", parental consent required under 18), plus the boundary cases
// that decide whether a real teenager is allowed on a field.

import { describe, it, expect } from "vitest";
import {
  ageAsOfCutoff,
  cutoffDateIso,
  assessPlayer,
  needsConsent,
  type MinorsPolicy,
} from "../lib/minors";

// Helena's policy, verbatim from their own site.
const HSA: MinorsPolicy = {
  age_of_majority: 18,
  cutoff: "12-31",
  min_age: 15,
  requires_consent: true,
};

const SEASON = 2026;

describe("ageAsOfCutoff", () => {
  it("counts whole years at the cutoff, not today", () => {
    expect(ageAsOfCutoff("2008-06-15", "12-31", 2026)).toBe(18);
  });

  it("a birthday ON the cutoff counts — they have had it", () => {
    expect(ageAsOfCutoff("2008-12-31", "12-31", 2026)).toBe(18);
  });

  it("a birthday one day AFTER the cutoff does not count", () => {
    // Dec 31 cutoff: born Jan 1 2009 is still 17 on 2026-12-31.
    expect(ageAsOfCutoff("2009-01-01", "12-31", 2026)).toBe(17);
  });

  it("handles a leap-day birthday", () => {
    expect(ageAsOfCutoff("2008-02-29", "12-31", 2026)).toBe(18);
  });

  it("works for a mid-year cutoff too (a different league's rule)", () => {
    // May 1 cutoff: born Jun 1 2008 has NOT had their birthday by 2026-05-01.
    expect(ageAsOfCutoff("2008-06-01", "05-01", 2026)).toBe(17);
    expect(ageAsOfCutoff("2008-04-01", "05-01", 2026)).toBe(18);
  });

  it("returns null for junk, missing, impossible, or future dates", () => {
    expect(ageAsOfCutoff("", "12-31", SEASON)).toBeNull();
    expect(ageAsOfCutoff(null, "12-31", SEASON)).toBeNull();
    expect(ageAsOfCutoff("not-a-date", "12-31", SEASON)).toBeNull();
    expect(ageAsOfCutoff("06/15/2008", "12-31", SEASON)).toBeNull();
    expect(ageAsOfCutoff("2010-02-30", "12-31", SEASON)).toBeNull(); // no such day
    expect(ageAsOfCutoff("2099-01-01", "12-31", SEASON)).toBeNull(); // future
  });

  it("returns null when the cutoff itself is malformed", () => {
    expect(ageAsOfCutoff("2008-06-15", "December", 2026)).toBeNull();
  });

  it("is timezone-independent", () => {
    // Pure Y/M/D integer math — a UTC-midnight boundary cannot shift the year.
    // Born Jan 1 2009, measured on Jan 1 2026: birthday is that very day → 17.
    expect(ageAsOfCutoff("2009-01-01", "01-01", 2026)).toBe(17);
    // Born Dec 31 2008, measured one day later on Jan 1 2026: turned 17 the
    // previous day, so still 17 — a naive year-subtraction would say 18.
    expect(ageAsOfCutoff("2008-12-31", "01-01", 2026)).toBe(17);
  });
});

describe("cutoffDateIso", () => {
  it("renders the cutoff inside the season year", () => {
    expect(cutoffDateIso("12-31", 2026)).toBe("2026-12-31");
  });
  it("returns null on a malformed cutoff", () => {
    expect(cutoffDateIso("nope", 2026)).toBeNull();
  });
});

describe("assessPlayer — Helena's real rule", () => {
  it("an adult is an adult", () => {
    const a = assessPlayer("1990-03-02", HSA, SEASON);
    expect(a.status).toBe("adult");
    expect(a.age).toBe(36);
    expect(a.cutoffDate).toBe("2026-12-31");
  });

  it("17 at the cutoff is a MINOR — the case Justine cannot currently see", () => {
    const a = assessPlayer("2009-05-20", HSA, SEASON);
    expect(a.status).toBe("minor");
    expect(a.age).toBe(17);
  });

  it("exactly 18 at the cutoff is an adult (boundary)", () => {
    expect(assessPlayer("2008-12-31", HSA, SEASON).status).toBe("adult");
  });

  it("exactly 15 at the cutoff is eligible, as a minor (boundary)", () => {
    const a = assessPlayer("2011-12-31", HSA, SEASON);
    expect(a.status).toBe("minor");
    expect(a.age).toBe(15);
  });

  it("14 at the cutoff is UNDER MINIMUM — not eligible at all", () => {
    const a = assessPlayer("2012-01-01", HSA, SEASON);
    expect(a.status).toBe("under_minimum");
    expect(a.age).toBe(14);
  });

  it("a missing DOB is UNKNOWN, never silently 'adult'", () => {
    // This is the safety-critical case: no DOB must surface for follow-up,
    // not disappear into the adult bucket.
    const a = assessPlayer(undefined, HSA, SEASON);
    expect(a.status).toBe("unknown");
    expect(a.age).toBeNull();
  });

  it("no policy configured yields unknown rather than guessing", () => {
    expect(assessPlayer("2009-05-20", null, SEASON).status).toBe("unknown");
  });
});

describe("needsConsent", () => {
  it("minors and under-minimum players need a consent form", () => {
    expect(needsConsent(assessPlayer("2009-05-20", HSA, SEASON), HSA)).toBe(true);
    expect(needsConsent(assessPlayer("2012-01-01", HSA, SEASON), HSA)).toBe(true);
  });
  it("adults do not", () => {
    expect(needsConsent(assessPlayer("1990-03-02", HSA, SEASON), HSA)).toBe(false);
  });
  it("a league that does not require consent never asks for one", () => {
    const noConsent: MinorsPolicy = { ...HSA, requires_consent: false };
    expect(needsConsent(assessPlayer("2009-05-20", noConsent, SEASON), noConsent)).toBe(false);
  });
});
