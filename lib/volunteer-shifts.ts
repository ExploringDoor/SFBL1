// The snack-bar / volunteer PII boundary, in one place.
//
// A shift claim carries the volunteer's name, email and phone. The public
// shift board is world-readable, so it must carry none of that — a parent
// signing up to run the snack bar has not agreed to publish their phone
// number on the league website.
//
// `projectPublicClaim` is the ONLY thing that should build the public side of
// a claim. It copies an explicit allow-list rather than spreading the
// submission, so a field added to the form later cannot reach the public doc
// by accident. Same rule, and same reasoning, as lib/player-ads.ts.
//
// JOBS (2026-09-09, ETBL). The board began life as the snack-bar sign-up. A
// youth basketball game also needs someone on the clock and someone keeping
// the scorebook, so a shift now carries a `job` and, when it was generated
// from the schedule, the game it belongs to. A shift saved before jobs
// existed has no `job` and means what it always meant: the snack bar.

/** What a claim looks like once it is safe to show the world. */
export interface PublicClaim {
  /** "Sarah M." — enough for a volunteer to recognise their own slot and for
   *  the league to see the shift is covered, without publishing a full name. */
  display_name: string;
  claimed_at: string;
}

export interface ClaimInput {
  name?: unknown;
  email?: unknown;
  phone?: unknown;
}

/** First name + last initial. "Sarah Mitchell" -> "Sarah M." A single-word
 *  name is returned as-is; nothing is invented. */
