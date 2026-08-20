// POST /api/square-checkout. RETIRED 2026-08-20. Answers 410 Gone and nothing
// else: it takes no money, creates nothing at Square, and writes nothing.
//
// What it used to do, and why that was worse than useless. It minted a Square
// HOSTED payment link (quick_pay) and then wrote exactly one thing to
// Firestore, card.initiated_at. Nothing in this codebase has ever read that
// field and there is no Square webhook, so a coach who followed the link and
// paid stayed unpaid everywhere the office looks: the Payments tab,
// /api/captain-fee, and /api/admin-payment-reminders, which then emailed him
// chasing money he had already sent. No receipt was sent either. And the
// idempotency key was crypto.randomUUID(), so a second tap minted a second
// link and Square could take the money a second time.
//
// It was also an unauthenticated write. It took a registrationId straight from
// an anonymous request body, called Square, and wrote to Firestore, with no
// identity check of any kind, on two live production domains.
//
// The evidence at the moment of retirement, from a read only Firestore audit.
// Island: 10 team registrations, ZERO carrying card.initiated_at, so no link
// was ever minted there. COYBL: 3 carrying it with no payment recorded. The
// names, amounts and timestamps are in docs/hosted-link-reconciliation.md
// rather than here, because that is the office's worklist and it will be
// closed out long before this comment is.
//
// The replacement is /api/square-pay, the embedded card form's endpoint. It
// computes the amount server side from the saved registration, keys
// idempotency on (registrationId, sourceId) so a retry returns the original
// payment instead of charging twice, writes the payment block and the
// team_payments row, and emails a receipt to the payer and to the office.
//
// KEPT as a 410 rather than deleted, deliberately. A browser tab left open
// across the deploy still holds the old bundle and will POST here. A deleted
// route answers that with a Next 404 HTML page, which reads to the office as a
// broken site. This answers in the JSON shape both old callers already parse,
// with NO `url` key, so each falls into its existing error branch and no money
// moves. Delete this file once the warning below has been silent for a full
// registration cycle.
//
// LINKS ALREADY MINTED AT SQUARE ARE STILL PAYABLE. Retiring this route does
// not reach them, because it never stored the payment link id. They have to be
// deleted by hand in the Square dashboard. See
// docs/hosted-link-reconciliation.md.

import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Reads the host off the Request rather than next/headers() on purpose. This
// route no longer needs a tenant, and taking the plain Request means the
// retirement test can call POST directly with no module mock at all.
export async function POST(req: Request) {
  // Loud, and named, because after this batch the only way to reach this line
  // is a stale browser tab or a caller we believed we had removed. No money
  // moves either way, so this is a signal and not an incident.
  console.warn(
    "[square-checkout] RETIRED endpoint was called. Check for a caller we missed.",
    {
      host: req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "",
      referer: req.headers.get("referer") ?? "",
    },
  );
  return NextResponse.json(
    {
      // Deliberately NOT naming a surface. Nothing in this repo calls this
      // route any more, so the only readers are a stale browser tab or a
      // caller we missed, and neither is known to be on a particular screen.
      // Naming one would send somebody to the wrong place.
      error:
        "Card payment links have been retired. Refresh this page and use the card payment shown there, or contact the league office.",
      // Stable and machine readable, so the test and any future caller key on
      // this rather than on prose a copy edit will move.
      code: "square_checkout_retired",
    },
    { status: 410 },
  );
}
