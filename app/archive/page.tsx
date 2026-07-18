// League Archive — the tenant's ORIGINAL website, recovered and preserved.
//
// SFBL's pre-platform site (a WordPress site, and before that a FrontPage
// site going back to the 1990s) was retired when sfbl.com moved to this
// platform, and no backup was kept. Its content — game stories, Player of
// the Week write-ups, franchise histories, championship results and season
// stat leaderboards — was recovered from the Internet Archive and the old
// league server, and lives here so it can't be lost again.
//
// Data: `public/{tenantId}/old-site-archive.json` — a flat array of pages
// ({s}lug, {t}itle, {d}ate, {c}ategory, tea{m}s, {b}ody, {u}rl). It's served
// as a static asset and fetched by the client rather than shipped in the
// render payload: at ~1.3MB (~300KB gzipped) it would dominate the initial
// HTML for a page most visitors only browse occasionally. Tenants without
// the file render an empty state.

import type { Metadata } from "next";
import { headers } from "next/headers";
import { ArchiveView } from "./ArchiveView";
import "./archive.css";

export const metadata: Metadata = {
  title: "Archive",
  description:
    "The league's original website, recovered — game stories, Players of the Week, team histories, championship results and season stat leaderboards.",
};

export default function ArchivePage() {
  const tenantId = headers().get("x-tenant-id");
  if (!tenantId) {
    return (
      <main className="container py-12">
        <p>Visit a tenant subdomain.</p>
      </main>
    );
  }

  return (
    <main className="arc-shell">
      <header className="arc-header">
        <h1 className="arc-title">League Archive</h1>
        <p className="arc-sub">
          The league&apos;s original website, preserved. Game stories, Players
          of the Week, franchise histories, championship results and season stat
          leaderboards &mdash; recovered from the Internet Archive and the
          original league server. Search anything below.
        </p>
      </header>
      <ArchiveView tenantId={tenantId} />
    </main>
  );
}
