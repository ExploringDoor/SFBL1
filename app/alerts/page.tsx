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
    label: "Cell Phone (for text alerts)",
    type: "tel",
    help: "Optional — add your cell if you'd like text alerts.",
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
  {
    name: "notify_by",
    label: "How should we reach you?",
    type: "select",
    options: [
      { value: "email", label: "Email" },
      { value: "text", label: "Text" },
      { value: "both", label: "Email and Text" },
    ],
    width: "half",
  },
  {
    name: "agreed_to_alerts",
    label:
      "I agree to receive COYBL alerts at the contact info above. Message/data rates may apply for texts; reply STOP to opt out.",
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
      description="Get COYBL updates — rainouts, schedule changes, and league news — by email or text."
      intro={[
        "Leave your email (and cell phone if you'd like texts) and we'll keep you posted on rainouts, schedule changes, and league news.",
      ]}
      fields={FIELDS}
      submitLabel="Sign Me Up"
      successMessage="You're on the list! We'll reach out with COYBL alerts."
    />
  );
}
