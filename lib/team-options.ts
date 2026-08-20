// Team-name form fields, and the single place that decides whether a public
// form is allowed to say who is in the league.
//
// Three public forms (team waiver, umpire evaluation, player registration)
// each hydrated a Team dropdown straight from leagues/{id}/teams with its own
// private copy of this function. Island turned flags.hide_teams on 2026-08-14
// so the field stays private until Mike releases the schedule, /teams started
// rendering the notice, and all ten real team names carried on shipping in the
// server rendered HTML of those three forms. Opening the dropdown was never
// required: the names sat in the option markup and again in the RSC payload,
// so view-source had the whole list, demo teams included.
//
// Same flag and same check as components/ui/TeamsHiddenNotice.tsx, on purpose.
// A second mechanism is a second thing to remember to flip.
//
// The flag is read BEFORE Firestore, like app/teams/page.tsx: there is no
// point paying for a teams fetch whose result has to be thrown away, and a
// list that was never loaded cannot leak back through a later refactor. That
// is also why the names are absent from BOTH the option markup and the flight
// payload: they are serialised from the same field object.
//
// With the flag off, every field this builds is identical to what the three
// pages built before. Flipping it back needs no deploy.

import { getAdminDb } from "@/lib/firebase-admin";
import type { FormField } from "@/components/forms/LeagueForm";
import type { PublicLeagueConfig } from "@/lib/tenants";

export interface TeamOption {
  value: string;
  label: string;
}

/** Is this tenant keeping its field private right now? */
export function teamsHidden(config: PublicLeagueConfig | null): boolean {
  return config?.flags?.hide_teams === true;
}

/** The league's team names for a form dropdown, or nothing while the field is
 *  private.
 *
 *  Also returns [] on a Firestore failure, which is what all three call sites
 *  already did: a form that cannot reach the roster still has to be fillable.
 */
export async function loadTeamOptions(
  tenantId: string | null,
  config: PublicLeagueConfig | null,
): Promise<TeamOption[]> {
  if (!tenantId || teamsHidden(config)) return [];
  try {
    const snap = await getAdminDb()
      .collection(`leagues/${tenantId}/teams`)
      .get();
    return snap.docs
      .map((d) => {
        const name = String(d.data().name ?? d.id);
        return { value: name, label: name };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  } catch {
    return [];
  }
}

/** A "which team" field: a dropdown normally, a typed name while the field is
 *  private.
 *
 *  Free text rather than a dropdown trimmed down to its sentinels, because
 *  every field built here is REQUIRED. A select offering only
 *  "Other / Not listed" would make every team waiver record its signer as
 *  "Other", and a waiver that cannot name the team it covers is not evidence
 *  of anything. The team waiver is mandatory before the first game, so this
 *  field failing shut is worse than the leak it was closing.
 *
 *  Downstream, a typed name is stored and printed and nothing more:
 *  /api/league-form keeps team_name, team_affiliation, visiting_team and
 *  home_team as plain strings checked only for non-empty, the confirmation and
 *  office emails interpolate them, and the admin summary lines interpolate
 *  them. The one place that matches a name against a team doc is the
 *  assign-to-roster panel in components/admin/FormSubmissionsViewer.tsx, and
 *  only to PRESELECT the admin's dropdown. A typo there costs a click, not a
 *  misrouted player: the API needs a teamId the admin picked.
 */
export function teamNameField(opts: {
  name: string;
  label: string;
  teams: TeamOption[];
  hidden: boolean;
  required?: boolean;
  width?: "full" | "half";
  /** Sentinels listed above the real teams (player registration's Free Agent). */
  leadingOptions?: TeamOption[];
  /** Sentinels listed below (Starting a new team, Other / Not listed). */
  trailingOptions?: TeamOption[];
  /** Hint under the dropdown. */
  help?: string;
  /** Hint used instead while the field is private. Say what to type: there is
   *  no longer a list to recognise the answer in. */
  hiddenHelp?: string;
  placeholder?: string;
}): FormField {
  const {
    name,
    label,
    teams,
    hidden,
    required,
    width = "full",
    leadingOptions = [],
    trailingOptions = [],
    help,
    hiddenHelp,
    placeholder,
  } = opts;

  if (hidden) {
    return {
      name,
      label,
      type: "text",
      required,
      width,
      placeholder,
      help: hiddenHelp ?? help,
    };
  }

  return {
    name,
    label,
    type: "select",
    required,
    options: [...leadingOptions, ...teams, ...trailingOptions],
    width,
    help,
  };
}
