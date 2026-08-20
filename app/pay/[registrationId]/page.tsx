// /pay/{registrationId} — the one page a coach or a parent can be SENT to in
// order to settle a fee that already exists.
//
// WHY THIS EXISTS. The office used to tap "Card link" in the Payments tab,
// which minted a Square HOSTED payment link. Nothing in this codebase ever read
// the result of one: there is no Square webhook, /api/square-checkout recorded
// only card.initiated_at, and no surface reads that field. So the old button
// either sent a coach somewhere that took money the office never saw, or
// somewhere that took none, and from inside the app those two look identical.
// Worse, it keyed Square on crypto.randomUUID(), so a second tap minted a
// second live link and a second real charge.
//
// This page mounts the EMBEDDED card form instead, which posts to
// /api/square-pay: amount computed server side from the saved registration, an
// idempotency key derived from the registration and the card nonce so a double
// tap cannot charge twice, the payment written onto the submission AND the
// ledger, and a receipt emailed to the payer and to the office.
//
// NO SIGN IN, DELIBERATELY. A coach who gets this in a text will not create an
// account to pay a bill, and the hosted link it replaces needed no login
// either. The bar is "no worse than a Square hosted link" and the URL clears
// it. Every id in live data is a 20 character Firestore auto id, and
// firestore.rules has no match for form_submissions or team_payments so both
// fall to the closing deny, meaning no client can ever enumerate one.
//
// WHAT IT SHOWS, AND WHAT IT REFUSES TO SHOW. A name and the amounts. Never the
// manager name, email or phone on the same document. Never the Square receipt:
// that discloses the payer's name and card last four and, on a clinic place, it
// belongs to a child's parent. A clinic shows a first name and a last initial
// for the same reason.
//
// BOTH FORMS, ONE URL. The kind is resolved here rather than carried in the
// path because auto ids are globally unique, so probing both is unambiguous,
// and because the office pastes these into texts under pressure: a two segment
// URL is one somebody eventually pastes with the wrong middle segment.

import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getAdminDb } from "@/lib/firebase-admin";
import { PaymentOptions } from "@/components/forms/PaymentOptions";
import { CLINIC, clinicIsOver } from "@/lib/clinic";
import { paidClinicPlaces } from "@/lib/clinic-count";
import { feeFor } from "@/lib/fees";
import { cardBlockReason } from "@/lib/fee-ledger";

export const dynamic = "force-dynamic";

// Nothing here belongs in an index, and a crawler that found one would burn a
// Firestore read per unpaid team. robots.txt disallows /pay/ as well; this is
// the half that survives a crawler ignoring robots.txt.
export const metadata: Metadata = { robots: { index: false, follow: false } };

// Shape checked BEFORE any read, so a bot walking short ids costs nothing.
// Firestore auto ids are 20; the range is wide enough for a hand made id
// without admitting a one character probe.
const ID_RE = /^[A-Za-z0-9_-]{16,128}$/;
// Firestore REJECTS ids of the reserved __name__ form at the server, so a
// .get() on one THROWS rather than returning exists:false. Without this the
// page answers 500 and writes an error row for every hit, and a scanner
// walking this public path can tell a malformed id from a well formed one by
// the status code alone. Everything unknown must fail the same way.
const RESERVED_ID_RE = /^__.*__$/;
const KINDS = ["team_registration", "clinic_registration"] as const;

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="container py-10">
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-slate-700">{children}</p>
    </main>
  );
}

