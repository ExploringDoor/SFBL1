// The pile, sorted three ways.
//
// Mike, 2026-09-07, relaying Melinda: "a breakdown of shirts and we can sort
// them by team sort them by size sort them by Age once we close the store on
// Wednesday night."
//
// The close moved to Thursday 4pm on 2026-09-08. The quote is left as he said
// it; lib/store-hours.ts is the one place that decides when the shop shuts.
//
// This is a HANDOVER problem, not a sales report. On Saturday morning somebody
// stands at a field with a box and a list, and what they need is: how many of
// each size to bring, whose stack is whose, and who has not paid yet. Revenue
// is the least interesting number on the page.
//
// Pure, so it can be tested without Firestore and rendered anywhere.

export interface MerchOrderRow {
  id: string;
  /** Written by /api/square-pay when a card clears. It is a NESTED object,
   *  not the flat payment_status this file also reads: the merch order writes
   *  the flat one, the payment route writes this one, and a report that knew
   *  about only one of them would call a paid card order unpaid and send
   *  somebody away from a field without their shirt. */
  payment?: { status?: string; method?: string; amount_cents?: number };
  item_name?: string;
  size?: string;
  quantity?: number;
  amount_due?: number;
  pay_method?: string;
  payment_status?: string;
  division?: string;
  team_name?: string;
  player_name?: string;
  name?: string;
  email?: string;
  phone?: string;
  created_at?: string;
  /** Some rows carry this instead; the store has written both over time. */
  submitted_at?: string;
}

export interface Tally {
  key: string;
  shirts: number;
  orders: number;
  /** Shirts on orders with no money recorded yet. */
  unpaid: number;
  owed: number;
}

const qty = (r: MerchOrderRow) => {
  const n = Math.floor(Number(r.quantity ?? 0));
  return Number.isFinite(n) && n > 0 ? n : 0;
};
/** Paid by EITHER route: the card path writes payment.status, the office
 *  marking a Venmo or Zelle order writes payment_status. */
const isPaid = (r: MerchOrderRow) =>
  r.payment_status === "paid" || r.payment?.status === "paid";

/** Group and count, biggest first. `blank` names rows with nothing in the
 *  field, which happens for orders taken before that field was asked for. */
export function tallyBy(
  rows: MerchOrderRow[],
  pick: (r: MerchOrderRow) => string,
  blank = "Not given",
): Tally[] {
  const out = new Map<string, Tally>();
  for (const r of rows) {
    const key = (pick(r) || "").trim() || blank;
    const t = out.get(key) ?? { key, shirts: 0, orders: 0, unpaid: 0, owed: 0 };
    const n = qty(r);
    t.shirts += n;
    t.orders += 1;
    if (!isPaid(r)) {
      t.unpaid += n;
      t.owed += Number(r.amount_due ?? 0) || 0;
    }
    out.set(key, t);
  }
  return [...out.values()].sort(
    (a, b) => b.shirts - a.shirts || a.key.localeCompare(b.key),
  );
}

/** Sizes in wearing order, not alphabetical: S before M before L. */
const SIZE_ORDER = ["YS", "YM", "YL", "XS", "S", "M", "L", "XL", "2XL", "3XL"];

