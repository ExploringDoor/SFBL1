// Entry form for one of COYBL's own tournaments.
//
// One route for all of them, driven by lib/coybl-tournaments.ts, because Doug
// runs "a couple of small tournaments" and the list changes yearly. Adding next
// season's event is a data edit, not a new page.
//
// HIDDEN ON PURPOSE. Doug, 2026-08-27: "Can you keep them all hidden for the
// time being and let me review them for changes once they are done?" So there
// is no nav entry, and the page asks search engines not to index it. It is
// reachable by anyone with the link, which is what makes it reviewable, and
// nothing here takes money, so a stranger finding it costs nothing.
//
// Payment is NOT charged here. Doug takes Venmo, cheque, and card by
// arrangement, so the form collects the entry and the confirmation email
// carries the payment instructions. That mirrors what his SportsEngine form
// does today, which is what Adam asked for on this first pass.

import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { LeagueForm, type FormField } from "@/components/forms/LeagueForm";
import { paymentDetailsFor } from "@/lib/league-payment";
import { COYBL_TOURNAMENTS, tournamentBySlug } from "@/lib/coybl-tournaments";
import type { PublicLeagueConfig } from "@/lib/tenants";

export const dynamic = "force-dynamic";

// Not indexed while Doug is still reviewing. Cheap to remove later.
export const metadata = {
  title: "Tournament Registration",
  robots: { index: false, follow: false },
};

export function generateStaticParams() {
  return COYBL_TOURNAMENTS.map((t) => ({ slug: t.slug }));
}

export default function TournamentRegistrationPage({
  params,
}: {
  params: { slug: string };
}) {
  const h = headers();
  const tenantId = h.get("x-tenant-id") ?? "";
  // These are COYBL's events. Scoped at the route, not just the render, so no
  // other league gets a page for a tournament it does not run.
  if (tenantId !== "coybl") notFound();

  const t = tournamentBySlug(params.slug);
  if (!t) notFound();

  const config = (() => {
    const raw = h.get("x-tenant-config-json");
    if (!raw) return null;
    try {
      return JSON.parse(raw) as PublicLeagueConfig;
    } catch {
      return null;
    }
  })();
  const abbrev = config?.abbrev ?? "COYBL";
  const season = config?.season_year ?? "";
  const pay = paymentDetailsFor(tenantId);

  const payLines: string[] = [];
  if (t.payment.venmo && pay?.venmoHandle) {
    payLines.push(`Venmo ${pay.venmoHandle}. Put your team name and the tournament name in the note.`);
  }
  if (t.payment.zelle) payLines.push(`Zelle to ${t.payment.zelle}.`);
  if (t.payment.check && pay?.checkPayableTo && pay?.checkAddress) {
    payLines.push(`Cheque payable to ${pay.checkPayableTo}, posted to ${pay.checkAddress}.`);
  }
  if (t.payment.cardFeeLabel) {
    payLines.push(`Credit card by arrangement. Email the league office and we will set it up. A ${t.payment.cardFeeLabel} processing fee is added.`);
  }

  const feeLine = t.fees.map((f) => `${f.label} is ${f.amount}`).join(", ");

  const FIELDS: FormField[] = [
    { name: "team_name", label: "Team Name", type: "text", required: true, width: "half" },
    { name: "team_age", label: "Team Age", type: "text", required: true, width: "half",
      placeholder: "e.g. 10U" },
    { name: "first_name", label: "First Name", type: "text", required: true, width: "half" },
    { name: "last_name", label: "Last Name", type: "text", required: true, width: "half" },
    { name: "email", label: "Email", type: "email", required: true, width: "half",
      help: "Your confirmation and payment details go here." },
    { name: "phone", label: "Cell Phone", type: "tel", required: true, width: "half" },

    // Only Super Heros asks this. Doug's own label reads "PAYMENT METHOD
    // PREFEERD"; the typo is not carried over.
    ...(t.payment.cardFeeLabel || t.askPaymentPreference
      ? [
          {
            name: "payment_preference",
            label: "How do you plan to pay?",
            type: "radio" as const,
            width: "full" as const,
            help: "Just so the league knows what to expect. You can still change your mind.",
            options: [
              ...(t.payment.venmo ? [{ value: "Venmo", label: "Venmo" }] : []),
              ...(t.payment.zelle ? [{ value: "Zelle", label: "Zelle" }] : []),
              ...(t.payment.check ? [{ value: "Check", label: "Check" }] : []),
              ...(t.payment.cardFeeLabel
                ? [{ value: "Credit card", label: "Credit card" }]
                : []),
            ],
          },
        ]
      : []),

    ...(t.requireNotTravelTeam
      ? [
          {
            name: "not_travel_team",
            label: "I certify that we are NOT a travel team.",
            type: "checkbox" as const,
            required: true,
            width: "full" as const,
            help: "This tournament is for recreation teams only.",
          },
        ]
      : []),

    { name: "notes", label: "Anything else the league should know?", type: "textarea", width: "full" },
  ];

  return (
    <LeagueForm
      kind="tournament_registration"
      eyebrow={abbrev}
      title={`${season ? `${season} ` : ""}${t.title}`}
      description={t.dates}
      intro={[
        ...t.intro,
        `Entry fees: ${feeLine}.`,
        ...(t.location ? [`Games are played at ${t.location}.`] : []),
        // Said out loud rather than left for a coach to discover. These are
        // last year's dates and prices until Doug confirms this year's, and a
        // stale price presented as current is the one thing that would cost
        // him money.
        ...(t.needs2027Confirmation
          ? [
              `Please note: the dates and fees above are carried over from last season and are being confirmed. The league office will confirm both when it accepts your entry.`,
            ]
          : []),
        `Payment is not taken on this page. ${payLines.join(" ")}`,
      ]}
      fields={FIELDS}
      submitLabel="Submit Entry"
      successMessage={`Your entry is in. We have emailed you a copy along with how to pay. Nothing is confirmed until payment reaches the league.`}
      // The tournament this entry is for. Sent as a hidden value rather than
      // asked, so a coach cannot enter the wrong event from the right page.
      hiddenValues={{ tournament: t.name }}
    />
  );
}