export default async function PayPage({
  params,
}: {
  params: { registrationId: string };
}) {
  const tenantId = headers().get("x-tenant-id");
  const id = params.registrationId;
  if (!tenantId || !ID_RE.test(id) || RESERVED_ID_RE.test(id)) notFound();

  const db = getAdminDb();
  let kind: (typeof KINDS)[number] | null = null;
  let data: Record<string, unknown> | null = null;
  // Wrapped, and notFound() is deliberately OUTSIDE the try. Firestore can
  // reject an id shape we did not anticipate at the SERVER, which throws
  // rather than returning exists:false, and a public page that answers 500 to
  // a probe both writes an error row per hit and tells the prober that this id
  // is different from the others. Everything unknown ends at the same 404.
  // notFound() throws a Next control-flow signal, so catching it here would
  // swallow the 404 itself.
  try {
    for (const k of KINDS) {
      const snap = await db
        .doc(`leagues/${tenantId}/form_submissions/${k}/items/${id}`)
        .get();
      if (snap.exists) {
        kind = k;
        data = snap.data() ?? {};
        break;
      }
    }
  } catch {
    kind = null;
    data = null;
  }
  // The SAME 404 for "no such id" and "that id belongs to another league".
  // Telling the two apart would turn this page into an oracle.
  if (!kind || !data) notFound();

  const isClinic = kind === "clinic_registration";

  // Whitespace collapsed, not merely trimmed: live data holds a first name
  // stored as "Alyssa " with a trailing space, and two Island team names have
  // trailing spaces too, so a plain trim leaves a double space mid string.
  // A CLINIC PLACE BELONGS TO A CHILD, so the surname is an initial. Enough for
  // a parent to know the page is theirs, not enough to be a directory entry on
  // a URL anyone can hold.
  const clean = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
  const last = clean(data.player_last_name);
  const who = isClinic
    ? `${clean(data.player_first_name)}${last ? ` ${last[0]}.` : ""}`.trim()
    : clean(data.team_name);

  const payment = (data.payment ?? null) as { status?: string } | null;

  // WHAT THE LEDGER SAYS, which the payment block above cannot see.
  // See lib/fee-ledger.ts for why both of its cases matter here and not before.
  let blocked: string | null = null;
  if (!isClinic) {
    const ledgerId =
      typeof data.assigned_team_id === "string" && data.assigned_team_id
        ? data.assigned_team_id
        : `reg-${id}`;
    const row = (
      await db.doc(`leagues/${tenantId}/team_payments/${ledgerId}`).get()
    ).data();
    blocked = cardBlockReason({
      ledgerDue: Number(row?.amount_due ?? 0),
      ledgerPaid: Number(row?.amount_paid ?? 0),
      registrationFee: feeFor(tenantId, data),
      testFeeActive: Boolean(
        process.env.LEAGUE_TEST_FEE ?? process.env.COYBL_TEST_FEE,
      ),
    });
  }

  if (payment?.status === "paid") {
    // NO RECEIPT LINK. A Square receipt carries the payer's name and card last
    // four, and on a clinic place it belongs to a child's parent. It is already
    // in their inbox, and the office can produce it from the Payments tab.
    return (
      <Notice title="Already paid">
        {who ? `${who} is ` : "This registration is "}down as paid, so there is
        nothing to do here and no card has been charged. Contact the league
        office if that is wrong.
      </Notice>
    );
  }

  if (blocked) {
    return <Notice title="Nothing to pay here">{blocked}</Notice>;
  }

  // THE CLINIC'S TWO HARD LIMITS, shown before a card form rather than after a
  // decline. /api/square-pay enforces both immediately before the money moves
  // and that is the check that counts; this one exists so nobody types a card
  // number for a place that is already gone.
  if (isClinic) {
    if (clinicIsOver()) {
      return (
        <Notice title="The clinic has taken place">
          The College Clinic on {CLINIC.dateLabel} is over, so there is nothing
          to pay and no card has been charged. Call Mike on {CLINIC.phone} to
          hear about the next one.
        </Notice>
      );
    }
    if ((await paidClinicPlaces(db, tenantId)) >= CLINIC.capacity) {
      return (
        <Notice title="The clinic is full">
          All {CLINIC.capacity} places are paid for, so no card has been
          charged. Call Mike on {CLINIC.phone} to go on the waiting list in case
          of a drop out.
        </Notice>
      );
    }
  }

  return (
    <main className="container py-10">
      <h1 className="text-2xl font-bold">
        {isClinic ? "Pay for your clinic place" : "Pay your team fee"}
      </h1>
      {who && <p className="mt-1 text-slate-700">{who}</p>}
      {/* The price breakdown, the card form and the Venmo option all come from
          the component the registration success screen uses, so this page
          cannot drift away from it. New York GBL 518 wants the cash price and
          the card price side by side BEFORE the payer picks card, which is what
          PaymentOptions renders from /api/square-quote, and SquareCardForm
          repeats as fee, processing fee and total above its own Pay button. */}
      <PaymentOptions
        submissionId={id}
        leagueId={tenantId}
        kind={kind}
        noun={isClinic ? "clinic fee" : "team fee"}
        // There is no "later" here. This page IS later: it is what somebody who
        // deferred at sign up was sent, and an exit reading "reply to your
        // confirmation email" would send them round the loop they came here to
        // get out of.
        allowDefer={false}
      />
    </main>
  );
}
