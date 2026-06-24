// Box-score batting-line validation.
//
// The stat engine (lib/stats/shared.ts sluggingPct) depends on a single
// invariant: a batting line's total hits must cover its extra-base hits,
//
//     singles = H - 2B - 3B - HR  >=  0      ⇔      H >= 2B + 3B + HR
//
// When a stored line violates this, sluggingPct throws. Because
// recalcLeague aggregates EVERY player in one pass (lib/stats/index.ts),
// that one bad line aborts the entire league recalc with an HTTP 500 —
// no player's stats get written until the offending line is hunted down.
//
// These helpers let every box-score WRITE path reject (or, for the OCR
// review flow, flag) an inconsistent line up front, with a per-player
// message, so the bad data never reaches storage in the first place.
//
// Pure — no I/O, no Firestore. Safe to import from client components
// (the captain editor) and server routes alike.

function num(x: unknown): number {
  if (typeof x === "number") return Number.isFinite(x) ? x : 0;
  if (typeof x === "string" && x.trim() !== "" && !Number.isNaN(Number(x))) {
    return Number(x);
  }
  return 0;
}

// A batting line as it appears at the various write paths. Field names
// vary by source: the editor + Claude parser use `doubles`/`triples`,
// some CSV / legacy shapes use `d`/`t`. We accept either, and coerce
// string values (CSV cells arrive as strings).
export interface BattingLineLike {
  player_id?: unknown;
  name?: unknown;
  h?: unknown;
  doubles?: unknown;
  triples?: unknown;
  hr?: unknown;
  d?: unknown;
  t?: unknown;
}

/**
 * Returns a human-readable reason if `line` violates H >= 2B+3B+HR, or
 * null if the line is consistent. `label` (a player name or id) is
 * prefixed onto the message when provided.
 */
export function battingLineError(
  line: BattingLineLike,
  label?: string,
): string | null {
  const h = num(line.h);
  const doubles = num(line.doubles ?? line.d);
  const triples = num(line.triples ?? line.t);
  const hr = num(line.hr);
  const xb = doubles + triples + hr;
  if (xb > h) {
    const who = label ? `${label}: ` : "";
    return (
      `${who}2B+3B+HR (${xb}) exceeds H (${h}) — singles can't be ` +
      `negative. Box score data is inconsistent.`
    );
  }
  return null;
}

/**
 * Validate a whole lineup, returning one message per offending line.
 * Each bad line is labelled by its `name`, else `player_id`, else its
 * 1-based batting position. Pass `sidePrefix` (e.g. "away") to
 * disambiguate when both teams' lineups are checked together. Non-array
 * input (a missing lineup) yields no errors.
 */
export function collectLineupErrors(
  lines: BattingLineLike[] | undefined,
  sidePrefix?: string,
): string[] {
  if (!Array.isArray(lines)) return [];
  const out: string[] = [];
  lines.forEach((line, i) => {
    const base =
      (typeof line.name === "string" && line.name.trim()) ||
      (typeof line.player_id === "string" && line.player_id) ||
      `batter ${i + 1}`;
    const label = sidePrefix ? `${sidePrefix} ${base}` : String(base);
    const err = battingLineError(line, label);
    if (err) out.push(err);
  });
  return out;
}
