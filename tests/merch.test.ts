// The league store, and the one number that matters.
//
// Mike sent 60 small, 30 medium, 5 large, 5 XL. Sixty smalls will never run
// out. FIVE LARGES will, and everything below exists so that two people
// ordering the last one do not both get told yes.

import { describe, expect, it } from "vitest";
import {
  MAX_PER_ORDER,
  isPayMethod,
  merchTotal,
  stockFor,
  type MerchItem,
} from "@/lib/merch";
import merch from "@/app/store/island-merch.json";

const TEE = (merch as unknown as { items: MerchItem[] }).items[0]!;

describe("the catalogue Mike actually sent", () => {
  it("is the tee at $30 in four sizes", () => {
    expect(TEE.price).toBe(30);
    expect(TEE.sizes).toEqual(["S", "M", "L", "XL"]);
  });

  it("opens on his counts: 60 / 30 / 5 / 5", () => {
    expect(TEE.initial_stock).toEqual({ S: 60, M: 30, L: 5, XL: 5 });
  });

  it("has an id, since the stock document and every order row key off it", () => {
    expect(TEE.id).toBeTruthy();
    expect(TEE.image).toMatch(/^\/island\//);
  });
});

describe("stockFor", () => {
  it("uses the opening counts before anything has sold", () => {
    expect(stockFor(TEE, null)).toEqual([
      { size: "S", count: 60 },
      { size: "M", count: 30 },
      { size: "L", count: 5 },
      { size: "XL", count: 5 },
    ]);
  });

  it("prefers the live count once a size has moved", () => {
    const live = { [TEE.id]: { L: 2 } };
    expect(stockFor(TEE, live).find((s) => s.size === "L")!.count).toBe(2);
    // and leaves the untouched sizes on their opening numbers
    expect(stockFor(TEE, live).find((s) => s.size === "S")!.count).toBe(60);
  });

  it("shows a genuine zero as sold out", () => {
    expect(stockFor(TEE, { [TEE.id]: { L: 0 } }).find((s) => s.size === "L")!.count).toBe(0);
  });

  it("does NOT read a missing document as sold out", () => {
    // The failure that would close the shop on a Firestore hiccup: an absent
    // count means nothing has sold, not that everything is gone.
    for (const empty of [null, undefined, {}, { "other-item": { L: 0 } }]) {
      expect(stockFor(TEE, empty).every((s) => s.count > 0)).toBe(true);
    }
  });

  it("ignores a count that is not a usable number", () => {
    const live = { [TEE.id]: { L: "two", XL: -4, M: 1.7 } };
    const out = stockFor(TEE, live as Record<string, unknown>);
    expect(out.find((s) => s.size === "L")!.count).toBe(5); // falls back
    expect(out.find((s) => s.size === "XL")!.count).toBe(0); // clamped, never negative
    expect(out.find((s) => s.size === "M")!.count).toBe(1); // floored
  });
});

describe("what an order costs", () => {
  it("is quantity times price", () => {
    expect(merchTotal(TEE, 1)).toBe(30);
    expect(merchTotal(TEE, 3)).toBe(90);
  });

  it("refuses a quantity that is not a real order", () => {
    // Zero means square-pay declines, which is right: charging a price nobody
    // published is worse than declining to charge.
    for (const q of [0, -1, NaN, MAX_PER_ORDER + 1]) {
      expect(merchTotal(TEE, q as number)).toBe(0);
    }
  });

  it("floors a fractional quantity rather than refusing it", () => {
    // The order route floors before it validates, so these must agree: 1.9
    // is one shirt, priced as one shirt, and stock moves by one.
    expect(merchTotal(TEE, 1.9)).toBe(30);
    expect(merchTotal(TEE, 2.5)).toBe(60);
  });

  it("caps an order, because a typo in a quantity box empties a size", () => {
    expect(merchTotal(TEE, MAX_PER_ORDER)).toBe(30 * MAX_PER_ORDER);
    expect(merchTotal(TEE, MAX_PER_ORDER + 1)).toBe(0);
  });
});

describe("how they said they would pay", () => {
  it("accepts the four Mike named", () => {
    for (const m of ["card", "venmo", "zelle", "cash"]) {
      expect(isPayMethod(m)).toBe(true);
    }
  });

  it("rejects anything else, since this string is stored on the order", () => {
    for (const m of ["paypal", "", "CARD", null, 7, {}]) {
      expect(isPayMethod(m)).toBe(false);
    }
  });
});
