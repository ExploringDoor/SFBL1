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

// Divisions and age groups come off the tenant's own teams rather than a
// config field, so this needs no schema change and stays correct as either is
// added.
//
// Ages sort numerically. A plain string sort put "10U" before "8U", which on
// Island reads as a typo on the one control a coach has to use.
async function loadFollowOptions(
  tenantId: string,
): Promise<{ divisions: string[]; ages: string[] }> {
  if (!tenantId) return { divisions: [], ages: [] };
  try {
    const snap = await getAdminDb().collection(`leagues/${tenantId}/teams`).get();
    const divisions = new Set<string>();
    const ages = new Set<string>();
    for (const d of snap.docs) {
      const data = d.data();
      if (data.division) divisions.add(String(data.division));
      if (data.ageGroup) ages.add(String(data.ageGroup));
    }
    return {
      divisions: [...divisions].sort(),
      ages: [...ages].sort(
        (a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0),
      ),
    };
  } catch {
    return { divisions: [], ages: [] };
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
function followField(
  divisions: string[],
  useAges: boolean,
  ages: string[] = AGE_GROUPS,
): FormField {
  const options = useAges
    ? [{ value: "all", label: "All age groups" }, ...ages.map((a) => ({ value: a, label: a }))]
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
  const { divisions, ages } = await loadFollowOptions(tenantId);
  // Which axis a follower thinks in. COYBL stays on the hardcoded 7U-14U list
  // it has always used. Everyone else prefers their OWN age groups when their
  // teams carry them — Island's division is the league type (Weekend,
  // Weeknight) while the thing a parent follows is the age (10U, 12U, 14U),
  // and the hardcoded list is baseball's, which does not even contain 16U or
  // 18U. Falls back to divisions, then to the hardcoded ages.
  const useAges = tenantId === "coybl" || ages.length > 0 || divisions.length === 0;
  const ageOptions = tenantId === "coybl" || ages.length === 0 ? AGE_GROUPS : ages;
  const fields: FormField[] = [
    ...BASE_FIELDS,
    followField(divisions, useAges, ageOptions),
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
