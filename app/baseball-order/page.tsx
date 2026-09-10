// Rawlings baseball order form.
//
// Doug buys these in bulk and sells them on to member teams at cost. Rebuilt
// from his SportsEngine form, captured 2026-08-27 (see
// docs/coybl-sportngin-form-specs.md).
//
// His version has TWO product pages, ROLB1 and the current Rawlings ball. He
// asked how to delete the ROLB1 one because that model is not offered this
// year and he could not find the control. It is simply not rebuilt here, which
// is the whole answer.
//
// PUBLIC since 2026-09-10. Doug reviewed it and asked to "make the baseballs
// live so everyone can see the page", so the noindex came off, the robots.txt
// block came off, and it is linked from the Coaches menu. The two tournament
// pages stay hidden: he has not sent their 2027 dates or fees yet, and those
// pages still show last season's.
//
// Card IS taken here, through Square, on the confirmation screen. His form
// says: "we will need to arrange a time (email me to set that up) for a call to
// collect your info to include: Name on Card, Card number, Exp date, Zip code."
// That has him reading card numbers down the phone at 3.75%, and it is the one
// thing about these forms worth not rebuilding. Venmo and cheque stay.
//
// The total is priced from the quantity and the delivery choice, so both are
// required and the minimum is enforced on the server as well as here.

import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { LeagueForm, type FormField } from "@/components/forms/LeagueForm";
import { paymentDetailsFor } from "@/lib/league-payment";
import {
  BASEBALL_MIN_DOZENS,
  BASEBALL_PRICE_PER_DOZEN,
  BASEBALL_SHIPPING_PER_DOZEN,
} from "@/lib/fees";
import type { PublicLeagueConfig } from "@/lib/tenants";

export const dynamic = "force-dynamic";

export const metadata = { title: "Baseball Order" };

// From lib/fees.ts, which is what actually prices the card. Re-declaring them
// here would be two numbers to change and one of them would get missed.
const PRICE_PER_DOZEN = BASEBALL_PRICE_PER_DOZEN;
const SHIPPING_PER_DOZEN = BASEBALL_SHIPPING_PER_DOZEN;
const MIN_DOZENS = BASEBALL_MIN_DOZENS;

export default function BaseballOrderPage() {
  const h = headers();
  const tenantId = h.get("x-tenant-id") ?? "";
  if (tenantId !== "coybl") notFound();

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

  const FIELDS: FormField[] = [
    { name: "first_name", label: "First Name", type: "text", required: true, width: "half" },
    { name: "last_name", label: "Last Name", type: "text", required: true, width: "half" },
    { name: "email", label: "Email", type: "email", required: true, width: "half",
      help: "Your order confirmation and payment details go here." },
    { name: "phone", label: "Phone", type: "tel", required: true, width: "half" },
    { name: "team_name", label: "Team Name", type: "text", width: "half" },
    { name: "team_age", label: "Team Age", type: "text", width: "half", placeholder: "e.g. 10U" },

    {
      name: "dozens",
      label: "How many dozen would you like to order?",
      type: "number",
      required: true,
      width: "half",
      // His form sets a minimum of 2 and does not explain it. Said out loud
      // here, because a rejected order with no reason given is a lost order.
      help: `Minimum order is ${MIN_DOZENS} dozen, at $${PRICE_PER_DOZEN} per dozen.`,
    },
    {
      name: "ship_to_home",
      label: "Ship to your home address?",
      type: "radio",
      required: true,
      width: "half",
      help: `Shipping is $${SHIPPING_PER_DOZEN} per dozen. Collection is free.`,
      options: [
        { value: "Yes", label: `Yes, ship to me ($${SHIPPING_PER_DOZEN} per dozen)` },
        { value: "No", label: "No, I will collect" },
      ],
    },

    // Asked of everyone rather than only of people who chose shipping: the
    // form has no conditional logic, and an address on an order Doug is about
    // to hand over in person costs nothing, while a missing one on an order he
    // has to post costs a phone call.
    { name: "address", label: "Street Address", type: "text", width: "full",
      help: "Needed if you would like these shipped." },
    { name: "city", label: "City", type: "text", width: "half" },
    { name: "state", label: "State", type: "text", width: "half", placeholder: "OH" },
    { name: "zip", label: "ZIP", type: "text", width: "half" },

    {
      name: "payment_preference",
      label: "How do you plan to pay?",
      type: "radio",
      width: "full",
      options: [
        { value: "Venmo", label: "Venmo" },
        { value: "Check", label: "Check" },
        { value: "Credit card", label: "Credit card (processing fee applies)" },
      ],
    },
    { name: "notes", label: "Anything else?", type: "textarea", width: "full" },
  ];

  const payLines: string[] = [];
  if (pay?.venmoHandle) {
    payLines.push(`Venmo ${pay.venmoHandle}, with your team name and "baseballs" in the note.`);
  }
  if (pay?.checkPayableTo && pay?.checkAddress) {
    payLines.push(`Cheque payable to ${pay.checkPayableTo}, posted to ${pay.checkAddress}.`);
  }
  payLines.push("Or pay by card on the confirmation screen as soon as you order.");

  return (
    <LeagueForm
      kind="baseball_order"
      eyebrow={abbrev}
      title={`${season ? `${season} ` : ""}Rawlings Baseball Order`}
      description={`Rawlings RHSCCTB (R100-H3) specification baseballs, $${PRICE_PER_DOZEN} per dozen, all in.`}
      intro={[
        "Rawlings baseball, high school specification. Good for all ages, 7U through 18U.",
        "The only difference between this RHSCCTB ball and the R100-HS is the NFHS stamp, which Rawlings pays a royalty to print. The ball is otherwise the same: full-grain leather cover, raised seams, cushioned cork centre, 15 percent wool windings, 9 inch.",
        `Our price is $${PRICE_PER_DOZEN} per dozen, all in. This ball retails at $75 and up, on sale, plus tax and shipping.`,
        `Minimum order is ${MIN_DOZENS} dozen. Shipping to your home is $${SHIPPING_PER_DOZEN} per dozen, or collect from the league at no extra cost.`,
        `How to pay: ${payLines.join(" ")}`,
        "Any refunds, returns or issues are the responsibility of COYBL and should be directed to the league office.",
      ]}
      fields={FIELDS}
      submitLabel="Place Order"
      successMessage="Your order is in, and we have emailed you a copy. Pay below by card, or use Venmo or cheque. Nothing ships until payment reaches the league."
      afterSuccess="payment"
      leagueId={tenantId}
    />
  );
}
