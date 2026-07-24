// Power Rankings. Two modes, chosen by tenant config:
//
//  1. EMBEDDED (config.power_rankings.embed_base set). The league's rankings
//     are produced by an outside provider that publishes an iframe. COYBL is
//     this case: EvenField, a Columbus startup, computes weekly RPI per age
//     group and serves it at
//       https://evenfield.netlify.app/embed/standings?state=OH&ageGroup=10U&league=oh-coybl
//     They send no X-Frame-Options and no CSP frame-ancestors, so it embeds.
//     There is nothing for the provider to "enter" on our side: they update
//     their app, the embed follows.
//
//     This mode exists because the computed path below was actively WRONG for
//     COYBL. It ranked from games on the platform and published numbers that
//     contradicted the rankings the league actually recognises. Two different
//     official-looking rankings is worse than one.
//
//  2. COMPUTED (no embed configured). RPI per age group from game results
//     (lib/rpi) - the "own your rankings" path, no external service.
//
// Gated either way by flags.show_power_rankings.

import { headers } from "next/headers";
import Link from "next/link";
import { getAdminDb } from "@/lib/firebase-admin";
import { computeRpi, type RpiGame, type RpiRow } from "@/lib/rpi";

export const dynamic = "force-dynamic";

/** Outside-provider rankings embed, from tenant config. */
interface PowerRankingsEmbed {
  /** Base URL of the provider's iframe endpoint. */
  embed_base?: string;
  /** Extra fixed query params (e.g. { state: "OH", league: "oh-coybl" }). */
  params?: Record<string, string>;
  /** Query-param name carrying the age group. Defaults to "ageGroup". */
  age_param?: string;
  /** Age groups to offer as tabs, in order. */
  ages?: string[];
  /** Per-age iframe height in px. The provider gives us no postMessage to
   *  auto-size against, so heights are configured and may drift as rosters
   *  change; a value here is a starting point, not a guarantee. */
  heights?: Record<string, number>;
  /** Attribution line shown under the frame. */
  credit?: string;
  /** Where to send someone whose browser blocks the frame. */
  fallback_url?: string;
}

interface TeamMeta {
  name: string;
  abbrev?: string;
  color?: string;
  ageGroup?: string;
}

type RankedRow = RpiRow & { name: string };

interface AgeRanking {
  ageGroup: string;
  rows: RankedRow[];
}

