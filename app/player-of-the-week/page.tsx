// Public Player of the Week page. Tenant-scoped. Renders the most
// recent honoree as a big spotlight and the rest as a season-grouped
// archive. Manually curated by the commissioner via the admin
// "Player of Week" tab (no auto-from-stats). SFBL also ships a
// baked-in historical archive (lib/sfbl-potw-history) merged below
// any admin Firestore entries — same built-in-fallback model as the
// /fields page, so the history needs no migration script.
//
// The server loads + sorts + sanitizes; the interactive bits
// (click a photo → lightbox with the full write-up) live in the
// PotwClient client component so no sanitizer/data code ships to
// the browser.

import { headers } from "next/headers";
import { getAdminDb } from "@/lib/firebase-admin";
import { sanitizeHtml } from "@/lib/markdown";
import { comparePotwDesc } from "@/lib/potw";
import { PotwClient, type PotwCardItem } from "./PotwClient";
import { SFBL_POTW_HISTORY } from "@/lib/sfbl-potw-history";

export const dynamic = "force-dynamic";

interface PotwEntry {
  id: string;
  player_name: string;
  team_name: string;
  season: string;
  week: number | null;
  week_label: string;
  award_date: string | null;
  stat_line: string;
  blurb: string;
  photo_url: string | null;
  created_at: string | null;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  // Date-only string → render as a stable local calendar day (noon
  // anchor avoids the UTC-midnight day-shift; same trap as audit H1).
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso)
    ? new Date(iso + "T12:00:00")
    : new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

// Baked SFBL history → PotwEntry shape. Only SFBL has a built-in
// archive; other tenants rely solely on their Firestore entries.
function bakedFor(tenantId: string): PotwEntry[] {
  if (tenantId !== "sfbl") return [];
  return SFBL_POTW_HISTORY.map((h) => ({
    id: h.id,
    player_name: h.player_name,
    team_name: h.team_name,
    season: h.season,
    week: h.week,
    week_label: "",
    award_date: null,
    stat_line: "",
    blurb: h.blurb,
    photo_url: h.photo_url,
    created_at: null,
  }));
}

async function loadEntries(tenantId: string): Promise<PotwEntry[]> {
  // Start from the baked-in history (SFBL). Firestore entries the
  // admin adds going forward are merged on top — same `id` overrides
  // its baked counterpart, so the commissioner can correct a
  // historical entry from the admin tab. Same fallback model as the
  // /fields page; if Firestore is unreachable the history still
  // renders.
  const byId = new Map<string, PotwEntry>();
  for (const e of bakedFor(tenantId)) byId.set(e.id, e);
  try {
    const snap = await getAdminDb()
      .collection(`leagues/${tenantId}/player_of_week`)
      .get();
    for (const d of snap.docs) {
      const data = d.data() as Record<string, unknown>;
      const id = String(data.id ?? d.id);
      byId.set(id, {
        id,
        player_name: String(data.player_name ?? ""),
        team_name: String(data.team_name ?? ""),
        season: String(data.season ?? ""),
        week:
          typeof data.week === "number" && Number.isFinite(data.week)
            ? data.week
            : null,
        week_label: String(data.week_label ?? ""),
        award_date: data.award_date ? String(data.award_date) : null,
        stat_line: String(data.stat_line ?? ""),
        blurb: String(data.blurb ?? ""),
        photo_url: data.photo_url ? String(data.photo_url) : null,
        created_at: data.created_at ? String(data.created_at) : null,
      });
    }
  } catch {
    // Keep the baked history even if the Firestore read fails.
  }
  const list = [...byId.values()];
  list.sort(comparePotwDesc);
  return list;
}

