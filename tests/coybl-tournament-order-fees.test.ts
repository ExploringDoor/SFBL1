// Pricing for COYBL's own tournaments and its Rawlings baseball orders.
//
// These two kinds are charged straight off the submitted answers, with no
// ledger row behind them to check the number against. feeFor IS the price, so
// it gets pinned here.
//
// The case that matters most is the ZERO one. feeFor returns 0 when it cannot
// price something, and square-pay refuses a zero rather than sending it to
// Square. If a future edit makes an unpriceable submission fall through to a
// default instead, a team gets billed a price nobody published.

import { describe, expect, it } from "vitest";
import { chargeCents, feeFor } from "@/lib/fees";
import {
  COYBL_TOURNAMENTS,
  tournamentAgeFees,
  tournamentFeeFor,
} from "@/lib/coybl-tournaments";

const licking = "Licking County Invitational";
const supers = "Super Heros All Stars";

describe("tournament entry fees", () => {
  it("prices each age band from Doug's own numbers", () => {
    expect(feeFor("coybl", { tournament: licking, team_age: "8U" }, "tournament_registration")).toBe(300);
    expect(feeFor("coybl", { tournament: licking, team_age: "10U" }, "tournament_registration")).toBe(350);
    expect(feeFor("coybl", { tournament: licking, team_age: "12U" }, "tournament_registration")).toBe(350);
    expect(feeFor("coybl", { tournament: supers, team_age: "8U" }, "tournament_registration")).toBe(325);
    expect(feeFor("coybl", { tournament: supers, team_age: "12U" }, "tournament_registration")).toBe(375);
  });

  it("splits a grouped label like '10U and 12U' into both ages", () => {
    const ages = tournamentAgeFees(COYBL_TOURNAMENTS[0]!).map((a) => a.age);
    expect(ages).toContain("10U");
    expect(ages).toContain("12U");
  });

  it("every age the form offers has a non-zero price", () => {
    // The dropdown is built from tournamentAgeFees, so an unpriced option here
    // would be one a coach could pick and then be refused at checkout.
    for (const t of COYBL_TOURNAMENTS) {
      for (const { age } of tournamentAgeFees(t)) {
        expect(tournamentFeeFor(t, age)).toBeGreaterThan(0);
        expect(
          feeFor("coybl", { tournament: t.name, team_age: age }, "tournament_registration"),
        ).toBeGreaterThan(0);
      }
    }
  });

  it("returns 0 rather than guessing for an unknown tournament or age", () => {
    expect(feeFor("coybl", { tournament: "Made Up Cup", team_age: "8U" }, "tournament_registration")).toBe(0);
    expect(feeFor("coybl", { tournament: licking, team_age: "16U" }, "tournament_registration")).toBe(0);
    expect(feeFor("coybl", { tournament: licking, team_age: "" }, "tournament_registration")).toBe(0);
    expect(feeFor("coybl", {}, "tournament_registration")).toBe(0);
  });

  it("is case and whitespace tolerant, because the value round-trips through a form", () => {
    expect(feeFor("coybl", { tournament: licking, team_age: " 8u " }, "tournament_registration")).toBe(300);
  });
});

describe("baseball order totals", () => {
  const order = (dozens: unknown, ship: string) =>
    feeFor("coybl", { dozens, ship_to_home: ship }, "baseball_order");

  it("charges quantity times price, with shipping only when asked for", () => {
    expect(order(2, "No")).toBe(104);
    expect(order(2, "Yes")).toBe(114);
    expect(order(10, "No")).toBe(520);
    expect(order(10, "Yes")).toBe(570);
  });

  it("refuses anything under the two dozen minimum", () => {
    expect(order(1, "No")).toBe(0);
    expect(order(0, "No")).toBe(0);
    expect(order(-5, "No")).toBe(0);
    expect(order("", "No")).toBe(0);
    expect(order("abc", "No")).toBe(0);
  });

  it("does not bill a fraction of a dozen", () => {
    // 2.9 dozen is 2 dozen. Rounding up would charge for a box Doug is not
    // sending.
    expect(order(2.9, "No")).toBe(104);
  });

  it("adds COYBL's 3.25 percent on the card, on the shipped total", () => {
    // $114 including shipping, plus 3.25 percent.
    expect(chargeCents("coybl", order(2, "Yes"))).toBe(11771);
  });
});
