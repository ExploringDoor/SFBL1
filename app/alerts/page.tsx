// Public "get league alerts" signup — parents leave an email and/or
// phone to receive COYBL updates (rainouts, schedule changes, news).
// Lands in /form_submissions/alerts_signup for admin review/export.
//
// NOTE: this collects contacts now. Actually SENDING texts requires an
// SMS provider (Twilio) wired up; email alerts use the platform's
// existing email path. Until then this is a signup list the admin can
// export.

import { headers } from "next/headers";
import { LeagueForm, type FormField } from "@/components/forms/LeagueForm";

const AGE_GROUPS = ["7U", "8U", "9U", "10U", "11U", "12U", "13U", "14U"];

const FIELDS: FormField[] = [
  { name: "name", label: "Your Name", type: "text", width: "half" },
  { name: "email", label: "Email Address", type: "email", required: true, width: "half" },
  {
    name: "phone",
    label: "Cell Phone",
    type: "tel",
    // Text alerts aren't sending yet (no SMS provider wired). Collect the
    // cell now so signups are included the moment texts launch, but don't
    // promise a text we can't send.
    help: "Optional. Text alerts are coming soon; add your cell to be included when they launch.",
    width: "half",
  },
  {
    name: "age_group",
    label: "Age Group You Follow",
    type: "select",
    options: [
      { value: "all", label: "All age groups" },
      ...AGE_GROUPS.map((a) => ({ value: a, label: a })),
    ],
    width: "half",
  },
  // notify_by (Email / Text / Both) was removed: SMS isn't wired, so offering
  // "Text" collected a preference we couldn't honor. Alerts go by email; the
  // broadcast code defaults an unset notify_by to email. Re-add this when
  // Twilio is configured.
  {
    name: "agreed_to_alerts",
    label:
      "I agree to receive COYBL email alerts at the address above.",
    type: "checkbox",
    required: true,
    width: "full",
  },
];

export default function AlertsSignupPage() {
  const tenantId = headers().get("x-tenant-id") ?? "";
  const eyebrow = tenantId === "coybl" ? "COYBL" : undefined;
  return (
    <LeagueForm
      kind="alerts_signup"
      title="League Alerts Signup"
      eyebrow={eyebrow}
      description="Get COYBL email updates: rainouts, schedule changes, and league news."
      intro={[
        "Leave your email and we'll keep you posted on rainouts, schedule changes, and league news. Text alerts are coming soon; add your cell to be included when they launch.",
      ]}
      fields={FIELDS}
      submitLabel="Sign Me Up"
      successMessage="You're on the list! We'll reach out with COYBL alerts."
    />
  );
}
