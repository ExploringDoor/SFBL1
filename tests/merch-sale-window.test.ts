// Each shirt has its own end date, and the report keeps designs apart.
//
// Melinda, 2026-09-11, two messages that together describe the real model:
//
//   "It can reopen once I send you the new shirts and I'll try to keep them
//    flowing so it never has to close."
//   "There will just be an end date for each shirt."
//
// So the SHOP stops keeping hours and the SHIRTS start. One ending the day the
// next begins is a store that never shuts, which is what she is after.

import { describe, it, expect } from "vitest";
import { isOnSale, onSaleItems, leagueToday, type MerchItem } from "@/lib/merch";
import { splitByItem, summarise, type MerchOrderRow } from "@/lib/merch-report";

const shirt = (id: string, extra: Partial<MerchItem> = {}): MerchItem => ({
  id,
  name: id,
  price: 30,
  sizes: ["S", "M", "L"],
  initial_stock: { S: 10, M: 10, L: 10 },
  ...extra,
});

describe("a shirt's own sale window", () => {
  it("sells through its end date, not up to it", () => {
    const s = shirt("tee", { ends_on: "2026-09-20" });
    expect(isOnSale(s, "2026-09-19")).toBe(true);
    expect(isOnSale(s, "2026-09-20")).toBe(true); // the last day still sells
    expect(isOnSale(s, "2026-09-21")).toBe(false);
  });

  it("waits for its start date", () => {
    const s = shirt("tee", { starts_on: "2026-09-15" });
    expect(isOnSale(s, "2026-09-14")).toBe(false);
    expect(isOnSale(s, "2026-09-15")).toBe(true);
  });

  it("with no dates it just sells, which is every shirt sold so far", () => {
    expect(isOnSale(shirt("tee"), "2030-01-01")).toBe(true);
  });

  it("KEEPS THE STORE OPEN when one ends the day the next starts", () => {
    const items = [
      shirt("never-forget", { ends_on: "2026-09-20" }),
      shirt("fall-classic", { starts_on: "2026-09-21", ends_on: "2026-10-05" }),
    ];
    // handover day and the day after: exactly one shirt on sale, never zero
    expect(onSaleItems(items, "2026-09-20").map((i) => i.id)).toEqual(["never-forget"]);
    expect(onSaleItems(items, "2026-09-21").map((i) => i.id)).toEqual(["fall-classic"]);
    for (const d of ["2026-09-19", "2026-09-20", "2026-09-21", "2026-10-05"]) {
      expect(onSaleItems(items, d).length, d).toBe(1);
    }
    expect(onSaleItems(items, "2026-10-06")).toEqual([]); // both done
  });

  it("shows both when their windows overlap", () => {
    const items = [
      shirt("a", { ends_on: "2026-09-25" }),
      shirt("b", { starts_on: "2026-09-20" }),
    ];
    expect(onSaleItems(items, "2026-09-22").map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("reads today in New York, not UTC", () => {
    // 8pm New York on the 20th is already the 21st in UTC. A shirt ending on
    // the 20th must still be on sale for the shopper sitting on Long Island.
    const evening = new Date("2026-09-21T00:30:00Z");
    expect(leagueToday(evening)).toBe("2026-09-20");
    expect(isOnSale(shirt("tee", { ends_on: "2026-09-20" }), leagueToday(evening))).toBe(true);
  });
});

describe("the report keeps designs apart", () => {
  const row = (item: string, size: string, qty = 1): MerchOrderRow =>
    ({ item_name: item, size, quantity: qty, amount_due: 30 }) as MerchOrderRow;

  // Never Forget outsells Fall Classic 5 to 3, deliberately not a tie: the
  // sort falls back to alphabetical when counts match, and "Fall Classic"
  // would then come first and prove nothing about the ordering.
  const rows = [
    row("Never Forget Tee", "S", 4),
    row("Never Forget Tee", "M"),
    row("Fall Classic Tee", "S", 3),
  ];

  it("does not add two designs' sizes together", () => {
    const groups = splitByItem(rows);
    expect(groups.map((g) => g.item).sort()).toEqual(["Fall Classic Tee", "Never Forget Tee"]);
    const nf = groups.find((g) => g.item === "Never Forget Tee")!;
    const fc = groups.find((g) => g.item === "Fall Classic Tee")!;
    expect(nf.summary.bySize.find((t) => t.key === "S")!.shirts).toBe(4);
    expect(fc.summary.bySize.find((t) => t.key === "S")!.shirts).toBe(3);
    // the combined view totals 7 smalls, which is right for money and wrong
    // for packing: seven smalls of no particular shirt
    expect(summarise(rows).bySize.find((t) => t.key === "S")!.shirts).toBe(7);
  });

  it("puts the bigger seller first", () => {
    expect(splitByItem(rows)[0]!.item).toBe("Never Forget Tee");
  });

  it("files orders taken before item_name existed under 'Shirt'", () => {
    const legacy = [{ size: "S", quantity: 1, amount_due: 30 } as MerchOrderRow];
    expect(splitByItem(legacy)[0]!.item).toBe("Shirt");
  });

  it("gives one group for one design, so today's view is unchanged", () => {
    expect(splitByItem([row("Never Forget Tee", "S")]).length).toBe(1);
  });
});
