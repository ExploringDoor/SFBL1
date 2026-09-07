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
