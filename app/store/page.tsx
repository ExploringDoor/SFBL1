// League store.
//
// Mike has a line of Island merch coming (Adam, 2026-08-02). Nothing is on
// sale yet and where it will be sold is still being decided, so this page
// announces the line and switches itself to a product grid the moment
// island-merch.json has items — no code change needed at that point.
//
// No placeholder products. A fake tee at a fake price on a live site is worse
// than an honest empty state, and a coach who clicks a dead Buy button does
// not come back.
//
// A real route rather than the /content/store CMS page DEFAULT_LINKS points
// at, for the same reason as /sponsors: the CMS version needs a Firestore doc
// authored before it renders anything.

import Link from "next/link";
import { headers } from "next/headers";
import type { PublicLeagueConfig } from "@/lib/tenants";
import merch from "./island-merch.json";
import { leagueToday, onSaleItems } from "@/lib/merch";
import "./store.css";
import { getAdminDb } from "@/lib/firebase-admin";
import { OrderForm } from "./OrderForm";
import { stockFor, type MerchItem } from "@/lib/merch";
import { isStoreOpen, readStoreHours } from "@/lib/store-hours";

export const dynamic = "force-dynamic";

export const metadata = { title: "Store" };

interface StoreData {
  headline: string;
  blurb: string;
  note?: string;
  buy_url?: string | null;
  items: MerchItem[];
}

export default async function StorePage() {
  const h = headers();
  const tenantId = h.get("x-tenant-id");
  const config = (() => {
    const raw = h.get("x-tenant-config-json");
    if (!raw) return null;
    try {
      return JSON.parse(raw) as PublicLeagueConfig;
    } catch {
      return null;
    }
  })();

  // Only Island has a store today. Another tenant reaching this route gets the
  // neutral empty state rather than Island's copy.
  const data: StoreData | null =
    tenantId === "island" ? (merch as unknown as StoreData) : null;
  // ONE SHIRT ENDS, THE NEXT BEGINS. Melinda, 2026-09-11: "I'll try to keep
  // them flowing so it never has to close. There will just be an end date for
  // each shirt." So the SHOP keeps no hours; each shirt carries its own
  // starts_on / ends_on and the page shows whatever is on sale today.
  //
  // A shirt past its end date disappears from the store rather than sitting
  // there greyed out: the orders already placed on it are still collected at
  // the field, and a card form for a shirt nobody is printing any more is a
  // way to take money for nothing.
  const today = leagueToday();
  const allItems = data?.items ?? [];
  const items = onSaleItems(allItems, today);

  // Live stock and the opening hours. site_config/merch_pay is no longer read:
  // it holds the Venmo handle and the Zelle number, and the shop stopped
  // taking either on 2026-09-11 (Melinda: "We will only receive payment by
  // credit card on the website"). The document is left in place because the
  // admin still reconciles the orders taken on them before that.
  const [stockDoc, hoursDoc] = items.length
    ? await Promise.all([
        getAdminDb().doc(`leagues/${tenantId}/site_config/merch_stock`).get(),
        getAdminDb().doc(`leagues/${tenantId}/site_config/merch_hours`).get(),
      ]).catch(() => [null, null] as const)
    : ([null, null] as const);
  const live = (stockDoc?.data() ?? null) as Record<string, unknown> | null;
  // The store-wide window is still honoured, because another tenant may want
  // one and because it is the emergency stop: setting merch_hours can shut the
  // whole shop without editing the catalogue. Island now leaves it disabled
  // and lets the per-shirt dates do the work.
  const hours = readStoreHours(hoursDoc?.data());
  const open = isStoreOpen(new Date(), hours);
  const leagueName = config?.name ?? "the league";

  return (
    <main className="container py-10">
      <header className="mb-6">
        {/* Hidden by the theme on tenants whose banner art names the page; kept
            for screen readers and the document outline. */}
        <h1
          className="font-display"
          style={{
            fontSize: "clamp(40px, 6vw, 64px)",
            lineHeight: 0.95,
            color: "var(--text-strong)",
            margin: "0 0 10px",
          }}
        >
          Store
        </h1>
      </header>

      {items.length > 0 ? (
        <>
          {data?.blurb && <p className="str-intro">{data.blurb}</p>}
          <div className="str-grid">
            {items.map((item) => {
              const sizes = stockFor(item, live);
              return (
                <article key={item.id} className="str-card">
                  {item.image && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={item.image} alt={item.name} className="str-img" />
                  )}
                  <h2 className="str-name">{item.name}</h2>
                  <div className="str-meta">
                    <span className="str-price">${item.price}</span>
                  </div>
                  {item.detail && <p className="str-detail">{item.detail}</p>}
                  {!open ? (
                    <p className="str-closed">{hours.closedNote}</p>
                  ) : (
                  <OrderForm
                    leagueId={tenantId ?? ""}
                    itemId={item.id}
                    itemName={item.name}
                    price={item.price}
                    stock={sizes}
                  />
                  )}
                </article>
              );
            })}
          </div>
          {/* HOW TO ACTUALLY GET ONE. `note` used to render only in the
              coming-soon state, so the moment real items existed the page
              showed a product, a price and no way to buy it, which is a worse
              dead end than the empty state it replaced. It belongs under the
              grid, and it belongs there whether or not there is a Buy button. */}
          {data?.note && (
            <p className="str-howto">
              {data.note}{" "}
              <Link href="/contact" className="str-howto-link">
                Contact the league »
              </Link>
            </p>
          )}
        </>
      ) : (
        /* TWO DIFFERENT EMPTY STATES.
           A league with no catalogue at all is waiting for its first shirt.
           A league whose shirts have simply run their dates is BETWEEN
           shirts, which is an ordinary Tuesday here now that every design
           carries its own end date. Telling a league that has already sold
           seventy two shirts that "merch is coming" reads like the site has
           forgotten, and the people most likely to see it are the ones
           chasing a shirt they already ordered. */
        <section className="str-soon">
          <h2 className="str-soon-head">
            {allItems.length > 0
              ? "No shirts on sale right now"
              : (data?.headline ?? `${leagueName} merch is coming`)}
          </h2>
          {allItems.length > 0 ? (
            <p className="str-soon-body">
              The last design has finished its run. Anything already ordered is
              still being collected at the field. Sign up for alerts and we will
              tell you when the next shirt goes on sale.
            </p>
          ) : (
            <>
              {data?.blurb && <p className="str-soon-body">{data.blurb}</p>}
              {data?.note && <p className="str-soon-body">{data.note}</p>}
            </>
          )}
          <Link className="str-soon-cta" href="/alerts">
            Get league alerts
          </Link>
        </section>
      )}
    </main>
  );
}
