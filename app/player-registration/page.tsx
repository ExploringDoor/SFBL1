// Public player-registration form. Tenant-aware: SFBL keeps the
// existing fee + waiver + Florida-county fields; other tenants get
// a stripped-down variant driven off the league config (divisions,
// fee copy, contact info, waiver text). For LBDC: no waiver, no
// county field, and the divisions list comes from their roster
// (Saturday + Boomers 60/70).
//
// Server component — hydrates the Team dropdown with the league's
// actual teams so admins don't have to fuzzy-match free-text inputs.

import type { Metadata } from "next";
import { headers } from "next/headers";
import { LeagueForm, type FormField } from "@/components/forms/LeagueForm";
import { getAdminDb } from "@/lib/firebase-admin";
import type { PublicLeagueConfig } from "@/lib/tenants";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Player Registration",
  description: "Register to play in the league.",
};

const POSITIONS = [
  { value: "C", label: "C — Catcher" },
  { value: "1B", label: "1B — First Base" },
  { value: "2B", label: "2B — Second Base" },
  { value: "3B", label: "3B — Third Base" },
  { value: "SS", label: "SS — Shortstop" },
  { value: "LF", label: "LF — Left Field" },
  { value: "CF", label: "CF — Center Field" },
  { value: "RF", label: "RF — Right Field" },
  { value: "P", label: "P — Pitcher" },
  { value: "DH", label: "DH — Designated Hitter" },
];

// Reserved sentinel values that aren't real team docs. Stored as-is
// in the submission so admin sees the player's intent without having
// to cross-reference a team_id that doesn't exist.
const FREE_AGENT = "Free Agent — looking for a team";
const NEW_TEAM = "Starting a new team";
const OTHER = "Other / Not listed";

// Per-tenant copy + form-shape config. Anything not listed here uses
// the SFBL default at the bottom. Add a new branch when onboarding a
// new tenant with different divisions / fee / waiver.
interface TenantSignupConfig {
  title: string;
  description: string;
  intro: React.ReactNode[];
  divisions: { value: string; label: string }[];
  /** Show the Florida county dropdown? Off for non-SFBL tenants. */
  showCounty: boolean;
  /** Waiver text to render below the form. When omitted the waiver
   *  block + the agreed_to_terms checkbox both disappear. */
  waiverText?: string;
  /** Label for the agreement checkbox (when waiverText is set). */
  agreeLabel?: string;
  successMessage: string;
}

function tenantConfig(
  tenantId: string,
  config: PublicLeagueConfig | null,
): TenantSignupConfig {
  // LBDC — no waiver, two divisions, commissioner contact
  if (tenantId === "lbdc-staging" || tenantId === "lbdc") {
    return {
      title: "Player Registration",
      description:
        "Sign up for Long Beach Diamond Classic. All players (rostered + pool / free agent) submit this once per season.",
      intro: [
        "Seasonal insurance is $50 for 50's division, $25 for Boomers. Game fees are billed separately ($20 / game for Boomers, $10 / game for crossover players).",
        <>
          Preferred payment methods are Zelle and Venmo. See the{" "}
          <a href="/pay-online">Pay Online</a> page for amounts and the
          commissioner contact.
        </>,
      ],
      divisions: [
        { value: "saturday", label: "Saturday Division (50+)" },
        { value: "boomers", label: "Boomers 60/70 Division" },
        { value: "crossover", label: "Crossover (50+ playing Boomers)" },
      ],
      showCounty: false,
      successMessage:
        "Thanks! You're signed up. The commissioner will follow up with payment + roster details.",
    };
  }

  // SFBL fallback — original prose + Florida-specific UX.
  return {
    title: "Player Registration",
    description:
      "All SFBL players must register online each season. Players must be at least 18 years old.",
    intro: [
      "The player registration fee is $280 per season. Pro-rated fees are available after the third game.",
      <>
        Preferred payment methods are Zelle and Venmo. Contact{" "}
        <a href="mailto:playball@sfbl.com">playball@sfbl.com</a> or{" "}
        <a href="tel:+17863720034">786-372-0034</a> with payment
        questions.
      </>,
    ],
    divisions: [
      { value: "18+", label: "18+ Division" },
      { value: "28+", label: "28+ Division" },
      { value: "35+", label: "35+ Division" },
    ],
    showCounty: true,
    waiverText: SFBL_WAIVER_TEXT,
    agreeLabel:
      "I have read and agree to the SFBL liability waiver below, including the absolute release for injuries (including fatality), and I am at least 18 years old.",
    successMessage:
      "Thanks! You're registered. Watch your email or text for payment + roster confirmation.",
  };
}

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
    // Firestore quota / network — fall back to a free-text-ish empty
    // dropdown rather than crashing the whole form.
    return [];
  }
}

