// Public team-registration form. Mirrors sfbl.com/team-registration/.
// New teams enter their manager + assistant info, division, county;
// submission lands in /form_submissions/team_registration so league
// admins can review and follow up about payment.

import type { Metadata } from "next";
import { LeagueForm, type FormField } from "@/components/forms/LeagueForm";

export const metadata: Metadata = {
  title: "Team Registration",
  description: "Register a new team for the upcoming season.",
};

const FIELDS: FormField[] = [
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

export default function TeamRegistrationPage() {
  return (
    <LeagueForm
      kind="team_registration"
      title="Team Registration"
      description="Register a new team for the South Florida Baseball League."
      intro={[
        "The Team Registration Fee is $2,440, plus umpire fees of $1,200 — $3,640 total for a 13-player roster.",
        <>
          After submitting this form, contact the league office (
          <a href="tel:+17863720034">786-372-0034</a> /{" "}
          <a href="mailto:playball@sfbl.com">playball@sfbl.com</a>) to
          arrange payment. Each team must also submit a signed Team
          Waiver — link is in the nav once you&rsquo;re done here.
        </>,
      ]}
      fields={FIELDS}
      submitLabel="Register Team"
      successMessage="Thanks! Your team registration is in. We'll reach out within a couple of days to confirm division placement and walk through payment."
    />
  );
}
