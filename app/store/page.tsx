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

export const dynamic = "force-dynamic";

export const metadata = { title: "Store" };

interface StoreItem {
  name: string;
  price?: string;
  sizes?: string;
  image?: string;
  url?: string;
}

interface StoreData {
  headline: string;
  blurb: string;
  note?: string;
  buy_url?: string | null;
  items: StoreItem[];
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
    tenantId === "island" ? (merch as StoreData) : null;
  const items = data?.items ?? [];
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
            {items.map((item, i) => {
              const href = item.url ?? data?.buy_url ?? null;
              return (
                <article key={`${item.name}-${i}`} className="str-card">
                  {item.image && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={item.image} alt={item.name} className="str-img" />
                  )}
                  <h2 className="str-name">{item.name}</h2>
                  <div className="str-meta">
                    {item.price && <span className="str-price">{item.price}</span>}
                    {item.sizes && <span className="str-sizes">{item.sizes}</span>}
                  </div>
                  {href && (
                    <a
                      className="str-buy"
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Buy
                    </a>
                  )}
                </article>
              );
            })}
          </div>
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
