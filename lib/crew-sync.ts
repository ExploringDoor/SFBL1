// Accepting umpire assignments from the system that made them.
//
// The league's schedule lives here; the assigning happens in AssignCrew. These
// are the pure parts of taking a crew list back: validating what arrived, and
// deciding whether each person is somebody the league already knows.
//
// Kept out of the route so it can be tested without Firestore, and because a
// Next route file may only export handlers.

export interface IncomingUmpire {
  name: string;
  email: string;
}

export interface IncomingCrew {
  gameId: string;
  umpires: IncomingUmpire[];
}

export const MAX_CREWS = 2000;
export const MAX_PER_CREW = 6;

/** Length-independent compare, so a wrong secret cannot be recovered a byte at
 *  a time by watching how long the answer takes. */
function secretMatches(given: string, expected: string): boolean {
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) {
    diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Is this caller allowed to write crews?
 *
 * Fails CLOSED when the secret is not configured, the same way
 * /api/pregame-reminder does: a deploy that forgot the env var must refuse
 * everyone rather than admit everyone.
 */
export function authorizeCrewSync(
  headers: { authorization?: string | null; secret?: string | null },
  expected: string | undefined,
): boolean {
  if (!expected) return false;
  const bearer = /^Bearer\s+(.+)$/.exec(headers.authorization ?? "")?.[1];
  const given = (bearer ?? headers.secret ?? "").trim();
  return given.length > 0 && secretMatches(given, expected);
}

/**
 * Pull the request into a shape worth writing, dropping anything malformed
 * rather than trusting it. A game id that is not a plausible Firestore id is
 * skipped outright; a nameless umpire is skipped; the same person twice in one
 * crew becomes one person.
 */
export function parseCrews(raw: unknown): IncomingCrew[] {
  if (!Array.isArray(raw)) return [];
  const out: IncomingCrew[] = [];
  for (const item of raw.slice(0, MAX_CREWS)) {
    const o = (item ?? {}) as Record<string, unknown>;
    const gameId = String(o.gameId ?? "").trim();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(gameId)) continue;
    const list = Array.isArray(o.umpires) ? o.umpires : [];
    const umpires: IncomingUmpire[] = [];
    const seen = new Set<string>();
    for (const u of list.slice(0, MAX_PER_CREW)) {
      const uo = (u ?? {}) as Record<string, unknown>;
      const name = String(uo.name ?? "").trim().slice(0, 80);
      if (!name) continue;
      const email = String(uo.email ?? "").trim().toLowerCase().slice(0, 160);
      const key = email || name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      umpires.push({ name, email });
    }
    out.push({ gameId, umpires });
  }
  return out;
}

/**
 * Match an incoming umpire to one the league already holds.
 *
 * Email first: names repeat within a chapter and people change how they write
 * their own ("Bob Fuchsman", "Robert Fuchsman"). Falling back to the name is
 * what stops a league that never collected emails from growing a duplicate
 * roster on the first sync.
 */
export function matchUmpire(
  u: IncomingUmpire,
  byEmail: Map<string, string>,
  byName: Map<string, string>,
): string | null {
  if (u.email) {
    const hit = byEmail.get(u.email);
    if (hit) return hit;
  }
  return byName.get(u.name.trim().toLowerCase()) ?? null;
}

/** Has this game's crew actually changed? Order matters: the plate umpire is
 *  listed first and moving somebody to the plate is a real change. */
export function crewChanged(before: string[], after: string[]): boolean {
  if (before.length !== after.length) return true;
  return before.some((v, i) => v !== after[i]);
}
