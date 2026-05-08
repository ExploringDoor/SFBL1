// Public player-registration form. Mirrors sfbl.com/player-registration/.
// All players (rostered + free agents) submit this once per season.
// Stored in /form_submissions/player_registration; admins can later
// link a submission to a player record + grant access.

import { LeagueForm, type FormField } from "@/components/forms/LeagueForm";

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
    options: [
      { value: "18+", label: "18+ Division" },
      { value: "28+", label: "28+ Division" },
      { value: "35+", label: "35+ Division" },
    ],
    width: "half",
  },
  {
    name: "county",
    label: "County",
    type: "select",
    options: [
      { value: "palm-beach", label: "Palm Beach" },
      { value: "broward", label: "Broward" },
      { value: "miami-dade", label: "Miami-Dade" },
    ],
    width: "half",
  },
  {
    name: "team_name",
    label: "Team Name (or write \"Free Agent\")",
    type: "text",
    width: "full",
    help: "If you don't have a team yet, write \"Free Agent\" and we'll match you.",
  },
  { name: "notes", label: "Anything else we should know?", type: "textarea", width: "full" },
  {
    name: "agreed_to_terms",
    label:
      "I have read and agree to the SFBL liability waiver below, including the absolute release for injuries (including fatality), and I am at least 18 years old.",
    type: "checkbox",
    required: true,
    width: "full",
  },
];

const WAIVER_TEXT = `In consideration of being permitted to participate in any way in the activities of the South Florida Baseball League, I, the undersigned, acknowledge, appreciate, and agree that:

The risks of injury (including, but not limited to, fatality) from the activities involved in this program are significant, including but not limited to permanent disability and other ailments that may not be readily foreseeable, and while particular skills, equipment, and personal discipline may reduce this risk, the risk of serious injury does exist.

I knowingly and freely assume all such risks, both known and unknown, even if arising from the negligence of the releasees or others, and assume full responsibility for my participation.

I willingly agree to comply with the stated and customary terms and conditions for participation. If, however, I observe any unusual significant hazard during my presence or participation, I will remove myself from participation and bring such to the attention of the nearest official immediately.

I, for myself and on behalf of my heirs, assigns, personal representatives, and next of kin, HEREBY RELEASE AND HOLD HARMLESS the South Florida Baseball League, its officers, officials, agents, and/or employees, other participants, sponsoring agencies, sponsors, advertisers, owners, and lessors of premises used to conduct the event ("Releasees"), WITH RESPECT TO ANY AND ALL INJURY, DISABILITY, DEATH, or loss or damage to person or property, WHETHER ARISING FROM THE NEGLIGENCE OF THE RELEASEES OR OTHERWISE.`;

export default function PlayerRegistrationPage() {
  return (
    <LeagueForm
      kind="player_registration"
      title="Player Registration"
      description="All SFBL players must register online each season. Players must be at least 18 years old."
      intro={[
        "The player registration fee is $280 per season. Pro-rated fees are available after the third game.",
        "Preferred payment methods are Zelle and Venmo. Contact playball@sfbl.com or 786-372-0034 with payment questions.",
      ]}
      fields={FIELDS}
      waiverText={WAIVER_TEXT}
      submitLabel="Register"
      successMessage="Thanks! You're registered. Watch your email for payment + roster confirmation."
    />
  );
}
