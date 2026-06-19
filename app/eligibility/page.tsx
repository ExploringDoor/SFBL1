// Pitcher eligibility tracker (USA Baseball Pitch Smart). For each team
// whose age group has a pitch-count ruleset, shows every pitcher's current
// status, next eligible date, last outing, and pitch count — computed from
// the seeded outings via lib/pitchcount. Read-only public view; coach entry
// (the write side) is a separate captain-portal feature.

import { headers } from "next/headers";
import { getAdminDb } from "@/lib/firebase-admin";
import { computeEligibility } from "@/lib/pitchcount/eligibility";
import { PITCH_RULESETS, rulesetIdForAge } from "@/lib/pitchcount/rulesets";
import type { PitchCountRuleset, PitchOuting } from "@/lib/pitchcount/types";

export const dynamic = "force-dynamic";

interface TeamRow {
  id: string;
  name: string;
  ageGroup?: string;
}

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

  return (
    <main className="container py-10">
      <header className="mb-6">
        <h1 className="font-display" style={{ fontSize: "clamp(36px, 5vw, 56px)" }}>
          <span style={{ color: "var(--text-strong)" }}>Pitcher</span>{" "}
          <span style={{ color: "var(--brand-primary)" }}>Eligibility</span>
        </h1>
        <p className="sec-eyebrow mt-1">
          Pitch Smart rest tracking · as of{" "}
          {now.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </p>
      </header>

      {sections.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>
          No pitch counts recorded yet. Coaches enter pitch counts after each
          game.
        </p>
      ) : (
        <div style={{ display: "grid", gap: 28 }}>
          {sections.map(({ team, ruleset, rows }) => (
            <section
              key={team.id}
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
                <h2
                  className="font-display"
                  style={{ fontSize: 22, color: "var(--brand-primary)" }}
                >
                  {team.name}
                </h2>
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
          ))}
        </div>
      )}
    </main>
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