export default async function PowerRankingsPage({
  searchParams,
}: {
  searchParams?: { age?: string };
}) {
  const h = headers();
  const tenantId = h.get("x-tenant-id");

  if (!tenantId) {
    return (
      <main className="container py-12">
        <p>Visit a tenant subdomain.</p>
      </main>
    );
  }

  const embed = (() => {
    const raw = h.get("x-tenant-config-json");
    if (!raw) return null;
    try {
      const cfg = JSON.parse(raw) as {
        power_rankings?: PowerRankingsEmbed;
      };
      const pr = cfg.power_rankings;
      return pr?.embed_base ? pr : null;
    } catch {
      return null;
    }
  })();

  if (embed) {
    return <EmbeddedRankings embed={embed} selected={searchParams?.age} />;
  }

  const { sections } = await loadRankings(tenantId);

  return (
    <main className="container py-10">
      <header style={{ marginBottom: 18 }}>
        <p className="sec-eyebrow" style={{ color: "var(--brand-primary)" }}>
          Strength of Schedule
        </p>
        <h1
          className="font-display"
          style={{
            fontSize: "clamp(34px, 5vw, 52px)",
            lineHeight: 0.97,
            color: "var(--text-strong)",
            margin: 0,
          }}
        >
          Power Rankings
        </h1>
        <p style={{ marginTop: 10, color: "var(--muted)", fontSize: 14, lineHeight: 1.55, maxWidth: 660 }}>
          Ranked by <strong>RPI</strong> (Ratings Percentage Index), which
          rewards <strong>who you beat</strong>, not just how many: 25% your
          win&nbsp;%, 50% your opponents&rsquo; win&nbsp;%, 25% your
          opponents&rsquo; opponents&rsquo; win&nbsp;%. A team with a tough
          schedule can outrank a team with a flashier record.
        </p>
      </header>

      {sections.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>No ranked games yet.</p>
      ) : (
        <>
          {sections.length > 1 && (
            <nav style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 22 }}>
              {sections.map((s) => (
                <a
                  key={s.ageGroup}
                  href={`#age-${s.ageGroup}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    minHeight: 44,
                    boxSizing: "border-box",
                    padding: "6px 14px",
                    borderRadius: 999,
                    border: "1px solid var(--border)",
                    background: "var(--card)",
                    color: "var(--brand-primary)",
                    fontWeight: 800,
                    fontSize: 13,
                    textDecoration: "none",
                  }}
                >
                  {s.ageGroup}
                </a>
              ))}
            </nav>
          )}

          {sections.map((s) => (
            <section
              key={s.ageGroup}
              id={`age-${s.ageGroup}`}
              style={{ marginBottom: 32, scrollMarginTop: 16 }}
            >
              <h2
                className="font-display"
                style={{
                  fontSize: 28,
                  marginBottom: 12,
                  color: "var(--brand-primary)",
                  borderBottom: "3px solid var(--brand-primary)",
                  paddingBottom: 6,
                }}
              >
                {s.ageGroup}
              </h2>
              <div className="overflow-x-auto">
                <table className="s-tbl">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th className="text-left">Team</th>
                      <th>Record</th>
                      <th title="Opponents' winning percentage">Str. of Sched.</th>
                      <th title="Ratings Percentage Index">Rating</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.rows.map((r, i) => (
                      <tr key={r.team_id}>
                        <td>{i + 1}</td>
                        <td className="text-left" style={{ fontWeight: 700 }}>
                          {r.name}
                        </td>
                        <td>
                          {r.w}-{r.l}
                          {r.t ? `-${r.t}` : ""}
                        </td>
                        <td style={{ color: "var(--muted)" }}>
                          {Math.round(r.owp * 100)}%
                        </td>
                        <td style={{ fontWeight: 800, color: "var(--brand-primary)" }}>
                          {r.rpi.toFixed(3)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </>
      )}
    </main>
  );
}

/**
 * Rankings published by an outside provider, shown one age group at a time.
 *
 * One frame, not eight. The old SportsEngine page stacked all eight age
 * groups as simultaneous iframes; each one is a full app with its own bundle,
 * so that page paid eight times the cost to show the one table a visitor
 * actually wanted. Tabs are plain links (?age=), so this stays a server
 * component and works with JavaScript disabled.
 */
function EmbeddedRankings({
  embed,
  selected,
}: {
  embed: PowerRankingsEmbed;
  selected?: string;
}) {
  const ages = embed.ages?.length ? embed.ages : [];
  const active =
    selected && ages.includes(selected) ? selected : (ages[0] ?? "");

  const src = (() => {
    const qs = new URLSearchParams(embed.params ?? {});
    if (active) qs.set(embed.age_param || "ageGroup", active);
    return `${embed.embed_base}?${qs.toString()}`;
  })();

  const height = embed.heights?.[active] ?? 1600;

  return (
    <main className="container py-10">
      <header style={{ marginBottom: 14 }}>
        <p className="sec-eyebrow" style={{ color: "var(--brand-primary)" }}>
          Strength of Schedule
        </p>
        <h1
          className="font-display"
          style={{
            fontSize: "clamp(34px, 5vw, 52px)",
            lineHeight: 0.97,
            color: "var(--text-strong)",
            margin: 0,
          }}
        >
          Power Rankings
        </h1>
        <p
          style={{
            marginTop: 10,
            color: "var(--muted)",
            fontSize: 14,
            lineHeight: 1.55,
            maxWidth: 660,
          }}
        >
          Ranked by <strong>RPI</strong> (Ratings Percentage Index), which
          rewards <strong>who you play</strong>, not just how many you beat:
          25% your win&nbsp;%, 50% your opponents&rsquo; win&nbsp;%, 25% your
          opponents&rsquo; opponents&rsquo; win&nbsp;%. A team with a tough
          schedule can outrank a team with a flashier record. Looking for a
          good game? Teams within three or four spots of you are your best
          matchups.
        </p>
      </header>

      {ages.length > 1 && (
        <div
          role="tablist"
          aria-label="Age group"
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            marginBottom: 14,
          }}
        >
          {ages.map((a) => {
            const on = a === active;
            return (
              <Link
                key={a}
                href={`/power-rankings?age=${encodeURIComponent(a)}`}
                role="tab"
                aria-selected={on}
                style={{
                  padding: "7px 15px",
                  borderRadius: 999,
                  fontWeight: 800,
                  fontSize: 14,
                  textDecoration: "none",
                  border: "1px solid var(--border)",
                  background: on ? "var(--brand-primary)" : "#fff",
                  color: on ? "#fff" : "var(--text-strong)",
                }}
              >
                {a}
              </Link>
            );
          })}
        </div>
      )}

      <iframe
        key={active}
        src={src}
        title={`${active} Power Rankings`}
        loading="lazy"
        style={{
          width: "100%",
          height,
          display: "block",
          border: "1px solid var(--border)",
          borderRadius: 10,
          background: "#fff",
        }}
      />

      <p style={{ marginTop: 10, fontSize: 13, color: "var(--muted)" }}>
        {embed.credit ? `${embed.credit}. ` : ""}
        {embed.fallback_url ? (
          <>
            Not loading? View the rankings directly at{" "}
            <a
              href={embed.fallback_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--brand-primary)" }}
            >
              the source
            </a>
            .
          </>
        ) : null}
      </p>
    </main>
  );
}

async function loadRankings(tenantId: string): Promise<{ sections: AgeRanking[] }> {
  const db = getAdminDb();
  const [gamesSnap, teamsSnap] = await Promise.all([
    db.collection(`leagues/${tenantId}/games`).get(),
    db.collection(`leagues/${tenantId}/teams`).get(),
  ]);

  const teams: Record<string, TeamMeta> = {};
  for (const d of teamsSnap.docs) {
    const data = d.data();
    teams[d.id] = {
      name: String(data.name ?? d.id),
      abbrev: data.abbrev ? String(data.abbrev) : undefined,
      color: data.color ? String(data.color) : undefined,
      ageGroup: data.ageGroup ? String(data.ageGroup) : undefined,
    };
  }

  const games: RpiGame[] = gamesSnap.docs.map((d) => {
    const data = d.data();
    return {
      home_team_id: String(data.home_team_id ?? ""),
      away_team_id: String(data.away_team_id ?? ""),
      home_score: Number(data.home_score ?? 0),
      away_score: Number(data.away_score ?? 0),
      status: String(data.status ?? "draft"),
    };
  });

  const ages = new Set<string>();
  for (const t of Object.values(teams)) if (t.ageGroup) ages.add(t.ageGroup);

  const sections: AgeRanking[] = [...ages]
    .sort((a, b) => ageOrder(a) - ageOrder(b))
    .map((ageGroup) => {
      const idSet = new Set(
        Object.entries(teams)
          .filter(([, t]) => t.ageGroup === ageGroup)
          .map(([id]) => id),
      );
      const groupGames = games.filter(
        (g) => idSet.has(g.home_team_id) && idSet.has(g.away_team_id),
      );
      const rows = computeRpi(groupGames)
        .filter((r) => idSet.has(r.team_id))
        .map((r) => ({ ...r, name: teams[r.team_id]?.name ?? r.team_id }));
      return { ageGroup, rows };
    })
    .filter((s) => s.rows.length > 0);

  return { sections };
}

function ageOrder(ageGroup: string): number {
  const m = ageGroup.match(/\d+/);
  return m ? parseInt(m[0], 10) : 999;
}
