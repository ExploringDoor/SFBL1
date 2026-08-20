// How many clinic places are actually SOLD.
//
// Three surfaces ask this and they are not allowed to disagree: the page, to
// print "N places left"; /api/league-form, to refuse a registration at
// capacity; and /api/square-pay, to refuse the charge that would be the 41st.
// Three copies of one filter is three chances for one of them to count
// something the other two do not, which is the same reasoning that put the
// date in lib/clinic.ts.
//
// Not IN lib/clinic.ts on purpose: that file is imported by ClinicPopup, a
// Client Component, and firebase-admin cannot be bundled for the browser.
//
// PAID only. An abandoned form occupies nothing, and counting it would close a
// clinic that is half empty. "paid" is written by /api/square-pay for a card
// and by /api/admin-clinic-payment when the office records a Venmo, and it has
// to be the same field either way: the payment screen RECOMMENDS Venmo, so a
// place bought the recommended way has to consume a place like any other.
// Before that route existed it did not, and the clinic would have oversold by
// exactly the number of families who did as they were told.
//
// READS THE WHOLE COLLECTION, and the collection is NOT capped at 40. Only
// PAID places are. Registering is free, and the same-mailbox flood check in
// /api/league-form deliberately excludes clinic_registration, so the only
// ceiling on document count is the per-IP RATE_LIMIT of 20 saves per 10
// minutes, which is in memory and per lambda instance. At 3 documents today
// that is cheaper and far simpler than an aggregation query or a
// payment.status filter, both of which add an index dependency to a public
// page three weeks before the season. If this collection ever runs to
// hundreds, add the index and the where() clause then, together.

import type { Firestore } from "firebase-admin/firestore";

export async function paidClinicPlaces(
  db: Firestore,
  tenantId: string,
): Promise<number> {
  const snap = await db
    .collection(`leagues/${tenantId}/form_submissions/clinic_registration/items`)
    .get();
  return snap.docs.filter(
    (d) =>
      (d.data().payment as { status?: string } | undefined)?.status === "paid",
  ).length;
}