export function displayName(fullName: string): string {
  const parts = String(fullName ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!;
  const last = parts[parts.length - 1]!;
  return `${parts.slice(0, -1).join(" ")} ${last[0]!.toUpperCase()}.`;
}

/** Build the public claim. Allow-list by construction: this function cannot
 *  emit a contact field because it never reads one. */
export function projectPublicClaim(
  input: ClaimInput,
  nowIso: string,
): PublicClaim | null {
  const name = displayName(String(input.name ?? ""));
  if (!name) return null;
  return { display_name: name, claimed_at: nowIso };
}

/** Normalise and bound-check the private side of a claim. Returns null when
 *  there is no usable name, which is the one genuinely required field. */
export function normaliseClaim(
  input: ClaimInput,
): { name: string; email: string; phone: string } | null {
  const name = String(input.name ?? "").trim().slice(0, 80);
  if (!name) return null;
  const email = String(input.email ?? "").trim().slice(0, 160);
  const phone = String(input.phone ?? "").trim().slice(0, 40);
  return { name, email, phone };
}

/** The jobs a game needs covered. Free text is allowed on top of these; they
 *  are what the admin's generator offers and how the board orders a game's
 *  cards (clock, book, snack bar — the order a parent walks in and sees). */
export const DEFAULT_JOBS = ["Clock", "Scorebook", "Snack Bar"] as const;

/** What a shift with no `job` means. The board was the snack-bar sign-up
 *  before jobs existed, so LCYBL's shifts keep meaning exactly that. */
export const DEFAULT_JOB = "Snack Bar";

/** A shift as stored. `claims` holds only projected public claims. */
export interface Shift {
  id: string;
  date: string;
  start: string;
  end?: string;
  location?: string;
  /** How many volunteers this shift needs. */
  slots: number;
  claims: PublicClaim[];
  note?: string;
  /** Job label. Absent on shifts saved before jobs existed → DEFAULT_JOB. */
  job?: string;
  /** Set when the shift was generated from the schedule: the id under
   *  leagues/{id}/games. */
  game_id?: string;
  /** "Mineola 3B Red vs Quitman 3B Blue — 3rd Grade Boys". Denormalised so
   *  the public board never joins games; team names are public already. */
  game_label?: string;
}

/** Slots still open. Never negative, even if a shift's size is reduced after
 *  people have already signed up. */
export function openSlots(s: Pick<Shift, "slots" | "claims">): number {
  return Math.max(0, (s.slots ?? 0) - (s.claims?.length ?? 0));
}

/** The job a shift is for, defaulting a pre-jobs shift to the snack bar. */
export function jobOf(s: Pick<Shift, "job">): string {
  const j = String(s.job ?? "").trim();
  return j || DEFAULT_JOB;
}

/** Bound and default a job label from a request body. */
export function normaliseJob(raw: unknown): string {
  const j = String(raw ?? "")
    .trim()
    .slice(0, 40);
  return j || DEFAULT_JOB;
}

/** "Snack Bar" → "snack_bar". Only [a-z0-9_] survive, so the result is safe
 *  inside a shift id. */
export function jobSlug(job: string): string {
  return (
    String(job ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "job"
  );
}

/** Slots per shift, 1–20 — the same bound the API applies on save. */
export function clampSlots(n: unknown): number {
  return Math.max(1, Math.min(20, Number(n) || 1));
}

/** The deterministic id of a shift generated for one game and one job.
 *  Re-running the generator over the same schedule therefore MERGES into
 *  the same docs (claims survive) instead of doubling the board. Always
 *  matches the API's id charset; the game part is trimmed before the job
 *  suffix so two jobs on a long game id can never collide. */
export function shiftIdFor(gameId: string, job: string): string {
  const suffix = `__${jobSlug(job)}`;
  const safeGame = String(gameId ?? "").replace(/[^a-zA-Z0-9_-]/g, "_");
  const room = Math.max(1, 64 - suffix.length);
  return `${safeGame.slice(0, room)}${suffix}`;
}

/** "Away vs Home — Division". Team names come from the caller so this stays
 *  pure; an id with no known name is shown as the id. */
export function gameLabel(g: {
  away: string;
  home: string;
  division?: string | null;
}): string {
  const base = `${g.away} vs ${g.home}`;
  const d = String(g.division ?? "").trim();
  return d ? `${base} — ${d}` : base;
}

/** The slice of a game doc the generator needs. `date` must already be the
 *  wall-clock YYYY-MM-DD of the game (the route derives it). */
export interface GameForShift {
  id: string;
  date: string;
  time: string;
  field?: string | null;
  away_team_id: string;
  home_team_id: string;
  division?: string | null;
  status?: string | null;
}

export interface JobSpec {
  job: string;
  slots: number;
}

/** Games that need no crew: not being played, or not yet real. */
export const SKIPPED_STATUSES = new Set([
  "draft",
  "ppd",
  "rained_out",
  "postponed",
  "cancelled",
  "bye",
]);

/** One shift per (game × job). Pure, so idempotency and the label are unit-
 *  testable without Firestore. Skips games with a skipped status, no usable
 *  date, or no usable start time; `gym` (case-insensitive, on `field`) limits
 *  the run to one building. */
export function shiftsFromGames(
  games: GameForShift[],
  teamNameOf: (teamId: string) => string,
  jobs: JobSpec[],
  gym?: string | null,
): Array<Omit<Shift, "claims">> {
  const gymKey = String(gym ?? "")
    .trim()
    .toLowerCase();
  // Same job twice in the spec would be the same id twice; keep the first.
  const specs: JobSpec[] = [];
  const seenJobs = new Set<string>();
  for (const spec of jobs) {
    const job = normaliseJob(spec?.job);
    if (seenJobs.has(job)) continue;
    seenJobs.add(job);
    specs.push({ job, slots: clampSlots(spec?.slots) });
  }

  const out: Array<Omit<Shift, "claims">> = [];
  for (const g of games) {
    const status = String(g.status ?? "").toLowerCase();
    if (status && SKIPPED_STATUSES.has(status)) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(g.date ?? ""))) continue;
    if (!/^\d{1,2}:\d{2}$/.test(String(g.time ?? ""))) continue;
    const field = String(g.field ?? "").trim();
    if (gymKey && field.toLowerCase() !== gymKey) continue;
    const label = gameLabel({
      away: teamNameOf(g.away_team_id),
      home: teamNameOf(g.home_team_id),
      division: g.division,
    });
    for (const spec of specs) {
      out.push({
        id: shiftIdFor(g.id, spec.job),
        date: g.date,
        start: g.time,
        end: "",
        location: field,
        slots: spec.slots,
        job: spec.job,
        game_id: g.id,
        game_label: label,
      });
    }
  }
  return out;
}

/** Sort key so one game's cards sit together in the order a parent thinks of
 *  them: the default jobs first in their listed order, then anything custom
 *  alphabetically. */
export function jobOrder(job: string): number {
  const i = (DEFAULT_JOBS as readonly string[]).indexOf(job);
  return i === -1 ? DEFAULT_JOBS.length : i;
}
