import { describe, expect, it } from "vitest";
import { batterScore, calcPOTG, pitcherScore } from "@/lib/stats/potg";

describe("batterScore", () => {
  it("zero line scores zero", () => {
    expect(batterScore({ player_id: "x" })).toBe(0);
  });

  it("scores the formula correctly", () => {
    // h*3 + hr*4 + rbi*2 + r*1 + bb*0.5 - k*0.3
    expect(
      batterScore({ player_id: "x", h: 3, hr: 1, rbi: 4, r: 2, bb: 1, so: 1 }),
    ).toBeCloseTo(3 * 3 + 1 * 4 + 4 * 2 + 2 + 0.5 - 0.3, 6);
  });

  it("strikeouts are penalized", () => {
    expect(batterScore({ player_id: "x", so: 3 })).toBeCloseTo(-0.9, 6);
  });
});

describe("pitcherScore", () => {
  it("9 IP, 9 K, 0 ER, W → 9 + 4.5 + 3 = 16.5", () => {
    expect(
      pitcherScore({ player_id: "x", ip_outs: 27, so: 9, er: 0, decision: "W" }),
    ).toBeCloseTo(16.5, 6);
  });

  it("ER are heavily penalized", () => {
    // 0 IP, 0 K, 5 ER → 0 + 0 - 7.5 = -7.5
    expect(pitcherScore({ player_id: "x", er: 5 })).toBeCloseTo(-7.5, 6);
  });

  it("no decision = no win bonus", () => {
    expect(
      pitcherScore({ player_id: "x", ip_outs: 27, so: 9 }),
    ).toBeCloseTo(9 + 4.5, 6);
  });
});

describe("calcPOTG", () => {
  it("picks the highest combined score", () => {
    const result = calcPOTG(
      [
        { player_id: "alice", h: 3, hr: 1, rbi: 4 }, // 3*3 + 4 + 8 = 21
        { player_id: "bob", h: 1 }, // 3
      ],
      [
        { player_id: "carol", ip_outs: 27, so: 7, decision: "W" }, // 7 + 4.5 + 3 = 14.5
      ],
    );
    expect(result?.player_id).toBe("alice");
    expect(result?.source).toBe("batting");
  });

  it("combines a player's batting + pitching contributions", () => {
    const result = calcPOTG(
      [{ player_id: "alice", h: 1 }], // 3
      [{ player_id: "alice", ip_outs: 27, so: 9, decision: "W" }], // 9 + 4.5 + 3 = 16.5
    );
    expect(result?.player_id).toBe("alice");
    expect(result?.score).toBeCloseTo(3 + 16.5, 6);
  });

  it("returns null on empty input", () => {
    expect(calcPOTG([], [])).toBeNull();
  });

  it("ignores entries with no player_id", () => {
    const result = calcPOTG(
      [{ player_id: "", h: 100 }, { player_id: "real", h: 1 }],
      [],
    );
    expect(result?.player_id).toBe("real");
  });
});
