// POST /api/merch-order — order a shirt.
//
// Mike, 2026-09-06: "Card, Venmo, zelle - pick up at field."
//
// FIVE LARGES IS THE WHOLE PROBLEM. Sixty smalls will never run out; five
// larges will, and two people ordering the last one at the same moment must not
// both be told yes. So the count moves inside a Firestore TRANSACTION: read,
// check, decrement, write the order, all or nothing. An order that cannot be
// filled is refused here, before anybody is charged, rather than apologised for
// afterwards.
//
// STOCK MOVES ON THE ORDER, NOT ON PAYMENT. Venmo and Zelle land in Mike's
// phone minutes or hours later and there is no webhook to hear them, so waiting
// for money before reserving would sell the same large four times over an
// evening. The cost of that choice is abandoned orders holding stock, and the
// answer to it is the office cancelling one, which puts the shirt back.
//
// THE PRICE IS COMPUTED HERE, from the checked-in catalogue. A browser cannot
// influence what it will be asked to pay; lib/fees.ts reads the same catalogue,
// so the number on the page and the number on the card agree by construction.
//
// Card orders are finished at /pay/{id} by the existing embedded Square form,
// which already handles idempotency, the surcharge and receipts. This route
// never touches money.

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import merch from "@/app/store/island-merch.json";
import {
  MAX_PER_ORDER,
  isPayMethod,
  merchTotal,
  type MerchItem,
} from "@/lib/merch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Only Island has a store. Another tenant reaching this gets a flat no
 *  rather than an order row in a league that sells nothing. */
const STORE_LEAGUE = "island";

const str = (v: unknown, max: number) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const leagueId = str(body.leagueId, 40);
  if (leagueId !== STORE_LEAGUE) {
    return NextResponse.json({ error: "No store here" }, { status: 404 });
  }

  const items = (merch as unknown as { items: MerchItem[] }).items ?? [];
  const item = items.find((i) => i.id === str(body.itemId, 60));
  if (!item) {
    return NextResponse.json({ error: "That item is not for sale" }, { status: 400 });
  }

  const size = str(body.size, 12);
  if (!item.sizes.includes(size)) {
    return NextResponse.json({ error: "Pick a size" }, { status: 400 });
  }

  const quantity = Math.floor(Number(body.quantity ?? 1));
  if (!Number.isFinite(quantity) || quantity < 1 || quantity > MAX_PER_ORDER) {
    return NextResponse.json(
      { error: `Choose between 1 and ${MAX_PER_ORDER} shirts` },
      { status: 400 },
    );
  }

  const method = isPayMethod(body.payMethod) ? body.payMethod : null;
  if (!method) {
    return NextResponse.json({ error: "Choose how you will pay" }, { status: 400 });
  }

  const name = str(body.name, 120);
  const email = str(body.email, 200);
  const phone = str(body.phone, 40);
  if (!name) {
    return NextResponse.json({ error: "Your name is required" }, { status: 400 });
  }
  // Loose on purpose: this is a shirt, not an account. Enough to catch a typo.
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
  }

  const total = merchTotal(item, quantity);
  if (total <= 0) {
    return NextResponse.json({ error: "Could not price that order" }, { status: 400 });
  }

  const db = getAdminDb();
  const stockRef = db.doc(`leagues/${leagueId}/site_config/merch_stock`);
  const orderRef = db
    .collection(`leagues/${leagueId}/form_submissions/merch_order/items`)
    .doc();
  const now = new Date().toISOString();

  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(stockRef);
      const all = (snap.data() ?? {}) as Record<string, Record<string, number>>;
      const row = all[item.id] ?? {};
      // A size absent from the document has never sold, so it still holds its
      // opening count. Reading that as zero would close the shop on day one.
      const have =
        typeof row[size] === "number" ? row[size] : (item.initial_stock[size] ?? 0);

      if (have < quantity) {
        const err = new Error(
          have <= 0
            ? `${item.name} in ${size} has sold out.`
            : `Only ${have} left in ${size}.`,
        ) as Error & { code?: string };
        err.code = "OUT_OF_STOCK";
        throw err;
      }

      tx.set(
        stockRef,
        { [item.id]: { ...row, [size]: have - quantity }, updated_at: now },
        { merge: true },
      );
      tx.set(orderRef, {
        // Shaped like every other form submission, so it lands in the admin's
        // Form submissions tab without a new screen to build.
        kind: "merch_order",
        item_id: item.id,
        item_name: item.name,
        size,
        quantity,
        unit_price: item.price,
        amount_due: total,
        pay_method: method,
        // Card orders are marked paid by /api/square-pay when the card clears.
        // The rest are the office's to tick off as the money arrives.
        payment_status: "unpaid",
        fulfilment: "pickup_at_field",
        name,
        email,
        phone,
        status: "new",
        created_at: now,
        submitted_at: now,
      });
    });
  } catch (e) {
    const code = (e as Error & { code?: string }).code;
    if (code === "OUT_OF_STOCK") {
      // 409, not 400: the request was fine, the world changed under it.
      return NextResponse.json({ error: (e as Error).message }, { status: 409 });
    }
    return NextResponse.json(
      { error: "Could not place that order. Please try again." },
      { status: 500 },
    );
  }

  try {
    await db.collection(`leagues/${leagueId}/audit`).add({
      kind: "merch_order",
      order_id: orderRef.id,
      item: item.id,
      size,
      quantity,
      pay_method: method,
      at: now,
    });
  } catch {
    /* never fail an order over the audit row */
  }

  // WHERE TO SEND THE MONEY, returned only to someone who has actually
  // ordered. These were going to be props on the store page, which would have
  // put Mike's Venmo handle and his MOBILE NUMBER into the page source of a
  // public site for anything that scrapes it. He gave them so buyers can pay,
  // not so they can be harvested, and handing them back with the order costs
  // one read and discloses them to exactly the people who need them.
  let payTo: string | null = null;
  if (method === "venmo" || method === "zelle") {
    try {
      const pay = (
        await db.doc(`leagues/${leagueId}/site_config/merch_pay`).get()
      ).data() as { venmo?: string; zelle?: string } | undefined;
      const v = method === "venmo" ? pay?.venmo : pay?.zelle;
      payTo = typeof v === "string" && v.trim() ? v.trim() : null;
    } catch {
      // The order stands either way. A missing handle means the confirmation
      // tells them the office will be in touch, which is recoverable; losing
      // the order would not be.
      payTo = null;
    }
  }

  return NextResponse.json({
    ok: true,
    orderId: orderRef.id,
    total,
    payMethod: method,
    payTo,
    // Where a card payer goes next. That page recomputes the amount from the
    // saved order, so this is a destination, not an instruction.
    payUrl: method === "card" ? `/pay/${orderRef.id}?kind=merch_order` : null,
  });
}
