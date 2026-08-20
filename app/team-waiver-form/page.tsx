// Public team-waiver form. Replaces the static PDF on
// sfbl.com/team-waiver-form/ with a real fillable form. The signed
// submission stores the team name + manager + a typed-name e-signature
// so league admins can prove every team agreed before play.
//
// Server component (async) so the Team field hydrates from the real
// roster — managers can pick their team instead of free-typing it
// (which used to leave admins guessing about spelling).
//
// Unless the tenant is hiding its field. This page shipped all ten Island team
// names in view-source for six days while /teams was showing the "list goes up
// with the schedule" notice, because the dropdown was built from Firestore
// with no idea the flag existed. lib/team-options.ts owns that decision now.

import { headers } from "next/headers";
import { LeagueForm, type FormField } from "@/components/forms/LeagueForm";
import { getAdminDb } from "@/lib/firebase-admin";
import { loadTeamOptions, teamNameField, teamsHidden } from "@/lib/team-options";
import type { PublicLeagueConfig } from "@/lib/tenants";

export const dynamic = "force-dynamic";

const OTHER = "Other / Not listed";

// Default waiver text. Tenants override it with page_content/waiver, because
// this copy is SFBL-specific in two ways that matter legally: it names the
// league, and it asserts every participant is 18+. A youth league (Island
// Fastpitch runs 8U to 18U) cannot use either claim.
const DEFAULT_WAIVER_TEXT = `On behalf of myself, my team, and every player on our roster, I acknowledge that participation in the South Florida Baseball League involves inherent risks of injury including, but not limited to, permanent disability and death.

We knowingly and freely assume all such risks, both known and unknown, including those arising from the negligence of the league, its officers, agents, employees, other participants, sponsors, or owners and lessors of fields used.

I, for myself and on behalf of every team member and our heirs, assigns, personal representatives, and next of kin, hereby release and hold harmless the South Florida Baseball League, its officers, officials, agents, employees, sponsors, host facilities, and any other associated entities ("Releasees") from any and all claims of injury, disability, death, or property loss arising from participation in league activities.

I confirm that every team member is at least 18 years of age and has individually signed (or will sign) the SFBL Player Liability Release before taking the field.

I have read this waiver thoroughly, understand its full meaning, and agree to its terms by signing below.`;

async function loadWaiverText(tenantId: string | null): Promise<string> {
  if (!tenantId) return DEFAULT_WAIVER_TEXT;
  try {
    const snap = await getAdminDb()
      .doc(`leagues/${tenantId}/page_content/waiver`)
      .get();
    const md = snap.exists ? String(snap.data()?.markdown ?? "").trim() : "";
    return md || DEFAULT_WAIVER_TEXT;
  } catch {
    return DEFAULT_WAIVER_TEXT;
  }
}

export default async function TeamWaiverPage() {
  const h = headers();
  const tenantId = h.get("x-tenant-id");
  // Eyebrow + intro copy must name THIS league. LeagueForm used to default the
  // eyebrow to "SFBL", so every other tenant showed another league's name.
  //
  // Parsed as the whole config rather than picking two fields off it, because
  // the Team field below needs flags.hide_teams from the same header.
  const config = (() => {
    const raw = h.get("x-tenant-config-json");
    if (!raw) return null;
    try {
      return JSON.parse(raw) as PublicLeagueConfig;
    } catch {
      return null;
    }
  })();
  const abbrev = config?.abbrev ?? config?.name ?? "";
  const hidden = teamsHidden(config);
  const [teams, waiverText] = await Promise.all([
    loadTeamOptions(tenantId, config),
    loadWaiverText(tenantId),
  ]);

  const FIELDS: FormField[] = [
    // Typed, not picked, while the field is private. The waiver is mandatory
    // before the first game, so this field is not allowed to fail shut, and a
    // dropdown stripped to "Other / Not listed" would file every waiver under
    // a team name that identifies nobody.
    teamNameField({
      name: "team_name",
      label: "Team",
      teams,
      hidden,
      required: true,
      width: "full",
      trailingOptions: [{ value: OTHER, label: OTHER }],
      placeholder: "Your team name",
      hiddenHelp:
        "Type your team name exactly as you registered it. The team list goes up when the schedule is released.",
    }),
    { name: "manager_first_name", label: "Manager First Name", type: "text", required: true, width: "half" },
    { name: "manager_last_name", label: "Manager Last Name", type: "text", required: true, width: "half" },
    { name: "email", label: "Manager Email", type: "email", required: true, width: "half" },
    { name: "phone", label: "Manager Cell", type: "tel", width: "half" },
    {
      name: "season",
      label: "Season",
      type: "select",
      options: [
        { value: "spring-2026", label: "Spring 2026" },
        { value: "fall-2026", label: "Fall 2026" },
        { value: "spring-2027", label: "Spring 2027" },
      ],
      width: "half",
    },
    {
      name: "signature",
      label: "Type your full name as e-signature",
      type: "text",
      required: true,
      placeholder: "First Last",
      help: "Typing your name has the same legal effect as a wet signature.",
      width: "half",
    },
    {
      name: "signature_date",
      label: "Today's Date",
      type: "date",
      width: "half",
    },
    {
      name: "agreed_to_waiver",
      label:
        "I have read the waiver above and agree on behalf of my team and every player on it.",
      type: "checkbox",
      required: true,
      width: "full",
    },
  ];

  return (
    <LeagueForm
      kind="team_waiver"
      title="Team Waiver Form"
      description="Each team must submit this waiver before the first regular-season game."
      eyebrow={abbrev}
      intro={[
        "Read the waiver below carefully. By signing this form, you affirm on behalf of your team that every player has signed, or will sign, the league's player liability release.",
      ]}
      fields={FIELDS}
      waiverText={waiverText}
      submitLabel="Sign + Submit Waiver"
      successMessage="Waiver received. Your team is cleared for play once we confirm registration + payment."
    />
  );
}
