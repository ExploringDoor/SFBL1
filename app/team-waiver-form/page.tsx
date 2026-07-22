// Public team-waiver form. Replaces the static PDF on
// sfbl.com/team-waiver-form/ with a real fillable form. The signed
// submission stores the team name + manager + a typed-name e-signature
// so league admins can prove every team agreed before play.
//
// Server component (async) so the Team field hydrates from the real
// roster — managers can pick their team instead of free-typing it
// (which used to leave admins guessing about spelling).

import { headers } from "next/headers";
import { LeagueForm, type FormField } from "@/components/forms/LeagueForm";
import { getAdminDb } from "@/lib/firebase-admin";

export const dynamic = "force-dynamic";

const OTHER = "Other / Not listed";

async function loadTeamOptions(tenantId: string | null) {
  if (!tenantId) return [] as { value: string; label: string }[];
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
  let abbrev = "";
  try {
    const cfg = JSON.parse(h.get("x-tenant-config-json") ?? "{}") as {
      abbrev?: string;
      name?: string;
    };
    abbrev = cfg.abbrev ?? cfg.name ?? "";
  } catch {
    abbrev = "";
  }
  const [teams, waiverText] = await Promise.all([
    loadTeamOptions(tenantId),
    loadWaiverText(tenantId),
  ]);
  const teamOptions = [...teams, { value: OTHER, label: OTHER }];

  const FIELDS: FormField[] = [
    {
      name: "team_name",
      label: "Team",
      type: "select",
      required: true,
      options: teamOptions,
      width: "full",
    },
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