export function tallyBySize(rows: MerchOrderRow[]): Tally[] {
  return tallyBy(rows, (r) => String(r.size ?? "")).sort((a, b) => {
    const ia = SIZE_ORDER.indexOf(a.key);
    const ib = SIZE_ORDER.indexOf(b.key);
    // Anything unrecognised sorts to the end rather than into the middle.
    if (ia === -1 && ib === -1) return a.key.localeCompare(b.key);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

/** "12U Open" -> "12U". Anything unrecognised is returned unchanged rather
 *  than guessed at, so an odd division shows as itself instead of vanishing. */
export function ageOf(division: string): string {
  const m = /^\s*(\d{1,2}\s*U)\b/i.exec(division);
  return m ? m[1]!.replace(/\s+/g, "").toUpperCase() : division.trim();
}

/** Sort 10U before 12U before 16U, numerically, not as text. */
function ageNum(label: string): number {
  const m = /^(\d{1,2})U$/i.exec(label);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

export interface MerchSummary {
  orders: number;
  shirts: number;
  paidShirts: number;
  unpaidShirts: number;
  collected: number;
  owed: number;
  bySize: Tally[];
  byTeam: Tally[];
  byDivision: Tally[];
  /** By AGE, with the level dropped: 12U Open and 12U C are both 12U.
   *  Melinda asked for "by Age" as well as by team and size, and a division
   *  grouping does not answer it: an age group is one set of parents on one
   *  set of fields, and the shirts for it travel together regardless of
   *  whether a team plays Open or C. */
  byAge: Tally[];
  /** Card, Venmo, Zelle. Mike, 2026-09-10: "It breaks down cc and Venmo or
   *  Zelle ... so I can give it to my team at the field."
   *
   *  Card and the rest are not the same kind of thing and the report must not
   *  pretend they are. A card order is settled by Square and needs nothing at
   *  the field. A Venmo or Zelle order is a PROMISE until somebody in the
   *  office marks it paid, so its shirts are the ones whose money has to be
   *  chased or collected on the day. */
  byMethod: Tally[];
  /** One line per shirt design. With a single design on sale this says the
   *  same thing as the header totals; with two it is the only place the
   *  difference shows. */
  byItem: Tally[];
}

const METHOD_ORDER = ["Card", "Venmo", "Zelle", "Cash", "Not given"];

/** How they said they would pay, in words the office uses. */
export function methodLabel(r: MerchOrderRow): string {
  const m = String(r.pay_method ?? "").trim().toLowerCase();
  if (m === "card") return "Card";
  if (m === "venmo") return "Venmo";
  if (m === "zelle") return "Zelle";
  if (m === "cash") return "Cash";
  return m ? m[0]!.toUpperCase() + m.slice(1) : "Not given";
}

/**
 * Orders placed in a window, by the time they were submitted.
 *
 * The store runs on a weekly cycle, shut Thursday 4pm and open again Saturday
 * 6am, so "this week" is the only view that answers "what do I take to the
 * field on Saturday". Rows with no timestamp are KEPT: an order with a missing
 * date is far more likely to be an old record than something to hide, and
 * dropping it silently would lose a real shirt.
 */
export function inWindow(
  rows: MerchOrderRow[],
  sinceIso: string | null,
): MerchOrderRow[] {
  if (!sinceIso) return rows;
  return rows.filter((r) => {
    const t = String(r.created_at ?? r.submitted_at ?? "").trim();
    return !t || t >= sinceIso;
  });
}

/**
 * Split the pile into one group per shirt, newest-selling first.
 *
 * WHY THIS EXISTS. Until 2026-09-11 the shop sold one design, so the summary
 * added every order together and was right by accident. Melinda then described
 * the real model: "I'll try to keep them flowing so it never has to close.
 * There will just be an end date for each shirt." Two designs on sale at once
 * is now the normal case.
 *
 * Adding them together would break in the worst possible place. "By size: 19
 * smalls" is the number somebody uses to pack the boxes for a Saturday, and
 * across two designs it is nineteen smalls of NOTHING in particular. The right
 * total, the wrong shirts, and no way to tell from the summary that it is
 * wrong.
 *
 * Orders taken before item_name was recorded fall under "Shirt", which is
 * honest: it is the one design that existed then.
 */
export function splitByItem(
  rows: MerchOrderRow[],
): { item: string; rows: MerchOrderRow[]; summary: MerchSummary }[] {
  const groups = new Map<string, MerchOrderRow[]>();
  for (const r of rows) {
    const key = String(r.item_name ?? "").trim() || "Shirt";
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.entries()]
    .map(([item, rs]) => ({ item, rows: rs, summary: summarise(rs) }))
    .sort((a, b) => b.summary.shirts - a.summary.shirts || a.item.localeCompare(b.item));
}

export function summarise(rows: MerchOrderRow[]): MerchSummary {
  const shirts = rows.reduce((n, r) => n + qty(r), 0);
  const paidShirts = rows.filter(isPaid).reduce((n, r) => n + qty(r), 0);
  return {
    orders: rows.length,
    shirts,
    paidShirts,
    unpaidShirts: shirts - paidShirts,
    collected: rows
      .filter(isPaid)
      .reduce((n, r) => n + (Number(r.amount_due ?? 0) || 0), 0),
    owed: rows
      .filter((r) => !isPaid(r))
      .reduce((n, r) => n + (Number(r.amount_due ?? 0) || 0), 0),
    bySize: tallyBySize(rows),
    byTeam: tallyBy(rows, (r) => String(r.team_name ?? ""), "No team given"),
    byDivision: tallyBy(rows, (r) => String(r.division ?? ""), "No division given"),
    byAge: tallyBy(rows, (r) => ageOf(String(r.division ?? "")), "No age given").sort(
      (a, b) => (ageNum(a.key) - ageNum(b.key)) || a.key.localeCompare(b.key),
    ),
    byMethod: tallyBy(rows, (r) => methodLabel(r), "Not given").sort(
      (a, b) => METHOD_ORDER.indexOf(a.key) - METHOD_ORDER.indexOf(b.key),
    ),
    byItem: tallyBy(rows, (r) => String(r.item_name ?? ""), "Shirt"),
  };
}

/**
 * The packing list: one line per player, grouped division then team then size.
 *
 * This is the order somebody actually hands shirts out in, which is why it is
 * not sorted by date or by name.
 */
export function packingList(rows: MerchOrderRow[]): MerchOrderRow[] {
  const sizeIdx = (s: string) => {
    const i = SIZE_ORDER.indexOf(s);
    return i === -1 ? SIZE_ORDER.length : i;
  };
  return [...rows].sort(
    (a, b) =>
      String(a.division ?? "").localeCompare(String(b.division ?? "")) ||
      String(a.team_name ?? "").localeCompare(String(b.team_name ?? "")) ||
      sizeIdx(String(a.size ?? "")) - sizeIdx(String(b.size ?? "")) ||
      String(a.player_name ?? "").localeCompare(String(b.player_name ?? "")),
  );
}
