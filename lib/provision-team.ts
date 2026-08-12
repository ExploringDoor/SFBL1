// Turn a team registration into a real team the coach can use.
//
// Written for COYBL, which calls it automatically from the registration
// handler, but nothing below is COYBL-specific any more: the fee comes from
// lib/square.ts (the same function that decides what a card is charged) and
// the division is taken from the registration when the league collects one.
// Island calls it from the admin panel instead, because Mike assigns teams by
// hand rather than auto-provisioning every signup.
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
import { feeFor } from "@/lib/square";
import { initialsFromName } from "@/lib/team-initials";
import { generateTeamCode } from "@/lib/team-code";

export interface ProvisionResult {
  teamId: string | null;
  created: boolean;
  boundCoach: boolean;
  /** The team's sign-in code, so the caller can email it to the coach.
   *  Null when the team already had one (a re-submit must not change a code
   *  the coach has already been given). */
  teamCode: string | null;
}

/** "10U" -> 10, for sorting age groups 7U..14U. */
function ageOrderOf(ageGroup: string): number {
  const m = /^(\d+)/.exec(ageGroup.trim());
  return m ? Number(m[1]) : 999;
}

export async function provisionTeamFromRegistration(
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
    return { teamId: null, created: false, boundCoach: false, teamCode: null };
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
      // COYBL collects no division at signup — Doug assigns it in the admin
      // panel after registration closes, and blank (not "TBD") keeps it
      // sorting and filtering as genuinely unset. Island DOES ask which
      // league, so use it rather than throwing the coach's answer away and
      // making the office re-enter it.
      division: str("division"),
      ageOrder: ageOrderOf(ageGroup),
      divOrder: 999,
      // The logo the coach uploaded during registration.
      //
      // This was hardcoded null, so a coach followed the form's promise —
      // "upload a PNG and it appears next to your team on the scores, schedule
      // and standings pages" — and their logo went into the submission and
      // nowhere else. Same storage shape the captain portal's Team Logo tab
      // uses: a client-resized PNG data URL on logo_url, no Storage bucket.
      // Capped at the same 400KB /api/captain-team-logo enforces, since the
      // teams collection is read whole on every public page.
      logo_url:
        str("team_logo").startsWith("data:image/") &&
        str("team_logo").length <= 400_000
          ? str("team_logo")
          : null,
      organization: str("organization") || null,
      registration_id: submissionId,
      registered_email: email || null,
      created_at: new Date().toISOString(),
      created_by: "registration",
    });
    teamId = ref.id;
    created = true;
  }

  // Mint the team's sign-in code. This is what the coach types on the captain
  // page, so it is generated once and never silently rotated: a re-submitted
  // registration must not invalidate a code the coach already has.
  //
  // Lives on the PRIVATE _private/auth subdoc, because the public team doc is
  // world-readable. The public doc only carries has_captain_password, a
  // non-secret marker the admin UI uses to show "code set".
  let teamCode: string | null = null;
  try {
    const authRef = db.doc(`leagues/${leagueId}/teams/${teamId}/_private/auth`);
    const cur = await authRef.get();
    const existing = String(cur.data()?.captain_password ?? "").trim();
    if (existing) {
      teamCode = existing;
    } else {
      teamCode = generateTeamCode();
      await authRef.set(
        {
          captain_password: teamCode,
          updated_at: new Date().toISOString(),
          updated_by_uid: "registration",
        },
        { merge: true },
      );
      await teamsCol.doc(teamId).set({ has_captain_password: true }, { merge: true });
    }
  } catch (err) {
    console.error("[provision-team] could not mint the team code", err);
  }

  // Put the coach's contact where the Captains view reads it
  // (teams/{id}/_private/contact -> managers[]). Writing it only onto the
  // team doc left every freshly registered team showing "no email on file",
  // even though the coach had just typed their email into the form.
  //
  // _private is the right home for it: the public team doc is world-readable,
  // so contact details must not sit there.
  try {
    const who = [str("manager_first_name"), str("manager_last_name")]
      .filter(Boolean)
      .join(" ");
    // Head coach first, then the assistant when one was given. Both land in
    // managers[], which is what the Captains view lists, what the payment
    // reminder writes to, and who gets the team's sign-in code — so naming an
    // assistant on the form actually gives them access rather than just
    // recording a name nobody uses.
    const managers: {
      name: string;
      email: string;
      phone: string;
      role: string;
      source: string;
    }[] = [];
    if (email || who) {
      managers.push({
        name: who || email,
        email,
        phone: str("phone"),
        role: "head coach",
        source: "registration",
      });
    }
    const asstEmail = str("asst_email");
    const asstWho = [str("asst_first_name"), str("asst_last_name")]
      .filter(Boolean)
      .join(" ");
    if (asstEmail || asstWho) {
      managers.push({
        name: asstWho || asstEmail,
        email: asstEmail,
        phone: str("asst_phone"),
        role: "assistant coach",
        source: "registration",
      });
    }
    if (managers.length > 0) {
      await db
        .doc(`leagues/${leagueId}/teams/${teamId}/_private/contact`)
        .set({ managers }, { merge: true });
    }
  } catch (err) {
    console.error("[provision-team] could not save the coach contact", err);
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
        amount_due: feeFor(leagueId, data),
        registration_id: submissionId,
      },
      { merge: true },
    );
  } catch (err) {
    console.error("[provision-team] could not seed payment ledger", err);
  }

  // Add the team's home field to the league's field list, so the office does
  // not have to retype 196 addresses and the schedule's field dropdown, the
  // public Fields page and directions all work from day one.
  //
  // Deduped on the field NAME, case-insensitively: many teams share a park.
  // When the park already exists we do NOT skip, we ADD this team to its
  // `team` list. Skipping outright meant the second, third and fourth team at
  // Etna Park were invisible on the public Fields page, which only ever
  // credited whoever registered first.
  try {
    const fieldName = str("home_field_name");
    if (fieldName) {
      const parts = [
        str("home_field_street"),
        [str("home_field_city"), str("home_field_zip")]
          .filter(Boolean)
          .join(" "),
      ].filter(Boolean);
      const ref = db.doc(`leagues/${leagueId}/site_config/fields`);
      const snap = await ref.get();
      const existing: unknown = snap.exists ? snap.data()?.data : null;
      const list: Record<string, unknown>[] = Array.isArray(existing)
        ? existing.map((f) =>
            typeof f === "string" ? { name: f, address: "" } : { ...(f ?? {}) },
          )
        : [];
      const idx = list.findIndex(
        (f) =>
          String(f.name ?? "").trim().toLowerCase() === fieldName.toLowerCase(),
      );

      if (idx === -1) {
        list.push({
          name: fieldName,
          address: parts.join(", "),
          // Whose home field this is. Without it the Fields list is a pile of
          // parks with no indication of who plays where.
          team: teamName,
          ...(str("home_field_maps") ? { mapsUrl: str("home_field_maps") } : {}),
        });
      } else {
        // Park is already listed. Add this team to it, leaving the address and
        // map link the office may have corrected by hand alone.
        const cur = list[idx]!;
        const teams = (
          Array.isArray(cur.team) ? cur.team : cur.team ? [cur.team] : []
        )
          .filter((t): t is string => typeof t === "string" && t.trim() !== "")
          .map((t) => t.trim());
        if (!teams.some((t) => t.toLowerCase() === teamName.toLowerCase())) {
          teams.push(teamName);
        }
        cur.team = teams.length === 1 ? teams[0] : teams;
        // Fill in a map link only if the entry has none.
        if (!cur.mapsUrl && str("home_field_maps")) {
          cur.mapsUrl = str("home_field_maps");
        }
      }
      await ref.set({ data: list }, { merge: true });
    }
  } catch (err) {
    console.error("[provision-team] could not add the home field", err);
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

  return { teamId, created, boundCoach, teamCode };
}

/** Old name, kept so the COYBL registration path reads as it always did. */
export const provisionCoyblTeam = provisionTeamFromRegistration;
