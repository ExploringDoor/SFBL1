// Season support. The platform historically treated every game as one
// endless season; this adds an optional per-league season so a league can
// start a fresh season (new standings from 0) while keeping past seasons
// viewable as history.
//
// Model:
//   - Each game carries an optional `season` id (a string, e.g. "66").
//   - The league config doc carries `current_season` (the active id) and
//     `seasons` (the list of {id,label} for the switcher).
//
// FAIL-SAFE BY DESIGN — this must never hide a live game by accident:
//   - No `current_season` set on the league  → no filtering at all.
//   - A game with no `season` field          → shown in every view.
// So a league that hasn't opted in behaves exactly as before, and a
// mis-tagged/untagged game always shows up rather than silently vanishing.

import type { Firestore } from "firebase-admin/firestore";

export interface SeasonOption {
  id: string;
  label: string;
  // Draft seasons (published === false) can be built/assigned by admins and
  // previewed via ?season=, but are hidden from the public season switcher.
  // Absent = published (back-compat).
  published?: boolean;
}
export interface SeasonConfig {
  current: string | null;
  seasons: SeasonOption[];
}

const cache = new Map<string, { cfg: SeasonConfig; exp: number }>();
// Short TTL: season is a small single-doc read, and admins toggle the
// active season / publish state and expect it to take effect promptly.
const TTL_MS = 60_000;

// Reads `current_season` + `seasons` off the league config doc, cached for
// 10 min (so flipping the season is a one-field edit that takes effect
// within minutes, no deploy). Any read failure → the no-op config.
export async function loadSeasonConfig(
  db: Firestore,
  tenantId: string,
): Promise<SeasonConfig> {
  const hit = cache.get(tenantId);
  if (hit && Date.now() < hit.exp) return hit.cfg;

  let cfg: SeasonConfig = { current: null, seasons: [] };
  try {
    const data = (await db.doc(`leagues/${tenantId}`).get()).data() ?? {};
    const current =
      typeof data.current_season === "string" && data.current_season
        ? data.current_season
        : null;
    const seasons: SeasonOption[] = Array.isArray(data.seasons)
      ? data.seasons
          .filter(
            (s: unknown): s is { id: unknown; label?: unknown } =>
              !!s && typeof s === "object" && typeof (s as { id?: unknown }).id === "string",
          )
          .map((s) => {
            const o = s as { id: unknown; label?: unknown; published?: unknown };
            return {
              id: String(o.id),
              label: String(o.label ?? o.id),
              published: o.published === false ? false : true,
            };
          })
      : [];
    cfg = { current, seasons };
  } catch {
    /* fail-safe: leave the no-op config */
  }
  cache.set(tenantId, { cfg, exp: Date.now() + TTL_MS });
  return cfg;
}

// Which season a page should show: an explicit, KNOWN `?season=` wins
// (the switcher); otherwise the league's current season; otherwise null
// (= show everything, for leagues that never opted in).
export function resolveActiveSeason(
  requested: string | undefined | null,
  cfg: SeasonConfig,
): string | null {
  if (requested && cfg.seasons.some((s) => s.id === requested)) return requested;
  return cfg.current;
}

// Seasons the public should see in the switcher — drafts excluded.
export function publicSeasons(cfg: SeasonConfig): SeasonOption[] {
  return cfg.seasons.filter((s) => s.published !== false);
}

// Fail-safe membership test (see file header). Pass a game's raw season
// value (may be undefined) and the active season.
export function inSeason(gameSeason: unknown, active: string | null): boolean {
  if (!active) return true; // league hasn't opted in → show all
  const s = typeof gameSeason === "string" ? gameSeason : "";
  if (!s) return true; // untagged game → never hide it
  return s === active;
}
