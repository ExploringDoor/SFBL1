// /api/admin-rules — save the structured rules document.
//
// Body: { leagueId, sections[], divisions[], contentUpdated? } → { ok, sections }
//
// WHY THIS EXISTS. Mike, 2026-09-03: "how do I edit the rules". He could not.
// The admin's Pages tab says in so many words that it edits Rules, and for
// Island that was untrue: /rules prefers the STRUCTURED document
// (site_config/rules — division tabs, at-a-glance specs, per-section cards)
// and returns before it ever reaches the markdown editor at the bottom of the
// page. Pages lists page_content docs, so the rules were not even in the list.
//
// Worse than absent: had he created a page_content/rules doc from that tab, it
// would have saved fine and changed nothing on the site, because the structured
// doc wins. So the failure mode was an edit that silently did nothing.
//
// WHY AN API ROUTE, when FieldsManager writes site_config straight from the
// browser. Two reasons, both about this document specifically:
//   1. REVISIONS. The rules are what a coach argues from on a Saturday. A typo
//      pasted over a section at 11pm needs to be recoverable, and a client-side
//      write has no undo. Every save snapshots the previous version first.
//   2. VALIDATION. The public renderer drops any section that is malformed,
//      silently. A save that would empty the page has to be refused here rather
//      than discovered by a coach.
//
// WHO CAN EDIT. Full admin, plus any role holding the "rules" scope. This was
// full-admin-only on the reasoning that the rulebook is policy rather than
// scheduling; Mike asked on 2026-09-06 for his assistant to have it, and it is
// his league. The safety net is real rather than notional: every save
// snapshots the previous version, Undo reads those back, and the audit log
// records who saved what.
//
// The umpire in chief still cannot: that role declares no "rules" scope, so
// widening one role did not widen the other.

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import { hasScope } from "@/lib/admin-roles";
import {
  canEditStructured,
  cleanDivisions,
  cleanSections,
} from "@/lib/rules-doc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Keep this many previous versions. Ten is roughly a season of edits, and
 *  the whole history lives in one document under the 1MB cap. */
const KEEP_REVISIONS = 10;
/** Stop growing the history well short of Firestore's 1MB document limit. A
 *  save must never fail because the UNDO log got too big. */
const MAX_HISTORY_BYTES = 400_000;

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export async function POST(req: Request) {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
  }
  let decoded;
  try {
    // checkRevoked: this rewrites the published rulebook.
    decoded = await getAdminAuth().verifyIdToken(auth.slice(7).trim(), true);
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  let body: {
    leagueId?: unknown;
    sections?: unknown;
    divisions?: unknown;
    contentUpdated?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const leagueId = str(body.leagueId);
  if (!leagueId) {
    return NextResponse.json({ error: "leagueId required" }, { status: 400 });
  }
  if (!hasScope(decoded, leagueId, "rules")) {
    return NextResponse.json({ error: "not admin" }, { status: 403 });
  }

  const rawSections = Array.isArray(body.sections) ? body.sections : null;
  if (!rawSections) {
    return NextResponse.json({ error: "sections must be an array" }, { status: 400 });
  }

  const { sections, dropped } = cleanSections(rawSections);

  // The one refusal that matters. Saving zero sections would blank the rules
  // page for the whole league, and no admin means to do that by pressing Save.
  // Clearing the rules deliberately is a thing to ask for, not to fall into.
  if (!sections.length) {
    return NextResponse.json(
      {
        error:
          "That would leave the rules page empty, so nothing was saved. " +
          "Every section needs a title and at least one line.",
      },
      { status: 400 },
    );
  }

  const divisions = cleanDivisions(body.divisions);

  const db = getAdminDb();
  const ref = db.doc(`leagues/${leagueId}/site_config/rules`);
  const prevSnap = await ref.get();
  const prev = prevSnap.exists ? prevSnap.data() : null;

  // The guard that protects the OTHER leagues. The admin UI already declines to
  // show a form here for a markdown-rules league, but that check runs in the
  // browser and this one does not: writing a structured document for a league
  // that publishes markdown would replace its entire rules page with whatever
  // was typed first. See canEditStructured.
  if (!canEditStructured(prev)) {
    return NextResponse.json(
      {
        error:
          "This league's rules page is a single document, edited on the Pages " +
          "tab. Nothing was changed.",
      },
      { status: 409 },
    );
  }

  // ── snapshot the OUTGOING version, before overwriting it ──────────────
  // Best effort on purpose. A history write that fails must not block the
  // edit the admin actually asked for.
  if (prev?.data) {
    try {
      const histRef = db.doc(`leagues/${leagueId}/site_config/rules_history`);
      const histSnap = await histRef.get();
      const existing = Array.isArray(histSnap.data()?.versions)
        ? (histSnap.data()!.versions as unknown[])
        : [];
      const entry = {
        at: new Date().toISOString(),
        by: decoded.email ?? decoded.uid,
        content_updated: prev.content_updated ?? null,
        data: prev.data,
        divisions: prev.divisions ?? [],
      };
      let versions = [entry, ...existing].slice(0, KEEP_REVISIONS);
      // Trim oldest-first until it comfortably fits. A single enormous
      // rulebook still stores at least the version just replaced.
      while (
        versions.length > 1 &&
        JSON.stringify(versions).length > MAX_HISTORY_BYTES
      ) {
        versions = versions.slice(0, -1);
      }
      await histRef.set({ versions, updated_at: entry.at });
    } catch {
      /* history is a convenience, never a gate on saving */
    }
  }

  const now = new Date().toISOString();
  const today = now.slice(0, 10);

  // content_updated is the date the LEAGUE revised its rules, and it is what
  // the public page stamps at the top.
  //
  // THIS HAS TO ADVANCE BY ITSELF. The editor loads the stored date into its
  // date box and posts it back, so the first version of this kept whatever was
  // already there: Island rewrote how scores are reported on 2026-09-03 and
  // /rules went on saying "Last updated January 5, 2026". A coach reading a
  // stale date decides the page has not changed and keeps texting the old
  // number, which is the exact failure the rules edit was meant to prevent.
  //
  // So: if the CONTENT changed and the admin did not deliberately move the
  // date themselves, stamp today. A date they actually edited is always
  // honoured, which is what makes a typo fix that should not move the date
  // still possible.
  const sentDate = str(body.contentUpdated);
  const prevDate = typeof prev?.content_updated === "string" ? prev.content_updated : "";
  const contentChanged =
    JSON.stringify(prev?.data ?? null) !== JSON.stringify(sections);
  const adminMovedDate = !!sentDate && sentDate !== prevDate;
  const contentUpdated = adminMovedDate
    ? sentDate
    : contentChanged
      ? today
      : sentDate || prevDate || today;

  await ref.set({
    data: sections,
    divisions: divisions.length ? divisions : (prev?.divisions ?? []),
    content_updated: contentUpdated,
    updated_at: now,
    updated_by: decoded.email ?? decoded.uid,
  });

  try {
    await db.collection(`leagues/${leagueId}/audit`).add({
      kind: "edit_rules",
      by_uid: decoded.uid,
      by_email: decoded.email ?? null,
      sections: sections.length,
      dropped,
      at: now,
    });
  } catch {
    /* never fail the save over the audit row */
  }

  return NextResponse.json({
    ok: true,
    sections: sections.length,
    dropped,
    content_updated: contentUpdated,
  });
}
