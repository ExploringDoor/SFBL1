// READ ONLY. Lists the teams that may have paid through the RETIRED Square
// hosted payment link and are still recorded as unpaid, so the office can
// check each one against the Square dashboard by hand.
//
// Why by hand. /api/square-checkout never stored the payment link id or the
// order id it created at Square, so there is nothing to join on and no way to
// ask Square whether a particular link was paid. All it left behind is
// card.initiated_at on the registration. This narrows the search to a handful
// of names, amounts and timestamps. Square is the source of truth.
//
//   SA_PATH=~/Desktop/island-fastpitch-site/firebase/island-service-account.json \
//     LEAGUE=island npx tsx scripts/reconcile-hosted-links.ts
//
//   SA_PATH=secrets/coybl-sa.json LEAGUE=coybl npx tsx scripts/reconcile-hosted-links.ts
//
// Each league is its OWN Firebase project, so the service account and LEAGUE
// must match. A COYBL service account reads Island as empty rather than
// erroring, which looks like good news and is not.
//
// Writes nothing, anywhere. .get() only. Never calls Square.

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { existsSync } from "node:fs";

const { SA_PATH, LEAGUE } = process.env;
if (!SA_PATH || !existsSync(SA_PATH)) {
  console.error("SA_PATH required. The league's OWN service account json.");
  process.exit(1);
}
if (!LEAGUE || !/^[a-z0-9_-]+$/.test(LEAGUE)) {
  console.error("LEAGUE required, e.g. LEAGUE=island or LEAGUE=coybl");
  process.exit(1);
}

const usd = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

interface CardBlock {
  initiated_at?: string;
  amount_cents?: number;
}
interface PaymentBlock {
  status?: string;
  square_payment_id?: string;
}

initializeApp({ credential: cert(SA_PATH) });
const db = getFirestore();

(async () => {
  const regs = await db
    .collection(`leagues/${LEAGUE}/form_submissions/team_registration/items`)
    .get();
  const ledger = await db.collection(`leagues/${LEAGUE}/team_payments`).get();

  // Ledger rows that show money in, keyed by the registration they settle.
  // Confirmed against live data on both leagues: team_payments.registration_id
  // holds the registration DOCUMENT id, so this joins cleanly on doc id.
  const settled = new Map<
    string,
    { method: string; amount: number; at: string }
  >();
  for (const d of ledger.docs) {
    const x = d.data();
    const rid = String(x.registration_id ?? "");
    const amount = Number(x.amount_paid ?? 0);
    if (rid && amount > 0) {
      settled.set(rid, {
        method: String(x.method ?? "unknown"),
        amount,
        at: String(x.paid_at ?? ""),
      });
    }
  }

  const unresolved: string[] = [];
  const doubleCheck: string[] = [];
  const known: string[] = [];

  for (const d of regs.docs) {
    const x = d.data();
    const payment = x.payment as PaymentBlock | undefined;

    // Every embedded form payment carries a Square payment id. That makes this
    // the complement of the search: a card payment sitting in Square in the
    // same date range that is NOT on this list came through a hosted link.
    if (payment?.square_payment_id) {
      known.push(`${payment.square_payment_id}  ${String(x.team_name ?? "")}`);
    }

    const card = x.card as CardBlock | undefined;
    if (!card?.initiated_at) continue;

    // card.initiated_at is stored as a UTC ISO string. Labelled, because
    // reading it as local time is how you conclude a link was minted after a
    // deploy that in fact came hours later.
    const line =
      `  ${String(x.team_name ?? "(no name)")}\n` +
      `      link minted ${card.initiated_at} (UTC) for ${usd(Number(card.amount_cents ?? 0))}\n` +
      `      registration ${d.id}`;

    const row = settled.get(d.id);
    const paidOnDoc = payment?.status === "paid";

    // EXHAUSTIVE on purpose. An earlier draft branched
    // `if (!paidOnDoc && !row) ... else if (row) ...`, which silently dropped
    // the one shape that matters most: paid on the registration, absent from
    // the ledger. That is the "charged but the office cannot see it" case
    // square-pay's own catch block warns about, and a reconciliation script
    // that hides it is worse than no script.
    if (row) {
      doubleCheck.push(
        `${line}\n      ledger says ${row.method} ${usd(row.amount * 100)} on ${row.at}`,
      );
    } else if (paidOnDoc) {
      doubleCheck.push(
        `${line}\n      registration says PAID (${payment?.square_payment_id ?? "no square id"}) but there is NO ledger row. Fix the ledger.`,
      );
    } else {
      unresolved.push(line);
    }
  }

  console.log(`League: ${LEAGUE}`);
  console.log(`Registrations: ${regs.size}. Ledger rows: ${ledger.size}.`);

  console.log(
    `\nUNRESOLVED. A hosted link was minted and NOTHING is recorded (${unresolved.length}):`,
  );
  console.log(unresolved.length ? unresolved.join("\n") : "  none");

  console.log(
    `\nCHECK ANYWAY. A link was minted, and the money is recorded somewhere else or not where it belongs (${doubleCheck.length}).`,
  );
  console.log(
    "A card payment in Square on top of one of these means they paid twice:",
  );
  console.log(doubleCheck.length ? doubleCheck.join("\n") : "  none");

  console.log(`\nPAYMENTS WE ALREADY KNOW ABOUT (${known.length}).`);
  console.log("All of these came through the embedded form and are recorded.");
  console.log(known.length ? known.map((s) => `  ${s}`).join("\n") : "  none");

  console.log("\nIn Square, a hosted link payment reads as a capitalised item name:");
  console.log('  "COYBL 2027 Registration: <team>"   links minted before the 20 Aug 2026 rename');
  console.log('  "<ABBREV> Registration: <team>"     links minted after it');
  console.log("An embedded form payment reads as a lowercase note instead:");
  console.log(`  "${LEAGUE} registration: <team>"`);
  console.log(
    "Compare the (UTC) timestamps above against the rename before choosing which to search for.",
  );
  process.exit(0);
})();