export default async function PlayerRegistrationPage() {
  const h = headers();
  const tenantId = h.get("x-tenant-id") ?? "";
  const config = (() => {
    const raw = h.get("x-tenant-config-json");
    if (!raw) return null;
    try {
      return JSON.parse(raw) as PublicLeagueConfig;
    } catch {
      return null;
    }
  })();
  const cfg = tenantConfig(tenantId, config);
  const teams = await loadTeamOptions(tenantId || null);

  const teamOptions = [
    { value: FREE_AGENT, label: FREE_AGENT },
    ...teams,
    { value: NEW_TEAM, label: NEW_TEAM },
    { value: OTHER, label: OTHER },
  ];

  const FIELDS: FormField[] = [
    { name: "first_name", label: "First Name", type: "text", required: true, width: "half" },
    { name: "last_name", label: "Last Name", type: "text", required: true, width: "half" },
    { name: "phone", label: "Cell Phone", type: "tel", required: true, width: "half" },
    { name: "email", label: "Email", type: "email", required: true, width: "half" },
    { name: "city", label: "City", type: "text", width: "half" },
    { name: "dob", label: "Date of Birth", type: "date", required: true, width: "half" },
    { name: "primary_position", label: "Primary Position", type: "select", required: true, options: POSITIONS, width: "half" },
    { name: "secondary_position", label: "Secondary Position", type: "select", options: POSITIONS, width: "half" },
    {
      name: "division",
      label: "Division Request",
      type: "select",
      required: true,
      options: cfg.divisions,
      width: "half",
    },
    ...(cfg.showCounty
      ? ([
          {
            name: "county",
            label: "County",
            type: "select" as const,
            options: [
              { value: "palm-beach", label: "Palm Beach" },
              { value: "broward", label: "Broward" },
              { value: "miami-dade", label: "Miami-Dade" },
            ],
            width: "half" as const,
          },
        ] satisfies FormField[])
      : []),
    {
      name: "team_name",
      label: "Team",
      type: "select",
      required: true,
      options: teamOptions,
      width: "full",
      help: "Pick your team, \"Free Agent\" if you don't have one yet, or \"Starting a new team.\"",
    },
    { name: "notes", label: "Anything else we should know?", type: "textarea", width: "full" },
    // Agreement checkbox only renders when this tenant has a waiver.
    // LBDC has none → no checkbox, no waiver block.
    ...(cfg.waiverText && cfg.agreeLabel
      ? ([
          {
            name: "agreed_to_terms",
            label: cfg.agreeLabel,
            type: "checkbox" as const,
            required: true,
            width: "full" as const,
          },
        ] satisfies FormField[])
      : []),
  ];

  return (
    <LeagueForm
      kind="player_registration"
      title={cfg.title}
      description={cfg.description}
      intro={cfg.intro}
      fields={FIELDS}
      waiverText={cfg.waiverText}
      submitLabel="Register"
      successMessage={cfg.successMessage}
    />
  );
}

const SFBL_WAIVER_TEXT = `In consideration of being permitted to participate in any way in the activities of the South Florida Baseball League, I, the undersigned, acknowledge, appreciate, and agree that:

The risks of injury (including, but not limited to, fatality) from the activities involved in this program are significant, including but not limited to permanent disability and other ailments that may not be readily foreseeable, and while particular skills, equipment, and personal discipline may reduce this risk, the risk of serious injury does exist.

I knowingly and freely assume all such risks, both known and unknown, even if arising from the negligence of the releasees or others, and assume full responsibility for my participation.

I willingly agree to comply with the stated and customary terms and conditions for participation. If, however, I observe any unusual significant hazard during my presence or participation, I will remove myself from participation and bring such to the attention of the nearest official immediately.

I, for myself and on behalf of my heirs, assigns, personal representatives, and next of kin, HEREBY RELEASE AND HOLD HARMLESS the South Florida Baseball League, its officers, officials, agents, and/or employees, other participants, sponsoring agencies, sponsors, advertisers, owners, and lessors of premises used to conduct the event ("Releasees"), WITH RESPECT TO ANY AND ALL INJURY, DISABILITY, DEATH, or loss or damage to person or property, WHETHER ARISING FROM THE NEGLIGENCE OF THE RELEASEES OR OTHERWISE.`;
