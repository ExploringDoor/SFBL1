// Sorting the pile before Saturday morning.
//
// Melinda, via Mike, 2026-09-07: a breakdown of shirts sorted by team, by size
// and by age. This is a handover problem, not a sales report: on Saturday
// somebody stands at a field with a box and needs to know how many of each
// size to bring, whose stack is whose, and who still owes money.

import { describe, expect, it } from "vitest";
import {
  ageOf,
  packingList,
  summarise,
  tallyBy,
  tallyBySize,
  type MerchOrderRow, inWindow } from "@/lib/merch-report";

const o = (p: Partial<MerchOrderRow>): MerchOrderRow => ({
  id: Math.random().toString(36).slice(2),
  item_name: "Never Forget Tournament Tee",
  quantity: 1,
  amount_due: 30,
  payment_status: "unpaid",
  ...p,
});

const ROWS: MerchOrderRow[] = [
  o({ size: "M", team_name: "Phoenix Fire", division: "12U Open", player_name: "Ana", payment_status: "paid" }),
  o({ size: "S", team_name: "Phoenix Fire", division: "12U Open", player_name: "Bea", quantity: 2 }),
  o({ size: "L", team_name: "LI Heat", division: "14U C", player_name: "Cara", payment_status: "paid" }),
  o({ size: "S", team_name: "LI Heat", division: "14U C", player_name: "Dee" }),
  o({ size: "XL", team_name: "Waves", division: "14U Open", player_name: "Eve", quantity: 3, amount_due: 90 }),
];

describe("how many of each size to bring", () => {
  it("counts shirts, not orders", () => {
    const s = tallyBySize(ROWS).find((t) => t.key === "S")!;
    expect(s.orders).toBe(2);
    expect(s.shirts).toBe(3); // one order of two, one of one
  });

  it("lists sizes in wearing order, not alphabetical", () => {
    expect(tallyBySize(ROWS).map((t) => t.key)).toEqual(["S", "M", "L", "XL"]);
  });

  it("puts an unrecognised size at the end rather than in the middle", () => {
    const out = tallyBySize([...ROWS, o({ size: "Toddler 2T", team_name: "X" })]);
    expect(out[out.length - 1]!.key).toBe("Toddler 2T");
  });
});

describe("whose stack is whose", () => {
  it("groups by team, biggest first", () => {
    const t = tallyBy(ROWS, (r) => String(r.team_name ?? ""));
    expect(t[0]!.key).toBe("Phoenix Fire"); // 3 shirts
    expect(t[0]!.shirts).toBe(3);
  });

  it("groups by division too, which is how the field is laid out", () => {
    const d = tallyBy(ROWS, (r) => String(r.division ?? ""));
    expect(d.find((x) => x.key === "14U C")!.shirts).toBe(2);
  });

  it("names rows taken before a field was asked for, rather than dropping them", () => {
    // Orders placed before division was collected must still be countable, or
    // the totals stop adding up and nobody trusts the sheet.
    const t = tallyBy([...ROWS, o({ size: "M" })], (r) => String(r.team_name ?? ""), "No team given");
    expect(t.find((x) => x.key === "No team given")!.shirts).toBe(1);
  });
});

describe("who still owes money", () => {
  it("separates paid from unpaid shirts", () => {
    const s = summarise(ROWS);
    expect(s.shirts).toBe(8);
    expect(s.paidShirts).toBe(2);
    expect(s.unpaidShirts).toBe(6);
  });

  it("adds up what is collected and what is outstanding", () => {
    const s = summarise(ROWS);
    expect(s.collected).toBe(60); // two paid orders at $30
    expect(s.owed).toBe(150); // 30 + 30 + 90
  });

  it("carries the unpaid count into each grouping", () => {
    const phoenix = tallyBy(ROWS, (r) => String(r.team_name ?? "")).find(
      (t) => t.key === "Phoenix Fire",
    )!;
    expect(phoenix.shirts).toBe(3);
    expect(phoenix.unpaid).toBe(2); // the paid one is Ana's single
  });
});

describe("paid, however it was paid", () => {
  it("counts a card payment, which lands in a nested payment object", () => {
    // /api/square-pay writes payment: { status: "paid" }, NOT payment_status.
    // Reading only the flat field called every paid card order unpaid, which
    // at a field means turning away somebody who has already been charged.
    const rows = [o({ size: "M", payment: { status: "paid" }, team_name: "T" })];
    expect(summarise(rows).paidShirts).toBe(1);
    expect(summarise(rows).owed).toBe(0);
  });

  it("counts the office marking a Venmo order paid", () => {
    expect(summarise([o({ size: "M", payment_status: "paid" })]).paidShirts).toBe(1);
  });

  it("still treats a pending card order as unpaid", () => {
    const rows = [o({ size: "M", payment: { status: "pending" } })];
    expect(summarise(rows).unpaidShirts).toBe(1);
  });
});

describe("the packing list", () => {
  it("reads in the order shirts are handed out: division, team, size, player", () => {
    const out = packingList(ROWS).map((r) => `${r.division}/${r.team_name}/${r.size}`);
    expect(out[0]).toBe("12U Open/Phoenix Fire/S");
    expect(out[1]).toBe("12U Open/Phoenix Fire/M");
    expect(out[2]).toBe("14U C/LI Heat/S");
    expect(out[3]).toBe("14U C/LI Heat/L");
    expect(out[4]).toBe("14U Open/Waves/XL");
  });

  it("does not mutate the list it was given", () => {
    const before = ROWS.map((r) => r.id);
    packingList(ROWS);
    expect(ROWS.map((r) => r.id)).toEqual(before);
  });
});

