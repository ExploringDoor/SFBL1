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

// GameChanger instructions, from Doug. Shown at the top of the COYBL
// registration form; the required gamechanger_link field collects the link.
// Season year is 2027 (Doug's draft said 2026; Adam confirmed 2027 so it
// matches the fee copy below).
function GameChangerInfo() {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderLeft: "4px solid var(--brand-accent, #c8102e)",
        borderRadius: 10,
        padding: "16px 18px",
        background: "rgba(200,16,46,0.04)",
        lineHeight: 1.55,
        fontSize: 14,
      }}
    >
      <p style={{ margin: "0 0 8px", fontWeight: 800, letterSpacing: "0.02em" }}>
        GAMECHANGER: IMPORTANT INFO
      </p>
      <p style={{ margin: "0 0 8px" }}>
        Coaches, before you register for the 2027 season, make sure you have
        GameChanger set up for your 2027 team.
      </p>
      <p style={{ margin: "0 0 8px", fontWeight: 700 }}>
        Please use the same name to register with COYBL as your GameChanger
        team name.
      </p>
      <p style={{ margin: "0 0 8px" }}>
        We use GameChanger data to rank teams to help with divisional placement,
        and so you can gauge which teams you could play for non divisional games
        with similar strength. It powers the Power Rankings for each COYBL age
        division, plus end of season tournament seeding and awards. The
        GameChanger schedule link below is a required entry to complete
        registration. If you have not set up your 2027 GameChanger team yet,
        please do so first.
      </p>
      <p style={{ margin: "0 0 6px", fontWeight: 700 }}>
        How to get your GameChanger schedule link:
      </p>
      <ol style={{ margin: "0 0 4px", paddingLeft: 20 }}>
        <li>
          Go to{" "}
          <a
            href="https://gc.com/"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--brand-primary)", fontWeight: 700 }}
          >
            GameChanger.com
          </a>{" "}
          on a computer (not the phone app).
        </li>
        <li>Select your 2027 COYBL team.</li>
        <li>At the top, click &lsquo;Tools&rsquo;.</li>
        <li>
          At the bottom right of the &lsquo;Tools&rsquo; page, click the blue
          &lsquo;Copy Link&rsquo; to copy your team&rsquo;s GameChanger schedule
          link.
        </li>
        <li>
          Paste that link in the &lsquo;GameChanger Schedule Link&rsquo; field
          below.
        </li>
      </ol>
    </div>
  );
}

