// Public umpire registration.
//
// Replaces Doug's SportsEngine form at
// coybl.sportngin.com/register/form/123104747, which is still live. The intro
// copy below is HIS, lifted from that form's welcome page rather than
// rewritten, because it states rules an umpire needs to read: registration
// runs every year, it is free, and a separate current OHSAA licence is also
// required to work COYBL games.
//
// The one thing that form does which a plain form does not: it hands out a
// number. "Your Registration Entry number will be your 2026 COYBL Umpire
// registration number as it is a special number assigned to you." On
// SportsEngine that number falls out of the entry sequence. Here it comes from
// a per-season counter in app/api/league-form/route.ts and is shown on the
// success screen and repeated in the confirmation email.
//
// ⚠ FIELDS ARE A BEST GUESS on the Information step, which sits behind
// "Continue as a Guest" on Doug's form. Continuing would have created a live
// entry on his account and consumed a real umpire number, so it was not
// clicked. Names, contact details and the OHSAA licence are certain because
// the welcome page states them. Level, age groups, travel radius, shirt size
// and emergency contact are inference from what the league's umpire roster
// stores and what assigning games needs. Check them against his form and
// delete or add as needed — this list is cheap to change, the number scheme is
// not.

import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { LeagueForm, type FormField } from "@/components/forms/LeagueForm";
import type { PublicLeagueConfig } from "@/lib/tenants";

export const dynamic = "force-dynamic";

export const metadata = { title: "Umpire Registration" };

// COYBL's form, on COYBL's site. Scoped from the start rather than shipped to
// everyone and gated later: on 2026-08-20 Island's admin tabs turned up on
// COYBL because the render was gated and the route was not.
const TENANTS = new Set(["coybl"]);

export default function UmpireRegistrationPage() {
  const h = headers();
  const tenantId = h.get("x-tenant-id") ?? "";
  if (!TENANTS.has(tenantId)) notFound();

  const config = (() => {
    const raw = h.get("x-tenant-config-json");
    if (!raw) return null;
    try {
      return JSON.parse(raw) as PublicLeagueConfig;
    } catch {
      return null;
    }
  })();
  const abbrev = config?.abbrev ?? config?.name ?? "COYBL";
  const season = config?.season_year ?? "";

  const FIELDS: FormField[] = [
    { name: "first_name", label: "First Name", type: "text", required: true, width: "half" },
    { name: "last_name", label: "Last Name", type: "text", required: true, width: "half" },
    { name: "email", label: "Email", type: "email", required: true, width: "half",
      help: "Your confirmation and all league updates go here." },
    { name: "phone", label: "Cell Phone", type: "tel", required: true, width: "half" },

    { name: "address", label: "Street Address", type: "text", width: "full" },
    { name: "city", label: "City", type: "text", width: "half" },
    { name: "state", label: "State", type: "text", width: "half", placeholder: "OH" },
    { name: "zip", label: "ZIP", type: "text", width: "half" },

    // Mirrors the `level` field on the league's umpire roster, so a
    // registration can be promoted onto it without retyping.
    {
      name: "level",
      label: "Experience Level",
      type: "select",
      width: "half",
      options: [
        { value: "Rookie", label: "Rookie (first year)" },
        { value: "Experienced", label: "Experienced" },
        { value: "Veteran", label: "Veteran" },
      ],
    },
    { name: "years_experience", label: "Years Umpiring", type: "number", width: "half" },

    {
      name: "ohsaa_licensed",
      label: "Do you hold a current OHSAA license?",
      type: "radio",
      width: "full",
      help: `A current OHSAA license is required to work ${abbrev} games. It is separate from this registration.`,
      options: [
        { value: "Yes", label: "Yes" },
        { value: "Applied", label: "Applied for / in progress" },
        { value: "No", label: "No" },
      ],
    },
    { name: "ohsaa_number", label: "OHSAA License Number", type: "text", width: "half",
      help: "If you have one." },

    { name: "age_groups", label: "Age Groups You'll Work", type: "text", width: "full",
      placeholder: "e.g. 8U through 14U" },
    { name: "travel_radius", label: "How far will you travel?", type: "text", width: "half",
      placeholder: "e.g. 30 miles from Etna" },
    { name: "shirt_size", label: "Shirt Size", type: "select", width: "half",
      options: ["S", "M", "L", "XL", "2XL", "3XL"].map((v) => ({ value: v, label: v })) },

    { name: "emergency_name", label: "Emergency Contact Name", type: "text", width: "half" },
    { name: "emergency_phone", label: "Emergency Contact Phone", type: "tel", width: "half" },

    { name: "notes", label: "Anything else the league should know?", type: "textarea", width: "full" },

    {
      name: "agreed_to_terms",
      label: `I confirm the information above is accurate and I will follow the rules and policies of ${abbrev}.`,
      type: "checkbox",
      required: true,
      width: "full",
    },
  ];

  return (
    <LeagueForm
      kind="umpire_registration"
      eyebrow={abbrev}
      title={`${season ? `${season} ` : ""}Umpire Registration`}
      description={`Register to umpire ${abbrev} games. There is no cost.`}
      intro={[
        `Welcome to the ${season ? `${season} ` : ""}Umpire Registration with ${config?.name ?? abbrev}. Umpires must register each year.`,
        `There is no cost to register. Registration allows us to send updates and information to you, and to contact you in case of an issue at a ${abbrev} event.`,
        `Registering with ${abbrev} and holding a current OHSAA license are both required to work ${abbrev} games.`,
        `Please read through carefully and make sure everything is accurate. When you finish you will be shown your registration number and sent a confirmation email. If you do not get that email, your registration did not go through and you will need to do it again.`,
      ]}
      fields={FIELDS}
      submitLabel="Complete Registration"
      successMessage="You are registered. Your confirmation email is on its way, and your registration number is below. Keep it."
    />
  );
}
