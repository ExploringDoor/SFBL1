// Innings pitched, as a count of outs.
//
// In baseball notation, "6.2 IP" means six full innings + 2 outs of a
// seventh — i.e. 6 + 2/3 innings, NOT 6.2 actual innings. The decimal
// suffix is always one of {0, 1, 2}; "6.3" is invalid because that's
// just "7.0".
//
// Storing innings as a string ("6.2") or a JS float (6.2 ≈ 6.199…)
// guarantees a parse/format bug class — both DVSL and Long Beach got
// this wrong in subtle ways. We avoid it entirely by storing
// integer outs internally and converting at the boundary.
//
// Total outs = innings × 3 + partial_outs.  e.g. 6.2 IP → 20 outs.

const IP_RE = /^(\d+)(?:\.([012]))?$/;

export function parseIP(input: string): number {
  if (typeof input !== "string") {
    throw new Error(`parseIP: expected string, got ${typeof input}`);
  }
  const trimmed = input.trim();
  const m = trimmed.match(IP_RE);
  if (!m) {
    throw new Error(
      `parseIP: invalid IP string "${input}". ` +
        `Expected "<innings>" or "<innings>.0|.1|.2".`,
    );
  }
  const innings = Number(m[1]);
  const partial = m[2] ? Number(m[2]) : 0;
  return innings * 3 + partial;
}

export function formatIP(outs: number): string {
  if (!Number.isInteger(outs)) {
    throw new Error(`formatIP: outs must be an integer, got ${outs}`);
  }
  if (outs < 0) {
    throw new Error(`formatIP: outs must be non-negative, got ${outs}`);
  }
  const innings = Math.floor(outs / 3);
  const partial = outs % 3;
  return `${innings}.${partial}`;
}

// Decimal innings, for ERA/WHIP math: ERA = (er / ipDecimal) * 9.
// Equivalent (and float-precision-safer): ERA = (er * 27) / outs;
// this helper exists so call sites can write the readable form.
export function ipDecimal(outs: number): number {
  if (!Number.isInteger(outs) || outs < 0) {
    throw new Error(`ipDecimal: outs must be a non-negative integer, got ${outs}`);
  }
  return outs / 3;
}

// Convenience constructor: 6 innings + 2 outs → 20.
export function ipFromInningsAndOuts(innings: number, partialOuts: number): number {
  if (!Number.isInteger(innings) || innings < 0) {
    throw new Error(`ipFromInningsAndOuts: innings must be a non-negative integer`);
  }
  if (!Number.isInteger(partialOuts) || partialOuts < 0 || partialOuts > 2) {
    throw new Error(`ipFromInningsAndOuts: partialOuts must be 0, 1, or 2`);
  }
  return innings * 3 + partialOuts;
}
