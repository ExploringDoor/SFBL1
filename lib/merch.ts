// The league store: what is for sale, and what is left of it.
//
// Mike, 2026-09-06: sell the Never Forget tee at $30, "Card, Venmo, zelle -
// pick up at field", and he sent the counts with it: 60 small, 30 medium, 5
// large, 5 XL.
//
// WHERE THE NUMBERS LIVE, and why they live in two places on purpose.
//
//   The CATALOGUE (name, price, image, which sizes exist) is checked in, in
//   app/store/island-merch.json. It changes when somebody decides to sell
//   something, which is a deploy either way because it needs artwork.
//
//   The STOCK is in Firestore. It changes every time somebody buys a shirt, so
//   it cannot be a file: a checked-in count would be wrong within the hour and
//   would need me to change it, which is exactly the shape of problem this
//   league keeps hitting.
//
// FIVE LARGES IS THE WHOLE DESIGN. With sixty smalls nothing here matters; with
// five larges, two people ordering at once must not both get one. So the count
// moves inside a Firestore transaction, and a size that cannot be filled is
// refused rather than oversold and apologised for later.

export interface MerchSize {
  size: string;
  count: number;
}

export interface MerchItem {
  /** Stable key, used as the Firestore stock field and in an order row. */
  id: string;
  name: string;
  /** Dollars. The card is charged from HERE, never from the browser. */
  price: number;
  image?: string;
  detail?: string;
  /** Sizes this item comes in, in the order they should read. */
  sizes: string[];
  /** Opening counts, used to seed the live stock the first time only. */
  initial_stock: Record<string, number>;
  /** YYYY-MM-DD, New York. The LAST day this shirt can be ordered, inclusive:
   *  an end date of 2026-09-20 sells right through the 20th and stops at
   *  midnight. Omit for a shirt that stays on sale until somebody removes it.
   *
   *  Melinda, 2026-09-11: "It can reopen once I send you the new shirts and
   *  I'll try to keep them flowing so it never has to close. There will just
   *  be an end date for each shirt."
   *
   *  That is a different shape from the weekly open/close window this shop
   *  started with, and it replaces it: the SHOP no longer keeps hours, the
   *  SHIRTS do. One ending the day another starts means a store that never
   *  shuts, which is what she is describing. */
  ends_on?: string;
  /** YYYY-MM-DD, New York. The first day it can be ordered. Omit for "already
   *  on sale". Lets her hand over several shirts at once and have them appear
   *  on their own days rather than all at once. */
  starts_on?: string;
}

/** Is this shirt on sale on the given day? `today` is a YYYY-MM-DD in LEAGUE
 *  time, not the server's: a shirt ending "today" must not stop selling at
 *  8pm New York because the server in UTC has already ticked over. */
export function isOnSale(item: MerchItem, today: string): boolean {
  if (item.starts_on && today < item.starts_on) return false;
  if (item.ends_on && today > item.ends_on) return false;
  return true;
}

/** The shirts on sale today, in catalogue order. */
export function onSaleItems(items: MerchItem[], today: string): MerchItem[] {
  return items.filter((i) => isOnSale(i, today));
}

/** YYYY-MM-DD for "now" in New York, which is the only clock this shop uses. */
export function leagueToday(now: Date = new Date()): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return p; // en-CA renders as YYYY-MM-DD
}

/** How someone said they would pay. Only "card" moves money on the site.
 *
 *  Cash was offered and Mike took it out the same day (2026-09-06). Removed
 *  from this list rather than merely hidden in the form: isPayMethod reads it,
 *  so an order that still says "cash" is refused by the API instead of arriving
 *  from a stale browser tab as a method the office no longer accepts. */
export type PayMethod = "card" | "venmo" | "zelle";

export const PAY_METHODS: { value: PayMethod; label: string }[] = [
  { value: "card", label: "Card, now on this page" },
  { value: "venmo", label: "Venmo" },
  { value: "zelle", label: "Zelle" },
];

/** Nobody needs sixteen shirts, and a typo in a quantity box is how five
 *  larges become none. */
export const MAX_PER_ORDER = 6;

/**
 * The divisions Island plays, as Mike wrote them: "10 oh 12 oh 12 C 14 oh
 * 14 C 16 oh 18 oh". O is Open, C is C level, which is the split the
 * tournaments page already describes.
 *
 * ASKED ON A SHIRT ORDER because the shirts are handed over at a field, not
 * posted. Knowing the division, the team and the player is the difference
 * between "sixty shirts in a box" and a pile Melinda can sort into stacks per
 * team before Saturday morning.
 */
export const MERCH_DIVISIONS = [
  "10U Open",
  "12U Open",
  "12U C",
  "14U Open",
  "14U C",
  "16U Open",
  "18U Open",
] as const;

export function isMerchDivision(v: unknown): boolean {
  return typeof v === "string" && (MERCH_DIVISIONS as readonly string[]).includes(v);
}

export function isPayMethod(v: unknown): v is PayMethod {
  return typeof v === "string" && PAY_METHODS.some((m) => m.value === v);
}

/**
 * Live counts for one item, falling back to the opening numbers.
 *
 * A missing stock document means nothing has sold yet, NOT that everything is
 * gone: reading it as zero would put the whole store into "sold out" the moment
 * a Firestore read hiccuped.
 */
export function stockFor(
  item: MerchItem,
  live: Record<string, unknown> | null | undefined,
): MerchSize[] {
  const row = (live?.[item.id] ?? null) as Record<string, unknown> | null;
  return item.sizes.map((size) => {
    const v = row?.[size];
    const count =
      typeof v === "number" && Number.isFinite(v)
        ? Math.max(0, Math.floor(v))
        : (item.initial_stock[size] ?? 0);
    return { size, count };
  });
}

/** What an order costs, before any card surcharge. Dollars. */
export function merchTotal(item: MerchItem, quantity: number): number {
  const q = Math.floor(Number(quantity));
  if (!Number.isFinite(q) || q < 1 || q > MAX_PER_ORDER) return 0;
  return item.price * q;
}
