// When the shop is open.
//
// Mike, 2026-09-08: closes THURSDAY 4PM (it was "Wednesday night 12 midnight"
// for one day, 09-07), reopens Saturday 6am to sell what is left at the field.
// So the shut stretch is Thursday from 4pm, all of Friday, and Saturday until
// 6am.
//
// The ways this goes wrong are tested below: closing at the start of the day
// rather than 4pm, doing the arithmetic in UTC so the boundary moves by an hour
// twice a year, and losing the older end-of-day meaning for a stored document
// written before closeTime existed.

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
  it("is OPEN on Thursday morning, before the 4pm close", () => {
    // Thu 2026-09-10, 15:30 EDT = 19:30 UTC.
    expect(isStoreOpen(ny("2026-09-10T19:30:00Z"), HOURS)).toBe(true);
  });

  it("is OPEN at 3:59pm Thursday", () => {
    expect(isStoreOpen(ny("2026-09-10T19:59:00Z"), HOURS)).toBe(true);
  });

  it("is SHUT at 4pm Thursday, on the dot", () => {
    expect(isStoreOpen(ny("2026-09-10T20:00:00Z"), HOURS)).toBe(false);
  });

  it("does NOT shut at the start of Thursday", () => {
    // Thu 00:30 EDT — the old Wednesday-midnight window shut here, and the
    // new one must not. This is the whole change.
    expect(isStoreOpen(ny("2026-09-10T04:30:00Z"), HOURS)).toBe(true);
  });

  it("is open all day Wednesday, which used to be the close day", () => {
    expect(isStoreOpen(ny("2026-09-10T03:30:00Z"), HOURS)).toBe(true); // Wed 23:30
  });

  it("stays shut through Friday", () => {
    expect(isStoreOpen(ny("2026-09-11T16:00:00Z"), HOURS)).toBe(false);
  });

  it("is still shut early Saturday, before 6am", () => {
    // Sat 05:30 EDT = 09:30 UTC.
    expect(isStoreOpen(ny("2026-09-12T09:30:00Z"), HOURS)).toBe(false);
  });

  it("opens at 6am Saturday", () => {
    expect(isStoreOpen(ny("2026-09-12T10:00:00Z"), HOURS)).toBe(true);
  });

  it("is open all weekend and into the next week", () => {
    expect(isStoreOpen(ny("2026-09-13T18:00:00Z"), HOURS)).toBe(true); // Sun
    expect(isStoreOpen(ny("2026-09-15T18:00:00Z"), HOURS)).toBe(true); // Tue
  });
});

describe("a document written before closeTime existed", () => {
  // These still mean "the END of closeDay". Filling closeTime from the
  // default instead would shut such a shop eight hours early every week.
  const legacy: StoreHours = {
    ...DEFAULT_STORE_HOURS,
    enabled: true,
    closeDay: 3, // Wednesday
    closeTime: null,
  };

  it("reads a missing closeTime as end-of-day, not 4pm", () => {
    expect(readStoreHours({ enabled: true, closeDay: 3 }).closeTime).toBe(null);
  });

  it("is open at 4pm Wednesday", () => {
    expect(isStoreOpen(ny("2026-09-09T20:00:00Z"), legacy)).toBe(true);
  });

  it("is open at 11:30pm Wednesday, right up to the end of it", () => {
    expect(isStoreOpen(ny("2026-09-10T03:30:00Z"), legacy)).toBe(true);
  });

  it("is shut once Wednesday ends", () => {
    expect(isStoreOpen(ny("2026-09-10T04:30:00Z"), legacy)).toBe(false);
  });
});

describe("New York time, not UTC", () => {
  it("uses the wall clock on Long Island, not the server's", () => {
    // Wed 22:00 EDT is already THURSDAY 02:00 in UTC. Judged in UTC the shop
    // would shut two hours early every week.
    expect(isStoreOpen(ny("2026-09-10T02:00:00Z"), HOURS)).toBe(true);
  });

  it("holds across the end of daylight saving", () => {
    // 2026-11-01 is the DST change, so these are EST (UTC-5), not EDT.
    // Thu 2026-11-05 15:30 EST = 20:30 UTC — still open.
    expect(isStoreOpen(ny("2026-11-05T20:30:00Z"), HOURS)).toBe(true);
    // Thu 16:00 EST = 21:00 UTC — shut. An hour out either way, which is
    // what doing this arithmetic in UTC would cost, lands on the wrong side.
    expect(isStoreOpen(ny("2026-11-05T21:00:00Z"), HOURS)).toBe(false);
    expect(isStoreOpen(ny("2026-11-05T20:00:00Z"), HOURS)).toBe(true);
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
    expect(h.closeDay).toBe(4); // Thursday
    expect(h.openTime).toBe("06:00");
    expect(h.closedNote).toContain("Saturday");
  });

  it("survives a document of the wrong shape entirely", () => {
    expect(readStoreHours("closed").enabled).toBe(false);
    expect(readStoreHours(null).enabled).toBe(false);
  });
});
