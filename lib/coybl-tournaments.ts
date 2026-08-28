// COYBL's own tournaments — the small ones Doug runs himself, which are not
// listed on Five Tools.
//
// Data, not pages, because "a couple of small tournaments" is a list that
// changes every year: adding next season's event is an edit here, not a new
// route. /tournament-registration/[slug] renders whichever one the slug names.
//
// Everything below is taken from Doug's own SportsEngine forms, captured
// 2026-08-27 (see docs/coybl-sportngin-form-specs.md). Payment methods differ
// PER TOURNAMENT and are listed per tournament rather than shared: Licking
// County takes Venmo and cheque only, Super Heros also takes Zelle and card.
// Flattening them into one list would advertise a way to pay that Doug does
// not offer for that event.
//
// ⚠ DATES AND FEES ARE HIS 2026 VALUES, awaiting his 2027 numbers. He asked
// for everything to read 2027, so `needs_2027_confirmation` marks the ones he
// still has to confirm, and the page says so plainly rather than quietly
// showing last year's price as though it were this year's.

export interface CoyblTournament {
  slug: string;
  name: string;
  /** Shown as the page title. */
  title: string;
  /** Free text, because his dates are irregular ("June 5,6,7 and 12,13,14"). */
  dates: string;
  location?: string;
  /** One line per paragraph, his wording. */
  intro: string[];
  /** Age group to entry fee, exactly as he words it. */
  fees: { label: string; amount: string }[];
  /** Which of his payment methods apply to THIS event. */
  payment: {
    venmo?: boolean;
    zelle?: string;
    check?: boolean;
    /** Card is arranged by hand with the office. His stated fee, per event. */
    cardFeeLabel?: string;
  };
  /** Rec-only events ask the coach to certify they are not a travel team. */
  requireNotTravelTeam?: boolean;
  /** Ask which way they intend to pay. Only Super Heros does. */
  askPaymentPreference?: boolean;
  /** True until Doug confirms the 2027 dates and prices. */
  needs2027Confirmation?: boolean;
}

export const COYBL_TOURNAMENTS: CoyblTournament[] = [
  {
    slug: "licking-county-invitational",
    name: "Licking County Invitational",
    title: "Licking County Invitational",
    dates: "June 5, 6, 7 and June 12, 13, 14",
    location:
      "Mound City Little League Park, 200 S. 2nd Street, Newark, Ohio 43055",
    intro: [
      "This tournament is for recreation teams only.",
      "Three game guarantee, not single elimination.",
      "Fees cover umpires and awards. Gate fee is $1 per person, 12 and under free, with proceeds going to cancer research.",
      "Thank you for considering our tournament.",
    ],
    fees: [
      { label: "8U", amount: "$300" },
      { label: "10U and 12U", amount: "$350" },
    ],
    payment: { venmo: true, check: true },
    requireNotTravelTeam: true,
    needs2027Confirmation: true,
  },
  {
    slug: "super-heros-all-stars",
    name: "Super Heros All Stars",
    title: "Super Heros Rec All Star Tournament",
    dates: "July 11 and 12",
    intro: [
      "This registration is for the Super Heros Rec All Star tournament.",
      "No travel teams permitted.",
      "Proceeds benefit Nationwide Children's Hospital, pediatric cancer research.",
      "Baseballs, umpires and awards are paid for with your registration fee.",
    ],
    fees: [
      { label: "8U", amount: "$325" },
      { label: "10U and 12U", amount: "$375" },
    ],
    // 3.75 percent, HIS number for the by-arrangement card route, not the
    // 3.25 in lib/coybl-payment.ts. That constant describes the Square
    // surcharge on team registration, which is a different way to pay.
    payment: { venmo: true, zelle: "dhare1958@gmail.com", check: true, cardFeeLabel: "3.75 percent" },
    requireNotTravelTeam: true,
    askPaymentPreference: true,
    needs2027Confirmation: true,
  },
];

export function tournamentBySlug(slug: string): CoyblTournament | null {
  return COYBL_TOURNAMENTS.find((t) => t.slug === slug) ?? null;
}

/** Every age group this tournament prices, one entry each, with its fee in
 *  whole dollars.
 *
 *  His fee LABELS group ages ("10U and 12U"), which reads well on the page but
 *  cannot be charged. This flattens them, and it is the ONLY place that
 *  splitting happens: the entry form builds its age dropdown from this, and
 *  lib/fees.ts prices the card from it, so a coach cannot pick an age the
 *  pricing does not know. An earlier draft parsed the labels separately in
 *  both places, which is exactly how a form comes to offer an option that
 *  prices at zero. */
export function tournamentAgeFees(
  t: CoyblTournament,
): { age: string; fee: number }[] {
  const out: { age: string; fee: number }[] = [];
  for (const band of t.fees) {
    const fee = Number(band.amount.replace(/[^0-9.]/g, "")) || 0;
    for (const age of band.label.split(/\s*(?:and|,|\/)\s*/i)) {
      const a = age.trim().toUpperCase();
      if (a) out.push({ age: a, fee });
    }
  }
  return out;
}

/** The entry fee for one age group, or 0 if this tournament does not price it. */
export function tournamentFeeFor(t: CoyblTournament, age: string): number {
  const a = String(age ?? "").trim().toUpperCase();
  return tournamentAgeFees(t).find((x) => x.age === a)?.fee ?? 0;
}
