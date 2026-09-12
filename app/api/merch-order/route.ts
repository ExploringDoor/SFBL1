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
import { isStoreOpen, readStoreHours } from "@/lib/store-hours";
import { esc, notifyAddresses, sendEmail } from "@/lib/email/send";
import merch from "@/app/store/island-merch.json";
import {
  MAX_PER_ORDER,
  isMerchDivision,
  isPayMethod,
  merchTotal,
  type MerchItem,
  isOnSale,
  leagueToday,
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
  // THE SALE WINDOW IS ENFORCED HERE, not only in the page that hides the
  // shirt. Every shirt now carries its own end date (Melinda, 2026-09-11), and
  // the gap between the two is a real one: somebody leaves the store open on
  // their phone on the last night of a sale, orders in the morning, and the
  // office gets a card payment for a shirt that is no longer being printed.
  // Refusing it here means the worst case is an apologetic message rather than
  // money taken for something nobody can hand over.
  if (!isOnSale(item, leagueToday())) {
    return NextResponse.json(
      {
        error:
          "That shirt is no longer on sale. Nothing has been charged. Check the store for what is available now.",
      },
      { status: 409 },
    );
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

  // CARD ONLY, decided here rather than trusted from the form.
  //
  // Melinda, 2026-09-11: "Remove the Venmo and Zelle options. We will only
  // receive payment by credit card on the website." The picker is gone from
  // the shop, but a tab left open since yesterday still posts payMethod
  // "venmo", and that order would land as an unpaid promise nobody is
  // watching a phone for. So the server decides, and the client cannot.
  //
  // The other methods are NOT deleted from isPayMethod: the admin still shows
  // and reconciles the orders taken on them before today, and the store report
  // still splits by method for the ones already in the pile.
  const method = "card" as const;

  // WHO IT IS FOR, so the pile can be sorted before Saturday. Mike, 2026-09-07:
  // "He also needs to add what division they're playing", with the team and the
  // player's name. These are handed over at a field, not posted, so the sort is
  // the whole logistics problem.
  //
  // Division is allow-listed because it becomes a grouping key in the office
  // breakdown; a typed division would quietly split a team's stack in two.
  const division = str(body.division, 40);
  if (!isMerchDivision(division)) {
    return NextResponse.json({ error: "Pick a division" }, { status: 400 });
  }
  const teamName = str(body.teamName, 120);
  const playerName = str(body.playerName, 120);
  if (!teamName) {
    return NextResponse.json({ error: "Team name is required" }, { status: 400 });
  }
  if (!playerName) {
    return NextResponse.json({ error: "Player name is required" }, { status: 400 });
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
  // PHONE IS REQUIRED TOO. Mike, 2026-09-07: "force them to give phone number
  // and email so we can keep that and build on it." A shirt is collected at a
  // field, so a phone is how the office reaches somebody standing in the wrong
  // place, and tonight it was how four unpaid card buyers got chased at all.
  //
  // Ten digits, checked, because a phone that is not dialable is the same as no
  // phone and worse, since it looks like one on the sheet.
  const phoneDigits = phone.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  if (phoneDigits.length !== 10) {
    return NextResponse.json(
      { error: "A 10 digit phone number is required" },
      { status: 400 },
    );
  }

  const total = merchTotal(item, quantity);
  if (total <= 0) {
    return NextResponse.json({ error: "Could not price that order" }, { status: 400 });
  }

  const db = getAdminDb();

  // SHUT MEANS SHUT, and it is enforced here rather than only on the page. The
  // store page hides the form while the shop is closed, but a form already open
  // in somebody's browser at 3.59 on Thursday will still post at 4.05.
  const hours = readStoreHours(
    (await db.doc(`leagues/${leagueId}/site_config/merch_hours`).get()).data(),
  );
  if (!isStoreOpen(new Date(), hours)) {
    return NextResponse.json({ error: hours.closedNote }, { status: 409 });
  }

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
        division,
        team_name: teamName,
        player_name: playerName,
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

  // ---- tell the office a shirt sold -------------------------------------
  // Mike, 2026-09-07: "When a sale happens can you put
  // melinda.islandusssa@gmail.com gets it like me."
  //
  // She goes on a STORE list, not the main office one. That list already
  // receives every registration, waiver and evaluation, and putting her there
  // to get sale emails would sign her up for all of it. The list lives in
  // Firestore beside the payment handles so it can change without a deploy.
  //
  // Best effort, after the order is safely written. An email that fails must
  // never cost somebody their shirt.
  try {
    const extra = (
      await db.doc(`leagues/${leagueId}/site_config/merch_notify`).get()
    ).data() as { to?: unknown } | undefined;
    const storeList = Array.isArray(extra?.to)
      ? extra!.to.map((x) => String(x).trim()).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x))
      : [];
    const recipients = [...new Set([...notifyAddresses(), ...storeList])];
    const paidLine =
      method === "card"
        ? "Paying by card on the site."
        : `Paying by ${method}. Watch for ${esc(name)}.`;
    const html =
      `<p><strong>${esc(quantity)} x ${esc(item.name)}, size ${esc(size)}</strong></p>` +
      `<p>$${total}. ${paidLine}</p>` +
      `<table cellpadding="4">` +
      `<tr><td>Player</td><td><strong>${esc(playerName)}</strong></td></tr>` +
      `<tr><td>Team</td><td>${esc(teamName)}</td></tr>` +
      `<tr><td>Division</td><td>${esc(division)}</td></tr>` +
      `<tr><td>Ordered by</td><td>${esc(name)}</td></tr>` +
      `<tr><td>Email</td><td>${esc(email)}</td></tr>` +
      `<tr><td>Phone</td><td>${esc(phone) || "not given"}</td></tr>` +
      `</table>` +
      // "Collected at the field" read to the office as COLLECTING MONEY at
      // the field, which is the opposite of what it means: the shirt is picked
      // up there, the money is already handled. Mike, 2026-09-10: "My girls in
      // the office thinks it's collecting money at the field." Say shirt.
      `<p>This shirt is picked up at the field. Nothing is posted.</p>`;
    for (const to of recipients) {
      await sendEmail({
        to,
        subject: `Shirt order: ${playerName}, ${teamName} (${size})`,
        html,
        ...(email ? { replyTo: email } : {}),
      }).catch(() => null);
    }
  } catch {
    /* a sale is recorded whether or not the office hears about it today */
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
  // payTo was the Venmo handle or Zelle number to send the money to. The shop
  // is card only now, so there is nothing to hand back and the lookup that
  // read site_config/merch_pay is gone with it. The field stays in the
  // response as null so an older cached page still parses the reply.
  const payTo: string | null = null;

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
