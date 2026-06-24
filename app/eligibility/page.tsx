// Pitcher eligibility tracker (USA Baseball Pitch Smart). For each team
// whose age group has a pitch-count ruleset, shows every pitcher's current
// status, next eligible date, last outing, and pitch count — computed from
// the seeded outings via lib/pitchcount. Read-only public view; coach entry
// (the write side) is a separate captain-portal feature.

import { headers } from "next/headers";
import { getAdminDb } from "@/lib/firebase-admin";
import { computeEligibility } from "@/lib/pitchcount/eligibility";
import {
  PITCH_RULESETS,
  COYBL_9U_10U,
  rulesetIdForAge,
} from "@/lib/pitchcount/rulesets";
import type { PitchCountRuleset, PitchOuting } from "@/lib/pitchcount/types";

export const dynamic = "force-dynamic";

interface TeamRow {
  id: string;
  name: string;
  ageGroup?: string;
}

type EligRow = { name: string } & ReturnType<typeof computeEligibility>;

export default async function EligibilityPage() {
  const tenantId = headers().get("x-tenant-id");
  if (!tenantId) {
    return (
      <main className="container py-12">
        <p>Visit a tenant subdomain.</p>
      </main>
    );
  }

  const db = getAdminDb();
  const [teamsSnap, outingsSnap] = await Promise.all([
    db.collection(`leagues/${tenantId}/teams`).get(),
    db.collection(`leagues/${tenantId}/pitch_outings`).get(),
  ]);

  const teams: TeamRow[] = teamsSnap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      name: String(data.name ?? d.id),
      ageGroup: data.ageGroup ? String(data.ageGroup) : undefined,
    };
  });

  // Group outings by team → player.
  const byTeamPlayer = new Map<string, Map<string, PitchOuting[]>>();
  for (const d of outingsSnap.docs) {
    const data = d.data();
    const teamId = String(data.team_id ?? "");
    const player = String(data.player_name ?? "");
    const date = String(data.date ?? "");
    const pitches = Number(data.pitches ?? 0);
    if (!teamId || !player || !date) continue;
    if (!byTeamPlayer.has(teamId)) byTeamPlayer.set(teamId, new Map());
    const pm = byTeamPlayer.get(teamId)!;
    if (!pm.has(player)) pm.set(player, []);
    pm.get(player)!.push({ date, pitches });
  }

  // Local calendar date (NOT UTC) — an evening check must not roll "today"
  // forward and mark a resting pitcher eligible early. TODO: use the
  // league's configured timezone once that lands in config.
  const now = new Date();
  const today = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const todayLabel = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const sections = teams
    .map((t) => {
      const rid = t.ageGroup ? rulesetIdForAge(t.ageGroup) : null;
      const ruleset = rid ? PITCH_RULESETS[rid] : null;
      const players = byTeamPlayer.get(t.id);
      if (!ruleset || !players) return null;
      const rows = [...players.entries()]
        .map(([name, outings]) => ({ name, ...computeEligibility(outings, ruleset, today) }))
        .sort((a, b) => {
          if (a.status !== b.status) return a.status === "resting" ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      return { team: t, ruleset, rows };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  // Group the team cards by age group (with a jump-nav) so the page reads
  // like /standings for a multi-age league.
  const ageList = [...new Set(sections.map((s) => s.team.ageGroup ?? "Other"))].sort(
    (a, b) => (parseInt(a, 10) || 999) - (parseInt(b, 10) || 999),
  );

  return (
    <main className="container py-10">
      <header style={{ marginBottom: 18 }}>
        <p className="sec-eyebrow" style={{ color: "var(--brand-primary)" }}>
          Pitch Smart
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
          Pitcher Eligibility
        </h1>
        <p style={{ marginTop: 10, color: "var(--muted)", maxWidth: 700, lineHeight: 1.5 }}>
          Who can pitch today, by team — based on USA Baseball{" "}
          <strong>Pitch Smart</strong> pitch-count limits to protect young arms.
          Updated after each game; current as of {todayLabel}.
        </p>
      </header>

      <RestRules />

      {sections.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>
          No pitch counts recorded yet. Coaches enter each pitcher&rsquo;s count
          after every game, and eligibility updates here automatically.
        </p>
      ) : (
        <>
          {ageList.length > 1 && (
            <nav
              aria-label="Jump to age group"
              style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 22 }}
            >
              {ageList.map((ag) => (
                <a
                  key={ag}
                  href={`#age-${ag}`}
                  style={{
                    display: "inline-block",
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
                  {ag}
                </a>
              ))}
            </nav>
          )}
          {ageList.map((ag) => (
            <div
              key={ag}
              id={`age-${ag}`}
              style={{ marginBottom: 30, scrollMarginTop: 16 }}
            >
              {ageList.length > 1 && (
                <h2
                  className="font-barlow"
                  style={{
                    fontSize: 24,
                    fontWeight: 900,
                    textTransform: "uppercase",
                    color: "var(--brand-primary)",
                    borderBottom: "3px solid var(--brand-primary)",
                    paddingBottom: 6,
                    marginBottom: 14,
                  }}
                >
                  {ag}
                </h2>
              )}
              <div style={{ display: "grid", gap: 20 }}>
                {sections
                  .filter((s) => (s.team.ageGroup ?? "Other") === ag)
                  .map((s) => (
                    <TeamPitchSection key={s.team.id} section={s} />
                  ))}
              </div>
            </div>
          ))}
        </>
      )}
    </main>
  );
}

function TeamPitchSection({
  section,
}: {
  section: { team: TeamRow; ruleset: PitchCountRuleset; rows: EligRow[] };
}) {
  const { team, ruleset, rows } = section;
  return (
    <section
      style={{
        border: "1px solid var(--border)",
        borderRadius: 12,
        overflow: "hidden",
        background: "var(--card)",
      }}
    >
      <div
        style={{
          padding: "14px 18px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "baseline",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <h3
          className="font-display"
          style={{ fontSize: 22, color: "var(--brand-primary)", margin: 0 }}
        >
          {team.name}
        </h3>
        {team.ageGroup && (
          <span style={{ color: "var(--muted)", fontSize: 13, fontWeight: 700 }}>
            {team.ageGroup}
          </span>
        )}
        <span style={{ marginLeft: "auto", color: "var(--muted)", fontSize: 12 }}>
          {ruleSummary(ruleset)}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="s-tbl">
          <thead>
            <tr>
              <th className="text-left">Pitcher</th>
              <th className="text-left">Status</th>
              <th>Next Eligible</th>
              <th>Last Outing</th>
              <th>Pitches</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td className="text-left" style={{ fontWeight: 700 }}>
                  {r.name}
                </td>
                <td className="text-left">
                  <StatusBadge status={r.status} />
                </td>
                <td>{r.status === "eligible" ? "—" : fmtDate(r.nextEligibleDate)}</td>
                <td>{r.lastOuting ? fmtDate(r.lastOuting.date) : "—"}</td>
                <td>{r.lastOuting ? r.pitchesLast : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// Plain-English "how rest works" explainer for parents — rendered from
// the rulesets (not hardcoded) so it can't drift from the engine. All
// COYBL kid-pitch ages share the same rest tiers; only the daily max
// differs by age.
function RestRules() {
  const tiers = COYBL_9U_10U.tiers;
  const maxes = Object.values(PITCH_RULESETS);
  const rangeLabel = (min: number, max: number) =>
    max === Infinity ? `${min}+` : `${min}–${max}`;
  const restLabel = (d: number) =>
    d === 0 ? "can pitch the next day" : `${d} day${d > 1 ? "s" : ""} of rest`;
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 12,
        background: "var(--card)",
        padding: "16px 18px",
        marginBottom: 26,
      }}
    >
      <strong
        style={{
          display: "block",
          fontSize: 14,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: "var(--brand-primary)",
          marginBottom: 8,
        }}
      >
        How rest works
      </strong>
      <p style={{ margin: "0 0 10px", fontSize: 14, color: "var(--text-strong)", lineHeight: 1.5 }}>
        A pitcher&rsquo;s required days off depend on how many pitches they
        threw in their last outing:
      </p>
      <ul
        style={{
          margin: "0 0 12px",
          padding: 0,
          listStyle: "none",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
          gap: "4px 18px",
        }}
      >
        {tiers.map((t) => (
          <li key={t.min} style={{ fontSize: 13.5, color: "var(--text-strong)" }}>
            <strong>{rangeLabel(t.min, t.max)} pitches</strong> ·{" "}
            <span style={{ color: "var(--muted)" }}>{restLabel(t.restDays)}</span>
          </li>
        ))}
      </ul>
      <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
        Daily maximum by age group:{" "}
        {maxes.map((m) => `${m.label} ${m.dailyMax}`).join(" · ")}. (7U–8U is
        coach-pitch — no pitch-count limits.)
      </p>
    </div>
  );
}

function StatusBadge({ status }: { status: "eligible" | "resting" }) {
  const eligible = status === "eligible";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "3px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 800,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        color: eligible ? "#0a7d3c" : "#b45309",
        background: eligible ? "rgba(10,125,60,0.12)" : "rgba(180,83,9,0.12)",
      }}
    >
      {eligible ? "Eligible" : "Resting"}
    </span>
  );
}

function ruleSummary(r: PitchCountRuleset): string {
  return `${r.label} · daily max ${r.dailyMax}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
