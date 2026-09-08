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
  const items = data?.items ?? [];

  // Live stock, plus where to send Venmo and Zelle. Mike asked for the handles
  // on the FORM (2026-09-07), not only on the confirmation, so they come down
  // with the page again. His call: it is his number and his business.
  const [stockDoc, payDoc, hoursDoc] = items.length
    ? await Promise.all([
        getAdminDb().doc(`leagues/${tenantId}/site_config/merch_stock`).get(),
        getAdminDb().doc(`leagues/${tenantId}/site_config/merch_pay`).get(),
        getAdminDb().doc(`leagues/${tenantId}/site_config/merch_hours`).get(),
      ]).catch(() => [null, null, null] as const)
    : ([null, null, null] as const);
  const live = (stockDoc?.data() ?? null) as Record<string, unknown> | null;
  const pay = (payDoc?.data() ?? {}) as { venmo?: string; zelle?: string };
  // Ordering pauses between Thursday 4pm and Saturday morning while the
  // week's shirts are sorted. The stock and the prices still show: a shopper
  // should see what they will be able to buy, and when.
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
                    {...(pay.venmo ? { venmo: pay.venmo } : {})}
                    {...(pay.zelle ? { zelle: pay.zelle } : {})}
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
        <section className="str-soon">
          <h2 className="str-soon-head">
            {data?.headline ?? `${leagueName} merch is coming`}
          </h2>
          {data?.blurb && <p className="str-soon-body">{data.blurb}</p>}
          {data?.note && <p className="str-soon-body">{data.note}</p>}
          <Link className="str-soon-cta" href="/alerts">
            Get league alerts
          </Link>
        </section>
      )}
    </main>
  );
}
