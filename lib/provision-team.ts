// Turn a COYBL team registration into a real team the coach can use.
//
// Doug's 2027 model (2026-08-02):
//   - coaches register fresh; a returning coach is NOT reconnected to last
//     season's team, so every registration creates a NEW team
//   - the team appears on the Teams page as soon as they register
//   - Doug assigns the division later, in the admin panel
//
// So this creates the team with the age group the coach chose, leaves the
// division blank for Doug, connects the coach's login to it, and seeds the
// league's payment ledger with what they owe.
//
// IMPORTANT: no `w`/`l`/`t` fields are written. Standings are computed from
// games (app/standings/page.tsx only uses a stored record when a team
// actually has one), and Doug confirmed every game counts. Writing a zeroed
// record here would silently freeze the whole league's standings.

import type { auth as AdminAuth } from "firebase-admin";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import { initialsFromName } from "@/lib/team-initials";

export interface ProvisionResult {
  teamId: string | null;
  created: boolean;
  boundCoach: boolean;
}

/** "10U" -> 10, for sorting age groups 7U..14U. */
function ageOrderOf(ageGroup: string): number {
  const m = /^(\d+)/.exec(ageGroup.trim());
  return m ? Number(m[1]) : 999;
}

/** The registration fee this team owes, in dollars. Mirrors lib/square.ts. */
function feeFor(data: Record<string, unknown>): number {
  const base = String(data.insurance_option ?? "") === "option-2" ? 425 : 495;
  return base + (String(data.usssa_addon ?? "") === "yes" ? 50 : 0);
}

export async function provisionCoyblTeam(
  leagueId: string,
  submissionId: string,
  data: Record<string, unknown>,
): Promise<ProvisionResult> {
  const str = (k: string) =>
    typeof data[k] === "string" ? (data[k] as string).trim() : "";

  const teamName = str("team_name");
  const ageGroup = str("age_group");
  const email = str("email");
  if (!teamName || !ageGroup) {
    return { teamId: null, created: false, boundCoach: false };
  }

  const db = getAdminDb();
  const teamsCol = db.collection(`leagues/${leagueId}/teams`);

  // Idempotency: a double-submit (or a retry) must not create two teams.
  // The submission id is stamped on the team, so the same registration
  // always resolves to the same team.
  const existing = await teamsCol
    .where("registration_id", "==", submissionId)
    .limit(1)
    .get();

  let teamId: string;
  let created = false;
  if (!existing.empty) {
    teamId = existing.docs[0]!.id;
  } else {
    const ref = teamsCol.doc();
    await ref.set({
      name: teamName,
      abbrev: initialsFromName(teamName),
      ageGroup,
      // Doug assigns this in the admin panel after registration closes.
      // Blank, not "TBD", so it sorts and filters as genuinely unset.
      division: "",
      ageOrder: ageOrderOf(ageGroup),
      divOrder: 999,
      logo_url: null,
      organization: str("organization") || null,
      registration_id: submissionId,
      registered_email: email || null,
      created_at: new Date().toISOString(),
      created_by: "registration",
    });
    teamId = ref.id;
    created = true;
  }

  // Connect the coach's login to this team so they can post games, enter
  // scores and log pitch counts without a manual step from the office.
  let boundCoach = false;
  if (email) {
    try {
      const auth = getAdminAuth();
      let user: AdminAuth.UserRecord;
      try {
        user = await auth.getUserByEmail(email);
      } catch {
        user = await auth.createUser({ email });
      }
      const claims = (user.customClaims ?? {}) as {
        leagues?: Record<string, string>;
      };
      const leagues = { ...(claims.leagues ?? {}) };
      // Never downgrade an admin who happens to register a team.
      if (leagues[leagueId] !== "admin") {
        leagues[leagueId] = `captain:${teamId}`;
        await auth.setCustomUserClaims(user.uid, { ...claims, leagues });
      }
      boundCoach = true;
    } catch (err) {
      console.error("[provision-team] could not bind coach", err);
    }
  }

  // Seed the league's payment ledger so the office sees what this team owes
  // without typing it in. Merge, so a recorded payment is never overwritten.
  try {
    await db.doc(`leagues/${leagueId}/team_payments/${teamId}`).set(
      {
        team_name: teamName,
        amount_due: feeFor(data),
        registration_id: submissionId,
      },
      { merge: true },
    );
  } catch (err) {
    console.error("[provision-team] could not seed payment ledger", err);
  }

  // Record the link back on the submission so the admin inbox can show which
  // team a registration became, and so retries stay idempotent.
  try {
    await db
      .doc(
        `leagues/${leagueId}/form_submissions/team_registration/items/${submissionId}`,
      )
      .set({ assigned_team_id: teamId }, { merge: true });
  } catch {
    /* non-fatal */
  }

  return { teamId, created, boundCoach };
}
