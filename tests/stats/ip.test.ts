import { describe, expect, it } from "vitest";
import {
  formatIP,
  ipDecimal,
  ipFromInningsAndOuts,
  parseIP,
} from "@/lib/stats/ip";

describe("parseIP", () => {
  it("parses integer innings", () => {
    expect(parseIP("0")).toBe(0);
    expect(parseIP("1")).toBe(3);
    expect(parseIP("6")).toBe(18);
    expect(parseIP("100")).toBe(300);
  });

  it("parses .0 suffix", () => {
    expect(parseIP("0.0")).toBe(0);
    expect(parseIP("6.0")).toBe(18);
  });

  it("parses .1 (one out into next inning)", () => {
    expect(parseIP("0.1")).toBe(1);
    expect(parseIP("6.1")).toBe(19);
  });

  it("parses .2 (two outs into next inning)", () => {
    expect(parseIP("0.2")).toBe(2);
    expect(parseIP("6.2")).toBe(20);
  });

  it("trims surrounding whitespace", () => {
    expect(parseIP("  6.2  ")).toBe(20);
    expect(parseIP("\t6.1\n")).toBe(19);
  });

  it("rejects .3+ (would be next full inning)", () => {
    expect(() => parseIP("6.3")).toThrow(/invalid/i);
    expect(() => parseIP("6.4")).toThrow(/invalid/i);
    expect(() => parseIP("6.9")).toThrow(/invalid/i);
  });

  it("rejects non-numeric input", () => {
    expect(() => parseIP("abc")).toThrow(/invalid/i);
    expect(() => parseIP("")).toThrow(/invalid/i);
    expect(() => parseIP("6.")).toThrow(/invalid/i);
    expect(() => parseIP(".2")).toThrow(/invalid/i);
  });

  it("rejects negative numbers", () => {
    expect(() => parseIP("-1")).toThrow(/invalid/i);
    expect(() => parseIP("-1.0")).toThrow(/invalid/i);
  });

  it("rejects multi-digit decimal portion (avoids 6.10 vs 6.1 ambiguity)", () => {
    expect(() => parseIP("6.10")).toThrow(/invalid/i);
    expect(() => parseIP("6.01")).toThrow(/invalid/i);
  });

  it("rejects non-string input loudly", () => {
    // @ts-expect-error — runtime guard for callers that bypass types
    expect(() => parseIP(6.2)).toThrow(/expected string/i);
    // @ts-expect-error
    expect(() => parseIP(null)).toThrow(/expected string/i);
  });
});

describe("formatIP", () => {
  it("formats zero", () => {
    expect(formatIP(0)).toBe("0.0");
  });

  it("formats whole innings", () => {
    expect(formatIP(3)).toBe("1.0");
    expect(formatIP(18)).toBe("6.0");
    expect(formatIP(300)).toBe("100.0");
  });

  it("formats partial innings", () => {
    expect(formatIP(1)).toBe("0.1");
    expect(formatIP(2)).toBe("0.2");
    expect(formatIP(19)).toBe("6.1");
    expect(formatIP(20)).toBe("6.2");
  });

  it("rejects negative outs", () => {
    expect(() => formatIP(-1)).toThrow(/non-negative/);
  });

  it("rejects non-integer outs", () => {
    expect(() => formatIP(1.5)).toThrow(/integer/);
    expect(() => formatIP(NaN)).toThrow(/integer/);
  });
});

describe("round-trips", () => {
  // For every valid (innings, partial), parseIP(formatIP(outs)) === outs
  // — and formatIP(parseIP(s)) gives back the canonical string form.
  it("formatIP → parseIP is identity", () => {
    for (let outs = 0; outs < 50; outs++) {
      expect(parseIP(formatIP(outs))).toBe(outs);
    }
  });

  it("parseIP → formatIP normalizes input", () => {
    expect(formatIP(parseIP("6"))).toBe("6.0");
    expect(formatIP(parseIP("6.0"))).toBe("6.0");
    expect(formatIP(parseIP("0"))).toBe("0.0");
  });
});

describe("ipDecimal (for ERA/WHIP math)", () => {
  it("0 outs is 0 innings", () => {
    expect(ipDecimal(0)).toBe(0);
  });

  it("3 outs is exactly 1.0 innings", () => {
    expect(ipDecimal(3)).toBe(1);
  });

  it("returns float for non-divisible outs", () => {
    expect(ipDecimal(1)).toBeCloseTo(1 / 3, 6);
    expect(ipDecimal(2)).toBeCloseTo(2 / 3, 6);
    expect(ipDecimal(20)).toBeCloseTo(20 / 3, 6); // 6.2 IP = 6.667 dec
  });

  it("rejects negative or non-integer", () => {
    expect(() => ipDecimal(-1)).toThrow();
    expect(() => ipDecimal(1.5)).toThrow();
  });
});

describe("ipFromInningsAndOuts", () => {
  it("composes innings + partial outs", () => {
    expect(ipFromInningsAndOuts(0, 0)).toBe(0);
    expect(ipFromInningsAndOuts(0, 1)).toBe(1);
    expect(ipFromInningsAndOuts(6, 2)).toBe(20);
    expect(ipFromInningsAndOuts(9, 0)).toBe(27);
  });

  it("rejects partial outs >= 3", () => {
    expect(() => ipFromInningsAndOuts(6, 3)).toThrow(/0, 1, or 2/);
    expect(() => ipFromInningsAndOuts(6, 4)).toThrow();
  });

  it("rejects negative or non-integer args", () => {
    expect(() => ipFromInningsAndOuts(-1, 0)).toThrow();
    expect(() => ipFromInningsAndOuts(6, -1)).toThrow();
    expect(() => ipFromInningsAndOuts(6.5, 0)).toThrow();
  });
});

describe("real-world ERA sanity check", () => {
  // Catches the bug class this module exists to prevent: if you store
  // IP as 6.2 (the float) instead of 20 outs, ERA is silently wrong.
  it("9 IP, 3 ER → ERA = 3.00", () => {
    const outs = parseIP("9.0");
    const era = (3 / ipDecimal(outs)) * 9;
    expect(era).toBeCloseTo(3.0, 3);
  });

  it("6.2 IP, 4 ER → ERA = 5.40 (sanity: not 5.81 if we used 6.2 as float)", () => {
    const outs = parseIP("6.2");
    const era = (4 / ipDecimal(outs)) * 9;
    expect(era).toBeCloseTo(5.4, 2);
    // The bug: if you wrongly use 6.2 as a decimal, you'd get:
    const wrong = (4 / 6.2) * 9;
    expect(wrong).toBeCloseTo(5.806, 3);
    expect(era).not.toBeCloseTo(wrong, 2);
  });
});
