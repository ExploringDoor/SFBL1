// ============================================================================
// Making sense of whatever a coach pastes into the GameChanger box.
//
// Island asked for the link at signup and 13 of 36 coaches gave one. Eleven
// pasted a clean URL. The other two were rejected, and neither had done
// anything wrong:
//
//   * Copiague Youth Leagues pasted "0y6pOzgPiAVr", the team id on its own,
//     because that is what GameChanger shows them.
//   * LI Heat 12U pasted a 250-character urldefense.com link, because their
//     mail provider had rewritten the URL before they ever saw it. Proofpoint
//     and Outlook Safe Links both do this to every link in every email, so a
//     coach who copies from the GameChanger invitation email cannot avoid it.
//
// Mike, via Adam, 2026-09-08: "Yes that should be a feature for future
// leagues."
//
// So: unwrap the mail-scanner wrappers, accept a bare id, and return a clean
// canonical URL or null. Never return something that is not GameChanger: a
// team page linking to a stranger's site is worse than no button.
// ============================================================================

/** GameChanger team ids are 10 to 24 url-safe characters, e.g. "IO294CAWDufo". */
const TEAM_ID = /^[A-Za-z0-9_-]{10,24}$/;

const GC_HOST = /^(www\.)?(web\.)?gc\.com$/i;

/** Pull the real URL out of a mail-security rewrite, if that is what this is. */
function unwrap(raw: string): string {
  // Proofpoint v3: https://urldefense.com/v3/__<url>__;<junk>
  const v3 = /urldefense\.(?:com|proofpoint\.com)\/v3\/__(https?:\/\/[^\s]*?)__;/i.exec(raw);
  if (v3?.[1]) return v3[1];

  // Proofpoint v2 and Outlook Safe Links both carry the original in a query
  // parameter, percent-encoded. v2 also uses - and _ for / and =.
  try {
    const u = new URL(raw);
    if (/urldefense/i.test(u.hostname)) {
      const p = u.searchParams.get("u");
      if (p) return decodeURIComponent(p.replace(/-/g, "%").replace(/_/g, "/"));
    }
    if (/safelinks\.protection\.outlook\.com$/i.test(u.hostname)) {
      const p = u.searchParams.get("url");
      if (p) return p;
    }
  } catch {
    /* not a URL yet; the bare-id path below may still handle it */
  }
  return raw;
}

/**
 * Turn whatever was typed into a canonical GameChanger team URL, or null.
 *
 * Returns null rather than guessing when the input is not recognisably
 * GameChanger. The caller stores null and the team page simply shows no
 * button, which is the honest outcome.
 */
export function normalizeGameChangerUrl(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw) return null;

  // A bare team id, which is what GameChanger's own UI shows the coach.
  if (TEAM_ID.test(raw) && /\d/.test(raw) && /[A-Za-z]/.test(raw)) {
    return `https://web.gc.com/teams/${raw}`;
  }

  let candidate = unwrap(raw);
  // "web.gc.com/teams/xxx" with no scheme is common from a copy-paste.
  if (!/^https?:\/\//i.test(candidate) && /^(www\.)?(web\.)?gc\.com\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  let u: URL;
  try {
    u = new URL(candidate);
  } catch {
    return null;
  }
  if (!GC_HOST.test(u.hostname)) return null;

  // Keep the team id and nothing else. The tracking query GameChanger appends
  // (pid=Copy, c=team_share_link_hero_ui_control) is noise, and /live is a
  // view rather than the team.
  const id = /\/teams\/([A-Za-z0-9_-]{10,24})/.exec(u.pathname)?.[1];
  if (!id) return null;
  return `https://web.gc.com/teams/${id}`;
}
