// Town scoping for the commissioner passwords (server side).
//
// East Texas Basketball is run by one commissioner per town, and each town's
// password may enter scores only for games that involve one of that town's
// teams. The binding is the team doc's `organization` field — the Teams tab
// calls it "Town / organization" — and the token carries `admin_town` (see
// lib/admin-roles.ts). Firestore rules cannot resolve town → teams, so the
// check lives here and is called by the API routes that write scores, which
// already run with the Admin SDK.
//
// Fails closed: a team with no organization, or a team doc that does not
// exist, is never in anyone's town. A full admin has no town and never calls
// this, so existing tenants pay nothing for it.

import type { Firestore } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { teamInTown } from "@/lib/admin-roles";

/** Which of `gameIds` a `town` password may NOT touch.
 *
 *  `forbidden` — games that exist but have no team from the town.
 *  `missing`   — ids with no game doc; left to the caller's own "not found"
 *                handling so a typo reads as a typo, not as a permission
 *                error. */
export async function checkGamesInTown(
  db: Firestore,
  leagueId: string,
  gameIds: string[],
  town: string,
): Promise<{ forbidden: string[]; missing: string[] }> {
  const ids = [...new Set(gameIds)];
  const gameSnaps = await Promise.all(
    ids.map((id) => db.doc(`leagues/${leagueId}/games/${id}`).get()),
  );

  const teamIds = new Set<string>();
  for (const s of gameSnaps) {
    if (!s.exists) continue;
    const d = s.data() ?? {};
    for (const k of ["away_team_id", "home_team_id"] as const) {
      const v = d[k];
      if (typeof v === "string" && v) teamIds.add(v);
    }
  }
  const teamSnaps = await Promise.all(
    [...teamIds].map((id) => db.doc(`leagues/${leagueId}/teams/${id}`).get()),
  );
  const inTown = new Map<string, boolean>();
  for (const s of teamSnaps) {
    inTown.set(s.id, s.exists && teamInTown((s.data() ?? {}).organization, town));
  }

  const forbidden: string[] = [];
  const missing: string[] = [];
  ids.forEach((id, i) => {
    const s = gameSnaps[i]!;
    if (!s.exists) {
      missing.push(id);
      return;
    }
    const d = s.data() ?? {};
    const ok =
      inTown.get(String(d.away_team_id ?? "")) === true ||
      inTown.get(String(d.home_team_id ?? "")) === true;
    if (!ok) forbidden.push(id);
  });
  return { forbidden, missing };
}

/** The 403 a route returns when a town password reaches past its town. The
 *  ids are included so the Scores tab can say which rows were refused. */
export function townForbidden(town: string, forbidden: string[]) {
  return NextResponse.json(
    {
      error:
        `Your ${town} password only covers games with a ${town} team. ` +
        `Not allowed: ${forbidden.join(", ")}`,
      forbidden_game_ids: forbidden,
    },
    { status: 403 },
  );
}