// "9U (Modified Rules)" is a real registration choice: 9U runs a regular and a
// modified-rules track, and Doug wants coaches to pick it at sign-up (it used
// to be decided by a post-registration poll). It is a submitted value the
// director reads, not a standings/division key, so the readable label is fine.
const COYBL_AGE_GROUPS = [
  "7U",
  "8U",
  "9U",
  "9U (Modified Rules)",
  "10U",
  "11U",
  "12U",
  "13U",
  "14U",
];

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
  { name: "street_address", label: "Street Address", type: "text", required: true, width: "full" },
  { name: "city", label: "City / Town", type: "text", required: true, width: "half" },
  { name: "zip", label: "ZIP Code", type: "text", required: true, width: "half" },
  { name: "organization", label: "Club / Organization", type: "text", required: true, placeholder: "If your team is part of a club", width: "full" },
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
    label: "Add USSSA membership? (+$50)",
    type: "select",
    required: true,
    options: [
      { value: "no", label: "No" },
      { value: "yes", label: "Yes, add USSSA (+$50)" },
    ],
    width: "half",
  },
  {
    name: "gamechanger_link",
    label: "GameChanger Schedule Link",
    type: "text",
    required: true,
    placeholder: "https://web.gc.com/teams/…",
    help: "Required. Follow the GameChanger steps above to copy your team's schedule link, then paste it here.",
    width: "full",
  },
  { name: "asst_first_name", label: "Assistant Coach First Name", type: "text", required: true, width: "half" },
  { name: "asst_last_name", label: "Assistant Coach Last Name", type: "text", required: true, width: "half" },
  { name: "asst_phone", label: "Assistant Coach Phone", type: "tel", required: true, width: "half" },
  // team_logo (optional) and notes (optional) intentionally left NOT required:
  // requiring a file upload would block a team that has no logo file ready,
  // and "anything else?" is a genuine catch-all. Flagged to Adam/Doug.
  { name: "team_logo", label: "Team Logo (optional)", type: "image", help: "Optional. PNG or JPG — appears on your team page and score cards.", width: "full" },
  { name: "notes", label: "Anything else we should know? (optional)", type: "textarea", width: "full" },
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
// Island Fastpitch (youth girls fastpitch, 8U-16/18U). Previously fell through
// to GENERIC_FIELDS, which said only "the upcoming season" and collected no
// GameChanger link or logo.
//
// Age and league are two separate axes at Island: every age group runs both a
// weeknight and a weekend league (Mike, 2026-07-29). `age_group` carries the
// age and `division` carries which league — both are already whitelisted in
// app/api/league-form/route.ts, so no backend change was needed.
const ISLAND_FIELDS: FormField[] = [
  { name: "manager_first_name", label: "Coach / Manager First Name", type: "text", required: true, width: "half" },
  { name: "manager_last_name", label: "Coach / Manager Last Name", type: "text", required: true, width: "half" },
  { name: "email", label: "Email Address", type: "email", required: true, width: "half" },
  { name: "phone", label: "Cell Phone", type: "tel", required: true, width: "half" },
  { name: "team_name", label: "Team Name", type: "text", required: true, width: "half" },
  {
    name: "age_group",
    label: "Age Group",
    type: "select",
    required: true,
    width: "half",
    options: [
      { value: "8U", label: "8U" },
      { value: "10U", label: "10U" },
      { value: "12U", label: "12U" },
      { value: "14U", label: "14U" },
      { value: "16/18U", label: "16/18U" },
    ],
  },
  {
    name: "division",
    label: "Which league?",
    type: "select",
    required: true,
    width: "half",
    options: [
      { value: "weekend", label: "Weekend (Saturdays and Sundays)" },
      { value: "weeknight", label: "Weeknight" },
      { value: "sunday-night", label: "Sunday Night" },
    ],
  },
  { name: "city", label: "Town", type: "text", width: "half" },
  {
    name: "gamechanger_link",
    label: "GameChanger Team Link",
    type: "text",
    width: "full",
    placeholder: "https://web.gc.com/teams/...",
    help:
      "Paste your team's GameChanger link. The league uses it to pull your schedule and scores. Open your team in GameChanger, tap Share, and copy the link. Leave blank if your team is not set up yet and send it to the league office later.",
  },
  {
    name: "team_logo",
    label: "Team Logo (optional)",
    type: "image",
    width: "full",
    help:
      "Upload a PNG or JPG and it appears next to your team on the scores, schedule and standings pages. A square image with a transparent background looks best. You can also add or change this later from your coach login.",
  },
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
        "Choose your registration option below: Option 1 is $495 (includes team insurance plus Five Tool Youth registration); Option 2 is $425 (your team provides proof of its own insurance, plus Five Tool Youth registration). USSSA membership is an optional +$50 add-on.",
        // NOTE: this used to promise "pay by card (Square) at checkout". There
        // is no Square checkout in the codebase (no /api/square-checkout, no
        // Square client anywhere), so every coach was being told about a
        // payment step that does not exist. Copy now matches what the league
        // actually does. Restore a card line only when a checkout ships.
        "Payment is handled separately from this form: pay by Venmo or by check (details below). To pay by card, contact the league office and we will arrange it.",
        // GameChanger info (Doug's copy). Rich node so the numbered steps
        // render as a real list; the required gamechanger_link field is below.
        <GameChangerInfo key="gc" />,
      ],
      successMessage: "Thanks! Your team registration is in.",
      // Secondary payment option — kept below the form so it doesn't lead
      // the page. Venmo lets teams avoid the card processing fee.
      footer: (
        <div>
          <p style={{ margin: "0 0 6px", fontWeight: 700 }}>
            How to pay
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
            Pay by <strong>Venmo</strong> to{" "}
            <a
              href="https://venmo.com/u/Doug-Hare-2"
              target="_blank"
              rel="noopener noreferrer"
            >
              @Doug-Hare-2
            </a>{" "}
            (scan below), or by <strong>check</strong> to COYBL, 152 Glen
            Crossing Drive, Pataskala, OH 43062. When Venmo asks you to confirm
            the recipient, the last 4 digits of the phone number are{" "}
            <strong>1391</strong>. To pay by card, contact the league office to
            arrange it.
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
  if (tenantId === "island") {
    return {
      fields: ISLAND_FIELDS,
      description:
        "Register your team for the Island Fastpitch Fall 2026 season.",
      intro: [
        "Fall 2026 registration is open for 8U, 10U, 12U, 14U and 16/18U. Weekend leagues open September 12 and 13; weeknight leagues open September 14.",
        // Fees confirmed by Mike 2026-07-29: $795 flat, 8U $500, umpires paid
        // at the field. Kept in the intro so nobody registers without seeing
        // the number, since payment is handled off-site.
        "League fees are $795 per team ($500 for 8U Weekend), plus umpire fees paid at the field. Teams using their own home field for at least half their games may qualify for a $200 discount. Fees must be paid in full before the season begins.",
        "Submit this form and the league office will follow up about payment and rosters. Rosters must be on USSSA.",
      ],
      successMessage:
        "Thanks! Your team is registered for Fall 2026. The league office will be in touch about fees and rosters.",
      footer: null,
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
