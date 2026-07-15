"use client";

// Roster Check — read-only, league-wide roster view for managers to QA
// other teams' age eligibility (catch a player who's too young for the
// division). Shows every team's players with jersey / name / position /
// DOB / age and a "⚠ UNDER n" flag when a player is below the division
// minimum. Data comes from /api/league-rosters (admin/captain-gated +
// the cross_team_roster_qa flag); email/phone are intentionally NOT here.

import { useEffect, useMemo, useState } from "react";
import { useUser } from "@/lib/auth-client";
import { ageFromDob, divisionMinAge } from "@/lib/age";

interface QAPlayer {
  id: string;
  name: string;
  jersey: string;
  position: string;
  dob: string;
}
interface QATeam {
  id: string;
  name: string;
  division: string;
  players: QAPlayer[];
}

// "2026-07-15" -> "Jul 15, 2026"; anything unparseable passes through.
function fmtDob(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return s || "—";
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function LeagueRostersTab({ leagueId }: { leagueId: string }) {
  const user = useUser();
  const [teams, setTeams] = useState<QATeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [onlyFlagged, setOnlyFlagged] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!user) {
        setLoading(false);
        return;
      }
      try {
        const idToken = await user.getIdToken();
        const res = await fetch(
          `/api/league-rosters?leagueId=${encodeURIComponent(leagueId)}`,
          { headers: { authorization: `Bearer ${idToken}` } },
        );
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          teams?: QATeam[];
          error?: string;
        };
        if (!alive) return;
        if (!res.ok || !data.ok) {
          setError(data.error ?? `HTTP ${res.status}`);
          setLoading(false);
          return;
        }
        setTeams(data.teams ?? []);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Load failed");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [leagueId, user]);

  const view = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return teams
      .map((t) => {
        const minAge = divisionMinAge(t.division);
        const rows = t.players
          .map((p) => {
            const age = ageFromDob(p.dob);
            const underage = minAge != null && age != null && age < minAge;
            return { ...p, age, underage };
          })
          .filter((p) => (onlyFlagged ? p.underage : true));
        return { ...t, minAge, rows };
      })
      .filter((t) => {
        if (onlyFlagged && t.rows.length === 0) return false;
        if (!needle) return true;
        return (
          t.name.toLowerCase().includes(needle) ||
          t.division.toLowerCase().includes(needle) ||
          t.rows.some((p) => p.name.toLowerCase().includes(needle))
        );
      });
  }, [teams, q, onlyFlagged]);

  const flaggedTotal = useMemo(
    () =>
      teams.reduce((sum, t) => {
        const minAge = divisionMinAge(t.division);
        if (minAge == null) return sum;
        return (
          sum +
          t.players.filter((p) => {
            const age = ageFromDob(p.dob);
            return age != null && age < minAge;
          }).length
        );
      }, 0),
    [teams],
  );

  if (loading) return <p className="cap-section-sub">Loading rosters…</p>;
  if (error) return <p className="cap-error-banner">{error}</p>;

  return (
    <div>
      <div className="cap-section-head">
        <h2 className="cap-section-title">Roster Check</h2>
        <p className="cap-section-sub">
          Every team&apos;s roster with date of birth and age, so you can spot a
          player under the division minimum. Read-only — you can&apos;t edit
          another team&apos;s roster.
          {flaggedTotal > 0 ? (
            <>
              {" "}
              <strong>
                {flaggedTotal} player{flaggedTotal === 1 ? "" : "s"} flagged
                under a division minimum.
              </strong>
            </>
          ) : null}
        </p>
      </div>

      <div className="lrq-controls">
        <input
          className="cap-form-input lrq-search"
          type="search"
          placeholder="Search team, division, or player…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <label className="lrq-toggle">
          <input
            type="checkbox"
            checked={onlyFlagged}
            onChange={(e) => setOnlyFlagged(e.target.checked)}
          />
          Only under-age players
        </label>
      </div>

      {view.length === 0 ? (
        <p className="cap-section-sub">No teams match.</p>
      ) : (
        view.map((t) => (
          <section key={t.id} className="lrq-team">
            <h3 className="lrq-team-name">
              {t.name}
              {t.division ? <span className="lrq-div">{t.division}</span> : null}
            </h3>
            <div className="cap-roster-tbl-wrap">
              <table className="cap-roster-tbl">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Name</th>
                    <th>Pos</th>
                    <th>DOB</th>
                    <th>Age</th>
                  </tr>
                </thead>
                <tbody>
                  {t.rows.map((p) => (
                    <tr key={p.id} className={p.underage ? "lrq-flagged" : ""}>
                      <td className="cap-roster-num">{p.jersey || "—"}</td>
                      <td>{p.name || "—"}</td>
                      <td>{p.position || "—"}</td>
                      <td>{p.dob ? fmtDob(p.dob) : "—"}</td>
                      <td>
                        {p.age != null ? p.age : "—"}
                        {p.underage ? (
                          <span
                            className="lrq-badge"
                            title={`Under the ${t.minAge}+ division minimum (age ${p.age})`}
                          >
                            ⚠ UNDER {t.minAge}
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
    </div>
  );
}