export default async function PlayerOfTheWeekPage() {
  const tenantId = headers().get("x-tenant-id");
  if (!tenantId) {
    return (
      <main className="container py-12">
        <p>Visit a tenant subdomain.</p>
      </main>
    );
  }

  // The intro / BEAST award / nomination instructions are
  // SFBL-specific copy (references the SFBL season, the Baseball
  // Beast Award, and playball@sfbl.com). Other tenants don't get it.
  const isSfbl = tenantId === "sfbl";

  const entries = await loadEntries(tenantId);
  const current = entries[0] ?? null;
  const archive = entries.slice(1);

  // Group the archive by season, preserving the already-sorted order
  // (newest season first, week high→low within). Entries without a
  // season fall under an "Earlier" bucket at the end so nothing is
  // dropped.
  const groups: { season: string; items: PotwEntry[] }[] = [];
  for (const e of archive) {
    const key = e.season || "Earlier";
    const last = groups[groups.length - 1];
    if (last && last.season === key) last.items.push(e);
    else groups.push({ season: key, items: [e] });
  }

  // Prep serializable cards for the client lightbox: sanitize the
  // write-up HTML + format the date on the SERVER so no sanitizer or
  // date helper ships to the browser.
  const prep = (e: PotwEntry): PotwCardItem => ({
    id: e.id,
    player_name: e.player_name,
    team_name: e.team_name,
    season: e.season,
    week_label: e.week_label,
    date_label: fmtDate(e.award_date),
    stat_line: e.stat_line,
    blurb_html: e.blurb ? sanitizeHtml(e.blurb) : "",
    photo_url: e.photo_url ?? "",
  });
  const currentCard = current ? prep(current) : null;
  const groupCards = groups.map((g) => ({
    season: g.season,
    items: g.items.map(prep),
  }));

  return (
    <main className="container py-10">
      <header className="mb-6">
        <p
          className="sec-eyebrow"
          style={{ color: "var(--brand-primary)" }}
        >
          League
        </p>
        <h1
          className="font-display"
          style={{
            fontSize: "clamp(40px, 6vw, 64px)",
            lineHeight: 0.95,
            color: "var(--text-strong)",
            margin: 0,
          }}
        >
          Player of the Week
        </h1>
        <p style={{ marginTop: 8, color: "var(--muted)", maxWidth: 680 }}>
          Recognizing standout performances around the league.
        </p>
      </header>

      {isSfbl && (
        <section style={{ maxWidth: 760, marginBottom: 32 }}>
          <p
            style={{
              color: "var(--text-body)",
              fontSize: 15.5,
              lineHeight: 1.65,
              margin: "0 0 14px",
            }}
          >
            This page honors those players who turn in outstanding
            performances during the course of the SFBL season.
            Instructions on how to nominate a player are listed below.
            Team managers and SFBL players are encouraged to nominate
            deserving players each Monday of the season. Please send
            photos and videos of your nominee.
          </p>
          <div
            style={{
              background: "rgba(0,0,0,0.03)",
              border: "1px solid rgba(0,0,0,0.08)",
              borderLeft: "4px solid var(--brand-primary)",
              borderRadius: 12,
              padding: "16px 18px",
            }}
          >
            <p
              style={{
                color: "var(--text-body)",
                fontSize: 15,
                lineHeight: 1.65,
                margin: 0,
              }}
            >
              Every once in a while someone turns in an extraordinary
              performance. So the SFBL created the{" "}
              <strong>“Baseball Beast Award”</strong> for the best
              individual performance of the season as voted by the
              league members at the end of the regular season. The
              SFBL conducts the special poll on Facebook to determine
              the winner, who will earn the BEAST trophy, an authentic
              SFBL logo baseball cap and a permanent spot in the
              history books.
            </p>
          </div>
        </section>
      )}

      {!currentCard && (
        <p
          style={{
            color: "var(--muted)",
            padding: "32px 0",
            fontSize: 15,
          }}
        >
          No Player of the Week has been named yet — check back soon.
        </p>
      )}

      <PotwClient current={currentCard} groups={groupCards} />

      {isSfbl && (
        <section
          style={{
            maxWidth: 760,
            marginTop: 48,
            background: "white",
            border: "1px solid rgba(0,0,0,0.08)",
            borderRadius: 12,
            padding: "clamp(18px, 4vw, 28px)",
          }}
        >
          <h2
            className="font-display"
            style={{
              fontSize: 22,
              color: "var(--text-strong)",
              margin: "0 0 6px",
            }}
          >
            Nominate a Player of the Week
          </h2>
          <p
            style={{
              color: "var(--muted)",
              fontSize: 14,
              margin: "0 0 14px",
            }}
          >
            Team managers and SFBL players — send your nominees each
            Monday of the season.
          </p>
          <ol
            style={{
              margin: 0,
              paddingLeft: 20,
              color: "var(--text-body)",
              fontSize: 15,
              lineHeight: 1.7,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <li>
              Email the league office at{" "}
              <a
                href="mailto:playball@sfbl.com"
                style={{
                  color: "var(--brand-primary)",
                  fontWeight: 700,
                }}
              >
                playball@sfbl.com
              </a>
              .
            </li>
            <li>
              Please include the player’s full name, team name, and his
              stats for the week — along with a photo and, if possible,
              action shots.
            </li>
          </ol>
        </section>
      )}
    </main>
  );
}
