// Coach uploaded team logos live on the team doc as data: URLs, written by
// /api/captain-team-logo. That was survivable while they were small. It stopped
// being survivable on 2026-08-20: eight Island teams held 1,430,532 characters
// of base64 between them, and app/page.tsx hands the whole teams map to
// HomeAgeStandings, a client component. React serializes every prop that
// crosses a client boundary whether the child draws it or not, so the home page
// shipped 1,568,793 bytes, 91 percent of it base64, and the root
// app/loading.tsx skeleton could not resolve until the last blob had streamed.
// /history had the same problem through HistoryView, and the ticker in
// app/layout.tsx was one real game away from putting it on every page.
//
// Not one of those eight logos was even drawn. HomeAgeStandings renders
// StandingsTable in its "compact" variant, which returns early into a list with
// no logo element at all. Pure payload.
//
// So a data: logo becomes a short URL and the bytes travel out of band, where
// the browser caches them once and reuses them across pages and visits. This is
// the shape SFBL has always had, /logos/sfbl/*.png, and the shape
// app/api/admin-team/route.ts already enforces for admin set logos. It is why
// SFBL draws 56 home page logos inside 138KB total.
//
// The URL is content addressed. The fingerprint changes when the art changes,
// so /api/team-logo can answer immutable and never go stale.
//
// PATH SEGMENTS, NOT A QUERY STRING, deliberately: the local preview proxy
// strips ?query=, which would have 404'd every logo in local verification while
// production looked fine.
//
// NO node:crypto HERE, deliberately. See the header of lib/fees.ts. A module a
// client component might one day import cannot pull a node builtin without
// breaking the browser bundle, and this helper has a name generic enough that
// someone will try. FNV-1a is small enough to just carry.

/** Fingerprint of the logo bytes. Not cryptographic and does not need to be.
 *  Its only job is to change when a coach uploads different art, so that the
 *  immutable cache on /api/team-logo can never serve last season's logo. */
function fingerprint(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * The src to render for a team's logo.
 *
 * Path and http(s) logos are already cheap references, so they pass straight
 * through and every tenant that never used the captain uploader is untouched.
 * Only data: URLs are rewritten. That early return is the entire tenant safety
 * story, do not "simplify" it away.
 */
/**
 * The crest a league lends to a team that has not uploaded one.
 *
 * Mike, 2026-09-07: "when a team doesn't post there logo my logo is
 * automatically there, please add that." Before this, a team with no logo got
 * an empty circle, which on a schedule full of crests reads as a broken image
 * rather than a team that has not got round to it.
 *
 * Per tenant, and only where a league has asked. Falling back platform-wide
 * would put COYBL's crest on every Windmill team the day someone set one.
 */
const LEAGUE_LOGO_FALLBACK: Record<string, string> = {
  island: "/island/logo.png",
};

export function leagueLogoFallback(leagueId: string): string | null {
  return LEAGUE_LOGO_FALLBACK[leagueId] ?? null;
}

export function teamLogoSrc(
  leagueId: string,
  teamId: string,
  raw: unknown,
): string | null {
  // No logo of their own: lend them the league's, where the league has one.
  if (!raw) return leagueLogoFallback(leagueId);
  const s = String(raw);
  if (!s.startsWith("data:")) return s;
  return `/api/team-logo/${encodeURIComponent(leagueId)}/${encodeURIComponent(teamId)}/${fingerprint(s)}`;
}

/**
 * Image types a team logo is allowed to be.
 *
 * RASTER ONLY, and the reason is svg+xml. An SVG is a document: it can carry
 * <script>, and a browser executes it when the file is navigated to directly.
 * Coaches upload these from the captain portal, so an SVG logo would be
 * attacker-supplied script running on islandfastpitch.com's own origin, with
 * that origin's cookies and storage. The captain uploader re-encodes through a
 * canvas to WebP and would never produce one, but the uploader is a
 * convenience, not a control: /api/captain-team-logo is a plain POST and the
 * check that matters has to live where the bytes are stored and where they are
 * served. Both ends use this list.
 *
 * gif is here because an old logo may still be one. avif is not, because
 * nothing produces it here yet and an allowlist should only contain things
 * someone has actually needed.
 */
export const ALLOWED_LOGO_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

/** The mime of a data: URL, lowercased, or null if it is not a data: URL. */
export function dataUrlMime(s: string): string | null {
  const m = /^data:([^;,]+)[;,]/.exec(s);
  return m ? m[1]!.trim().toLowerCase() : null;
}

/** True when this data: URL carries an image type we are willing to store and
 *  serve. Anything else, including svg+xml, is refused. */
export function isAllowedLogoDataUrl(s: string): boolean {
  const mime = dataUrlMime(s);
  return (
    mime != null && (ALLOWED_LOGO_TYPES as readonly string[]).includes(mime)
  );
}
