// Public "get league alerts" signup — a visitor leaves an email and/or
// phone to receive league updates (rainouts, schedule changes, news).
// Lands in /form_submissions/alerts_signup for admin review/export.
//
// NOTE: this collects contacts now. Actually SENDING texts requires an
// SMS provider (Twilio) wired up; email alerts use the platform's
// existing email path. Until then this is a signup list the admin can
// export.

import { headers } from "next/headers";
import { LeagueForm, type FormField } from "@/components/forms/LeagueForm";
import type { PublicLeagueConfig } from "@/lib/tenants";
import { getAdminDb } from "@/lib/firebase-admin";

export const dynamic = "force-dynamic";

// Divisions come off the tenant's own teams rather than a config field, so
// this needs no schema change and stays correct as divisions are added.
async function loadDivisions(tenantId: string): Promise<string[]> {
  if (!tenantId) return [];
  try {
    const snap = await getAdminDb().collection(`leagues/${tenantId}/teams`).get();
    const seen = new Set<string>();
    for (const d of snap.docs) {
      const div = d.data().division;
      if (div) seen.add(String(div));
    }
    return [...seen].sort();
  } catch {
    return [];
  }
}

const AGE_GROUPS = ["7U", "8U", "9U", "10U", "11U", "12U", "13U", "14U"];

const BASE_FIELDS: FormField[] = [
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
  // notify_by (Email / Text / Both) was removed: SMS isn't wired, so offering
  // "Text" collected a preference we couldn't honor. Alerts go by email; the
  // broadcast code defaults an unset notify_by to email. Re-add this when
  // Twilio is configured.
];

// The "what do you follow" selector. Youth leagues follow an AGE GROUP;
// adult leagues (HSA: Men's I/E/Rec, Women's, Coed Red/White/Blue) follow a
// DIVISION. Hardcoding 7U-14U put youth age groups on an adult slowpitch
// league's signup form, so drive it off the tenant's own divisions and only
// fall back to ages for tenants that actually have them.
function followField(divisions: string[], useAges: boolean): FormField {
  const options = useAges
    ? [{ value: "all", label: "All age groups" }, ...AGE_GROUPS.map((a) => ({ value: a, label: a }))]
    : [{ value: "all", label: "All divisions" }, ...divisions.map((d) => ({ value: d, label: d }))];
  return {
    name: useAges ? "age_group" : "division",
    label: useAges ? "Age Group You Follow" : "Division You Follow",
    type: "select",
    options,
    width: "half",
  };
}

export default async function AlertsSignupPage() {
  const h = headers();
  const tenantId = h.get("x-tenant-id") ?? "";
  let cfg: PublicLeagueConfig | null = null;
  try {
    const raw = h.get("x-tenant-config-json");
    cfg = raw ? (JSON.parse(raw) as PublicLeagueConfig) : null;
  } catch {
    cfg = null;
  }
  // Every league name in this copy used to read "COYBL" regardless of host.
  const short = cfg?.abbrev ?? cfg?.name ?? "the league";
  const useAges = tenantId === "coybl";
  const divisions = await loadDivisions(tenantId);
  const fields: FormField[] = [
    ...BASE_FIELDS,
    followField(divisions, useAges || divisions.length === 0),
    {
      name: "agreed_to_alerts",
      label: `I agree to receive ${short} email alerts at the address above.`,
      type: "checkbox",
      required: true,
      width: "full",
    },
  ];
  return (
    <LeagueForm
      kind="alerts_signup"
      title="League Alerts Signup"
      eyebrow={cfg?.abbrev ?? undefined}
      description={`Get ${short} email updates: rainouts, schedule changes, and league news.`}
      intro={[
        "Leave your email and we'll keep you posted on rainouts, schedule changes, and league news. Text alerts are coming soon; add your cell to be included when they launch.",
      ]}
      fields={fields}
      submitLabel="Sign Me Up"
      successMessage={`You're on the list! We'll reach out with ${short} alerts.`}
    />
  );
}
