// When the shop is open.
//
// Mike, 2026-09-07: closes "Wednesday night 12 midnight", reopens Saturday 6am
// to sell what is left at the field. So the shut stretch is Thursday, Friday,
// and Saturday until 6am.
//
// The two ways this goes wrong are both tested below: reading "Wednesday night"
// as the START of Wednesday, which shuts the shop a day early every week, and
// doing the arithmetic in UTC, which moves the boundary by an hour twice a year.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_STORE_HOURS,
  isStoreOpen,
  nyParts,
  readStoreHours,
  type StoreHours,
} from "@/lib/store-hours";

const HOURS: StoreHours = { ...DEFAULT_STORE_HOURS, enabled: true };
/** A New York wall-clock time, written as the UTC instant it happens at. */
const ny = (iso: string) => new Date(iso);

describe("the week Mike described", () => {
  it("is OPEN through Wednesday, right up to the end of it", () => {
    // Wed 2026-09-09, 23:30 EDT = 03:30 UTC Thursday.
    expect(isStoreOpen(ny("2026-09-10T03:30:00Z"), HOURS)).toBe(true);
  });

  it("is SHUT once Wednesday ends", () => {
    // Thu 00:30 EDT.
    expect(isStoreOpen(ny("2026-09-10T04:30:00Z"), HOURS)).toBe(false);
  });

  it("stays shut Thursday and Friday", () => {
    expect(isStoreOpen(ny("2026-09-10T16:00:00Z"), HOURS)).toBe(false); // Thu noon
    expect(isStoreOpen(ny("2026-09-11T16:00:00Z"), HOURS)).toBe(false); // Fri noon
  });

  it("is still shut early Saturday, before 6am", () => {
    // Sat 05:30 EDT = 09:30 UTC.
    expect(isStoreOpen(ny("2026-09-12T09:30:00Z"), HOURS)).toBe(false);
  });

  it("opens at 6am Saturday", () => {
    // Sat 06:00 EDT = 10:00 UTC.
    expect(isStoreOpen(ny("2026-09-12T10:00:00Z"), HOURS)).toBe(true);
  });

  it("is open all weekend and into the next week", () => {
    expect(isStoreOpen(ny("2026-09-12T20:00:00Z"), HOURS)).toBe(true); // Sat pm
    expect(isStoreOpen(ny("2026-09-13T20:00:00Z"), HOURS)).toBe(true); // Sun
    expect(isStoreOpen(ny("2026-09-15T20:00:00Z"), HOURS)).toBe(true); // Tue
  });

  it("does NOT read Wednesday night as the start of Wednesday", () => {
    // The misreading would shut the shop all day Wednesday, a day early.
    expect(isStoreOpen(ny("2026-09-09T16:00:00Z"), HOURS)).toBe(true); // Wed noon
  });
});

describe("New York time, not UTC", () => {
  it("uses the wall clock on Long Island, not the server's", () => {
    // Wed 22:00 EDT is already THURSDAY 02:00 in UTC. Judged in UTC the shop
    // would shut two hours early every week.
    expect(isStoreOpen(ny("2026-09-10T02:00:00Z"), HOURS)).toBe(true);
  });

  it("holds across the end of daylight saving", () => {
    // 2026-11-01 is the DST change. Wed 2026-11-04 23:30 EST = 04:30 UTC Thu.
    expect(isStoreOpen(ny("2026-11-05T04:30:00Z"), HOURS)).toBe(true);
    // and Thursday 00:30 EST = 05:30 UTC is shut
    expect(isStoreOpen(ny("2026-11-05T05:30:00Z"), HOURS)).toBe(false);
  });

  it("reads the day and time correctly for a known instant", () => {
    // Sat 2026-09-12 06:00 EDT
    expect(nyParts(ny("2026-09-12T10:00:00Z"))).toEqual({ day: 6, minutes: 360 });
  });
});

describe("failing open", () => {
  it("is open when scheduling is off, which is the default", () => {
    expect(DEFAULT_STORE_HOURS.enabled).toBe(false);
    expect(isStoreOpen(ny("2026-09-11T16:00:00Z"), DEFAULT_STORE_HOURS)).toBe(true);
  });

  it("only an explicit true can shut a shop", () => {
    for (const v of ["true", 1, {}, null, undefined]) {
      expect(readStoreHours({ enabled: v }).enabled).toBe(false);
    }
  });

  it("falls back to sane values for a half-written document", () => {
    const h = readStoreHours({ enabled: true, closeDay: 99, openTime: "nope" });
    expect(h.closeDay).toBe(3);
    expect(h.openTime).toBe("06:00");
    expect(h.closedNote).toContain("Saturday");
  });

  it("survives a document of the wrong shape entirely", () => {
    expect(readStoreHours("closed").enabled).toBe(false);
    expect(readStoreHours(null).enabled).toBe(false);
  });
});