describe("nothing sold yet", () => {
  it("returns zeroes rather than throwing", () => {
    const s = summarise([]);
    expect(s).toMatchObject({ orders: 0, shirts: 0, collected: 0, owed: 0 });
    expect(s.bySize).toEqual([]);
  });

  it("ignores a quantity that is not a real number", () => {
    const s = summarise([o({ size: "M", quantity: NaN }), o({ size: "M", quantity: -3 })]);
    expect(s.shirts).toBe(0);
  });
});

describe("by age, which is not the same as by division", () => {
  it("folds 12U Open and 12U C into one 12U", () => {
    const rows = [
      o({ size: "M", division: "12U Open" }),
      o({ size: "S", division: "12U C", quantity: 2 }),
      o({ size: "L", division: "14U Open" }),
    ];
    const byAge = summarise(rows).byAge;
    expect(byAge.find((t) => t.key === "12U")!.shirts).toBe(3);
    expect(byAge.find((t) => t.key === "14U")!.shirts).toBe(1);
  });

  it("orders ages numerically, so 10U comes before 12U and 16U", () => {
    const rows = ["16U Open", "10U Open", "12U C"].map((d) => o({ size: "M", division: d }));
    expect(summarise(rows).byAge.map((t) => t.key)).toEqual(["10U", "12U", "16U"]);
  });

  it("leaves an unrecognised division alone rather than guessing", () => {
    expect(ageOf("Rec League")).toBe("Rec League");
    expect(ageOf("")).toBe("");
  });

  it("normalises spacing and case", () => {
    expect(ageOf("12 u Open")).toBe("12U");
    expect(ageOf("12u C")).toBe("12U");
  });
});

// ---- payment method + weekly window -----------------------------------
//
// Mike, 2026-09-10: "a list of shirts that were paid on the site after 4pm
// today. It breaks down cc and Venmo or Zelle. Every week. So I can give it to
// my team at the field."
//
// Card and the rest are NOT the same kind of thing, and the report must not
// pretend they are. A card order is settled by Square. A Venmo or Zelle order
// is a promise until the office marks it paid, and those are exactly the
// shirts whose money has to be collected on the day.

describe("byMethod", () => {
  const rows: MerchOrderRow[] = [
    { id: "m1", size: "S", quantity: 1, pay_method: "card", payment: { status: "paid" }, amount_due: 30 },
    { id: "m2", size: "M", quantity: 1, pay_method: "card", payment: { status: "paid" }, amount_due: 30 },
    { id: "m3", size: "L", quantity: 1, pay_method: "card", amount_due: 30 },
    { id: "m4", size: "S", quantity: 2, pay_method: "venmo", amount_due: 60 },
    { id: "m5", size: "S", quantity: 1, pay_method: "zelle", payment_status: "paid", amount_due: 30 },
  ];

  it("splits card, Venmo and Zelle", () => {
    expect(summarise(rows).byMethod.map((t) => t.key)).toEqual(["Card", "Venmo", "Zelle"]);
  });

  it("counts the shirts under each", () => {
    const m = summarise(rows).byMethod;
    expect(m.find((t) => t.key === "Card")!.shirts).toBe(3);
    expect(m.find((t) => t.key === "Venmo")!.shirts).toBe(2);
  });

  it("shows a started-but-unpaid card order as still owing", () => {
    const card = summarise(rows).byMethod.find((t) => t.key === "Card")!;
    expect(card.unpaid).toBe(1);
    expect(card.owed).toBe(30);
  });

  it("counts a Venmo order as owing until the office marks it paid", () => {
    const v = summarise(rows).byMethod.find((t) => t.key === "Venmo")!;
    expect(v.unpaid).toBe(2);
    expect(v.owed).toBe(60);
  });

  it("respects the office marking a Zelle order paid", () => {
    expect(summarise(rows).byMethod.find((t) => t.key === "Zelle")!.unpaid).toBe(0);
  });

  it("orders them card, Venmo, Zelle rather than by size", () => {
    const many: MerchOrderRow[] = [
      { id: "m6", size: "S", quantity: 9, pay_method: "zelle" },
      { id: "m7", size: "S", quantity: 1, pay_method: "card" },
    ];
    expect(summarise(many).byMethod.map((t) => t.key)).toEqual(["Card", "Zelle"]);
  });

  it("labels a missing method rather than dropping the shirt", () => {
    expect(summarise([{ id: "m8", size: "S", quantity: 1 }]).byMethod[0]!.key).toBe("Not given");
  });
});

describe("inWindow", () => {
  const rows: MerchOrderRow[] = [
    { id: "m9", size: "S", quantity: 1, created_at: "2026-09-05T12:00:00Z" },
    { id: "m10", size: "M", quantity: 1, created_at: "2026-09-09T12:00:00Z" },
    { id: "m11", size: "L", quantity: 1, submitted_at: "2026-09-10T12:00:00Z" },
    { id: "m12", size: "XL", quantity: 1 },
  ];

  it("keeps only this week when a start is given", () => {
    expect(inWindow(rows, "2026-09-08T00:00:00Z")).toHaveLength(3);
  });

  it("falls back to submitted_at when created_at is absent", () => {
    expect(inWindow(rows, "2026-09-10T00:00:00Z").map((r) => r.size)).toContain("L");
  });

  it("KEEPS a row with no timestamp rather than hiding a real shirt", () => {
    expect(inWindow(rows, "2026-09-10T00:00:00Z").map((r) => r.size)).toContain("XL");
  });

  it("returns everything when no start is given", () => {
    expect(inWindow(rows, null)).toHaveLength(4);
  });
});
