// "Do not reopen the store on Saturdays." — Melinda, 2026-09-11.
//
// The shop window could only ever describe a weekly cycle: shut Thursday 4pm,
// open again Saturday 6am at the field. There was no way to say "shut, and
// stay shut", so honouring her request meant either guessing a different
// reopen day or writing a window that shuts for six days and twenty three
// hours, which reads as a riddle to whoever opens the document next.
//
// openDay: null now means no scheduled reopen.

import { describe, it, expect } from "vitest";
import { isStoreOpen, readStoreHours, type StoreHours } from "@/lib/store-hours";

// A Date for a given New York wall clock moment in September 2026 (EDT, UTC-4).
const ny = (day: number, hh: number, mm = 0) =>
  new Date(Date.UTC(2026, 8, 6 + day, hh + 4, mm));

const ISLAND: StoreHours = {
  enabled: true,
  closeDay: 4, // Thursday
  closeTime: "16:00",
  openDay: null, // no scheduled reopen
  openTime: "06:00",
  closedNote: "Ordering is closed.",
};

describe("closed until further notice (openDay: null)", () => {
  it("DOES NOT REOPEN SATURDAY, which is the whole point", () => {
    expect(isStoreOpen(ny(6, 5, 59), ISLAND)).toBe(false);
    expect(isStoreOpen(ny(6, 6, 0), ISLAND)).toBe(false); // the old reopen moment
    expect(isStoreOpen(ny(6, 12), ISLAND)).toBe(false);
  });

  // The first implementation compared week minutes against the close point,
  // which resets at midnight on Sunday. It shut the shop on Thursday and
  // reopened it on Sunday on its own: no Saturday reopening, as asked, and a
  // Sunday one instead. Every day of the week, every time.
  it("stays shut on EVERY day, including across the Sunday boundary", () => {
    for (let d = 0; d < 7; d++) {
      for (const h of [0, 6, 12, 23]) {
        expect(isStoreOpen(ny(d, h), ISLAND), `day ${d} at ${h}:00`).toBe(false);
      }
    }
  });
});

describe("the old Saturday cycle still works for anyone using it", () => {
  const WEEKLY: StoreHours = { ...ISLAND, openDay: 6 };
  it("shuts Thursday 4pm and reopens Saturday 6am", () => {
    expect(isStoreOpen(ny(4, 15), WEEKLY)).toBe(true);
    expect(isStoreOpen(ny(4, 17), WEEKLY)).toBe(false);
    expect(isStoreOpen(ny(5, 12), WEEKLY)).toBe(false);
    expect(isStoreOpen(ny(6, 5), WEEKLY)).toBe(false);
    expect(isStoreOpen(ny(6, 7), WEEKLY)).toBe(true);
  });
});

describe("readStoreHours", () => {
  it("keeps an explicit null openDay rather than defaulting it to Saturday", () => {
    expect(readStoreHours({ enabled: true, openDay: null }).openDay).toBeNull();
  });
  it("still defaults a missing openDay to Saturday, so old documents are unchanged", () => {
    expect(readStoreHours({ enabled: true }).openDay).toBe(6);
    expect(readStoreHours({ enabled: true, openDay: 3 }).openDay).toBe(3);
  });
  it("a disabled shop is open regardless, which is the safe direction", () => {
    expect(isStoreOpen(ny(6, 12), { ...ISLAND, enabled: false })).toBe(true);
  });
});
