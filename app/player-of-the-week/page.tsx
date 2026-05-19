// Public Player of the Week page. Tenant-scoped: reads
// /leagues/<id>/player_of_week, renders the most recent entry (by
// award_date, then created_at) as the big spotlight and the rest as
// a dated archive. Manually curated by the commissioner via the
// admin "Player of Week" tab (no auto-from-stats). Mirrors the
// server-component + sanitizeHtml pattern used by /fields.

import { headers } from "next/headers";
import { getAdminDb } from "@/lib/firebase-admin";
import { sanitizeHtml } from "@/lib/markdown";
import { comparePotwDesc } from "@/lib/potw";

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

async function loadEntries(tenantId: string): Promise<PotwEntry[]> {
  try {
    const snap = await getAdminDb()
      .collection(`leagues/${tenantId}/player_of_week`)
      .get();
    const list: PotwEntry[] = snap.docs.map((d) => {
      const data = d.data() as Record<string, unknown>;
      return {
        id: String(data.id ?? d.id),
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
      };
    });
    list.sort(comparePotwDesc);
    return list;
  } catch {
    return [];
  }
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
        <p
          style={{ marginTop: 8, color: "var(--muted)", maxWidth: 680 }}
        >
          Recognizing standout performances around the league.
        </p>
      </header>

      {!current && (
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

      {current && (
        <section
          style={{
            background: "white",
            border: "1px solid rgba(0,0,0,0.08)",
            borderTop: "5px solid var(--brand-primary)",
            borderRadius: 16,
            padding: "clamp(20px, 4vw, 36px)",
            display: "flex",
            gap: "clamp(16px, 4vw, 32px)",
            flexWrap: "wrap",
            alignItems: "flex-start",
          }}
        >
          {current.photo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={current.photo_url}
              alt={current.player_name}
              style={{
                width: "min(240px, 40vw)",
                height: "min(240px, 40vw)",
                objectFit: "cover",
                borderRadius: 14,
                flexShrink: 0,
                background: "rgba(0,0,0,0.04)",
              }}
            />
          )}
          <div style={{ flex: "1 1 280px", minWidth: 0 }}>
            <p
              className="sec-eyebrow"
              style={{
                color: "var(--brand-primary)",
                margin: 0,
              }}
            >
              {current.week_label
                ? current.week_label
                : "This Week"}
            </p>
            <h2
              className="font-display"
              style={{
                fontSize: "clamp(28px, 5vw, 44px)",
                lineHeight: 1.0,
                color: "var(--text-strong)",
                margin: "6px 0 0",
              }}
            >
              {current.player_name}
            </h2>
            {current.team_name && (
              <p
                style={{
                  margin: "6px 0 0",
                  color: "var(--muted)",
                  fontSize: 16,
                  fontWeight: 600,
                }}
              >
                {current.team_name}
              </p>
            )}
            {current.stat_line && (
              <p
                style={{
                  margin: "12px 0 0",
                  fontSize: 17,
                  fontWeight: 700,
                  color: "var(--brand-primary)",
                }}
              >
                {current.stat_line}
              </p>
            )}
            {current.blurb && (
              <div
                className="prose"
                style={{
                  marginTop: 14,
                  color: "var(--text-body)",
                  fontSize: 15,
                  lineHeight: 1.6,
                  maxWidth: 640,
                }}
                dangerouslySetInnerHTML={{
                  __html: sanitizeHtml(current.blurb),
                }}
              />
            )}
            {current.award_date && (
              <p
                style={{
                  marginTop: 14,
                  fontSize: 13,
                  color: "var(--muted)",
                }}
              >
                {fmtDate(current.award_date)}
              </p>
            )}
          </div>
        </section>
      )}

      {groups.length > 0 && (
        <section style={{ marginTop: 40 }}>
          <h2
            className="font-display"
            style={{
              fontSize: 22,
              color: "var(--text-strong)",
              margin: "0 0 18px",
            }}
          >
            Past honorees
          </h2>
          {groups.map((g) => (
            <div key={g.season} style={{ marginBottom: 28 }}>
              <h3
                className="sec-eyebrow"
                style={{
                  color: "var(--brand-primary)",
                  margin: "0 0 10px",
                }}
              >
                {g.season}
              </h3>
              <ul
                style={{
                  listStyle: "none",
                  padding: 0,
                  margin: 0,
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fill, minmax(280px, 1fr))",
                  gap: 14,
                }}
              >
                {g.items.map((e) => (
              <li
                key={e.id}
                style={{
                  background: "white",
                  border: "1px solid rgba(0,0,0,0.08)",
                  borderLeft: "4px solid var(--brand-primary)",
                  borderRadius: 12,
                  padding: "14px 16px",
                  display: "flex",
                  gap: 12,
                  alignItems: "flex-start",
                }}
              >
                {e.photo_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={e.photo_url}
                    alt={e.player_name}
                    style={{
                      width: 56,
                      height: 56,
                      objectFit: "cover",
                      borderRadius: 8,
                      flexShrink: 0,
                      background: "rgba(0,0,0,0.04)",
                    }}
                  />
                )}
                <div style={{ minWidth: 0 }}>
                  {(e.week_label || e.award_date) && (
                    <p
                      style={{
                        margin: 0,
                        fontSize: 12,
                        color: "var(--muted)",
                        fontWeight: 600,
                      }}
                    >
                      {e.week_label || fmtDate(e.award_date)}
                    </p>
                  )}
                  <h3
                    className="font-display"
                    style={{
                      margin: "2px 0 0",
                      fontSize: 18,
                      color: "var(--text-strong)",
                    }}
                  >
                    {e.player_name}
                  </h3>
                  {e.team_name && (
                    <p
                      style={{
                        margin: "2px 0 0",
                        fontSize: 13,
                        color: "var(--muted)",
                      }}
                    >
                      {e.team_name}
                    </p>
                  )}
                  {e.stat_line && (
                    <p
                      style={{
                        margin: "6px 0 0",
                        fontSize: 13,
                        fontWeight: 600,
                        color: "var(--text-body)",
                      }}
                    >
                      {e.stat_line}
                    </p>
                  )}
                </div>
              </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
