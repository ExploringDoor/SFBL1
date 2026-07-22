// Public team-registration form. Submission lands in
// /form_submissions/team_registration so league admins can review and
// follow up about payment. Content is tenant-aware: COYBL (youth
// baseball, 7U-14U) gets its own fields + copy; other tenants fall back
// to the SFBL adult-softball default.

import { headers } from "next/headers";
import { LeagueForm, type FormField } from "@/components/forms/LeagueForm";

const SFBL_FIELDS: FormField[] = [
  { name: "manager_first_name", label: "Manager First Name", type: "text", required: true, width: "half" },
  { name: "manager_last_name", label: "Manager Last Name", type: "text", required: true, width: "half" },
  { name: "email", label: "Email Address", type: "email", required: true, width: "half" },
  { name: "phone", label: "Cell Phone", type: "tel", required: true, width: "half" },
  { name: "city", label: "City", type: "text", width: "half" },
  {
    name: "team_name",
    label: "Team Name",
    type: "text",
    required: true,
    placeholder: "Or write \"Undetermined\"",
    width: "half",
  },
  {
    name: "division",
    label: "Division",
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
  { name: "asst_first_name", label: "Assistant Manager First Name", type: "text", width: "half" },
  { name: "asst_last_name", label: "Assistant Manager Last Name", type: "text", width: "half" },
  { name: "asst_phone", label: "Assistant Manager Phone", type: "tel", width: "half" },
  { name: "notes", label: "Anything else we should know?", type: "textarea", width: "full" },
  {
    name: "agreed_to_terms",
    label:
      "I confirm that all team members will sign the league liability release before play, and I accept SFBL's terms.",
    type: "checkbox",
    required: true,
    width: "full",
  },
];

const COYBL_AGE_GROUPS = ["7U", "8U", "9U", "10U", "11U", "12U", "13U", "14U"];

const COYBL_FIELDS: FormField[] = [
  { name: "manager_first_name", label: "Coach / Manager First Name", type: "text", required: true, width: "half" },
  { name: "manager_last_name", label: "Coach / Manager Last Name", type: "text", required: true, width: "half" },
  { name: "email", label: "Email Address", type: "email", required: true, width: "half" },
  { name: "phone", label: "Cell Phone", type: "tel", required: true, width: "half" },
  {
    name: "team_name",
    label: "Team Name",
    type: "text",
    required: true,
    placeholder: "Or write \"Undetermined\"",
    width: "half",
  },
  {
    name: "age_group",
    label: "Age Group",
    type: "select",
    required: true,
    options: COYBL_AGE_GROUPS.map((a) => ({ value: a, label: a })),
    width: "half",
  },
  { name: "street_address", label: "Street Address", type: "text", width: "full" },
  { name: "city", label: "City / Town", type: "text", width: "half" },
  { name: "zip", label: "ZIP Code", type: "text", width: "half" },
  { name: "organization", label: "Club / Organization", type: "text", placeholder: "If your team is part of a club", width: "full" },
  {
    name: "insurance_option",
    label: "Registration Option",
    type: "select",
    required: true,
    options: [
      { value: "option-1", label: "Option 1 — $495 (league provides insurance)" },
      { value: "option-2", label: "Option 2 — $425 (we provide our own insurance)" },
    ],
    width: "half",
  },
  {
    name: "usssa_addon",
    label: "Add USSSA membership? (+$35)",
    type: "select",
    options: [
      { value: "no", label: "No" },
      { value: "yes", label: "Yes, add USSSA (+$35)" },
    ],
    width: "half",
  },
  {
    name: "gamechanger_link",
    label: "GameChanger Schedule Link",
    type: "text",
    placeholder: "https://web.gc.com/teams/…",
    help: "Paste your team's GameChanger schedule link — it feeds standings and power rankings.",
    width: "full",
  },
  {
    name: "team_logo",
    label: "Team Logo (optional)",
    type: "image",
    help: "Upload your team's logo (PNG or JPG) — it'll appear on your team page and score cards.",
    width: "full",
  },
  { name: "asst_first_name", label: "Assistant Coach First Name", type: "text", width: "half" },
  { name: "asst_last_name", label: "Assistant Coach Last Name", type: "text", width: "half" },
  { name: "asst_phone", label: "Assistant Coach Phone", type: "tel", width: "half" },
  { name: "notes", label: "Anything else we should know?", type: "textarea", width: "full" },
  {
    name: "agreed_to_terms",
    label:
      "I confirm that all players and coaches will sign the league liability release before play, and I accept COYBL's terms.",
    type: "checkbox",
    required: true,
    width: "full",
  },
];


// Neutral field set for tenants without their own block. SFBL_FIELDS cannot be
// reused: it hardcodes adult divisions (18+/28+/35+), Florida counties
// (Palm Beach / Broward / Miami-Dade) and SFBL-named consent copy. Division is
// free text here because age groups differ per league (Island runs 8U to 18U).
const GENERIC_FIELDS: FormField[] = [
  { name: "manager_first_name", label: "Manager First Name", type: "text", required: true, width: "half" },
  { name: "manager_last_name", label: "Manager Last Name", type: "text", required: true, width: "half" },
  { name: "email", label: "Email Address", type: "email", required: true, width: "half" },
  { name: "phone", label: "Cell Phone", type: "tel", required: true, width: "half" },
  { name: "team_name", label: "Team Name", type: "text", required: true, width: "half" },
  { name: "division", label: "Division / Age Group", type: "text", width: "half" },
  { name: "city", label: "Town", type: "text", width: "half" },
  { name: "asst_first_name", label: "Assistant Coach First Name", type: "text", width: "half" },
  { name: "asst_last_name", label: "Assistant Coach Last Name", type: "text", width: "half" },
  { name: "asst_phone", label: "Assistant Coach Phone", type: "tel", width: "half" },
  { name: "notes", label: "Anything else we should know?", type: "textarea", width: "full" },
  {
    name: "agreed_to_terms",
    type: "checkbox",
    required: true,
    label:
      "I confirm that every player on this team will sign the league's liability release before play.",
    width: "full",
  },
];

function content(tenantId: string) {
  if (tenantId === "coybl") {
    return {
      fields: COYBL_FIELDS,
      description:
        "Register your team for the Central Ohio Youth Baseball League.",
      intro: [
        "Choose your registration option below: Option 1 is $495 (includes team insurance plus Five Tool Youth registration); Option 2 is $425 (your team provides proof of its own insurance, plus Five Tool Youth registration). USSSA membership is an optional +$35 add-on.",
        "You can pay by card (Square) at checkout — card payments add a 3.25% processing fee. To skip that fee, pay by Venmo or check instead (details below).",
      ],
      successMessage: "Thanks! Your team registration is in.",
      // Secondary payment option — kept below the form so it doesn't lead
      // the page. Venmo lets teams avoid the card processing fee.
      footer: (
        <div>
          <p style={{ margin: "0 0 6px", fontWeight: 700 }}>
            Skip the 3.25% card fee
          </p>
          <p
            style={{
              margin: "0 0 12px",
              fontSize: 14,
              color: "var(--muted)",
              maxWidth: 560,
              lineHeight: 1.55,
            }}
          >
            Card payments (Square) include a 3.25% processing fee. To avoid it,
            pay by <strong>Venmo</strong> to{" "}
            <a
              href="https://venmo.com/u/Doug-Hare-2"
              target="_blank"
              rel="noopener noreferrer"
            >
              @Doug-Hare-2
            </a>{" "}
            (scan below), or by <strong>check</strong> to COYBL, 152 Glen
            Crossing Drive, Etna, OH 43062. When Venmo asks you to confirm the
            recipient, the last 4 digits of the phone number are{" "}
            <strong>1391</strong>.
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/coybl/venmo-qr.png"
            alt="Venmo QR code — pay @Doug-Hare-2"
            width={140}
            height={140}
            style={{ borderRadius: 8, border: "1px solid rgba(0,0,0,0.1)" }}
          />
        </div>
      ),
    };
  }
  // Generic fallback for any tenant without its own block. This used to fall
  // through to SFBL's config, which meant a new league published SFBL's real
  // $2,440 fee, $1,200 umpire fees and SFBL's phone number as if they were its
  // own. Neutral copy is the only safe default.
  if (tenantId !== "sfbl") {
    return {
      fields: GENERIC_FIELDS,
      description: "Register a team for the upcoming season.",
      intro: [
        "Submit this form to register your team. The league office will follow up with fees, payment options and roster details.",
      ],
      successMessage:
        "Thanks! Your team registration is in. The league office will be in touch about fees and rosters.",
      footer: null,
    };
  }

  // SFBL.
  return {
    fields: SFBL_FIELDS,
    description: "Register a new team for the South Florida Baseball League.",
    intro: [
      "The Team Registration Fee is $2,440, plus umpire fees of $1,200 — $3,640 total for a 13-player roster.",
      (
        <>
          After submitting this form, contact the league office (
          <a href="tel:+17863720034">786-372-0034</a> /{" "}
          <a href="mailto:playball@sfbl.com">playball@sfbl.com</a>) to arrange
          payment. Each team must also submit a signed Team Waiver — link is in
          the nav once you&rsquo;re done here.
        </>
      ),
    ],
    successMessage:
      "Thanks! Your team registration is in. We'll reach out within a couple of days to confirm division placement and walk through payment.",
    footer: undefined,
  };
}

export default function TeamRegistrationPage() {
  const h = headers();
  const tenantId = h.get("x-tenant-id") ?? "";
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
  const { fields, description, intro, successMessage, footer } =
    content(tenantId);
  return (
    <LeagueForm
      kind="team_registration"
      title="Team Registration"
      description={description}
      intro={intro}
      fields={fields}
      submitLabel="Register Team"
      successMessage={successMessage}
      eyebrow={abbrev}
      footer={footer}
    />
  );
}
