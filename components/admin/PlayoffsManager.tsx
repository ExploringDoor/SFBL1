"use client";

// Admin Playoffs manager. Builds the bracket structure that the
// public /playoffs page renders.
//
// Workflow:
//   1. Toggle "Active" once the bracket is ready to publish.
//   2. Set title (e.g. "2026 Spring Playoffs").
//   3. Add divisions (18+, 28+, 35+) and per-division rounds
//      ("Quarterfinals", "Semifinals", "Final").
//   4. In each round, add matches: pick away/home teams + seeds,
//      optionally link a /games/{id} doc + score + winner.
//
// V0 simplifications:
//   - Admin defines the full structure manually. Auto-seeding from
//     the standings table is a v1.5.
//   - Match advancement (winner of M1 → next round) is admin-
//     editable, not auto-computed. Admin updates winner_team_id
//     after each game; the next round picks it up via the team_id
//     they enter.

import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { getDb } from "@/lib/firebase";

interface TeamLite {
  id: string;
  name: string;
  division: string;
}

interface Match {
  id: string;
  away_team_id: string | null;
  away_seed: number | null;
  home_team_id: string | null;
  home_seed: number | null;
  game_id: string | null;
  away_score: number | null;
  home_score: number | null;
  winner_team_id: string | null;
  status: "scheduled" | "live" | "final";
}

interface Round {
  label: string;
  matches: Match[];
}

interface Division {
  label: string;
  rounds: Round[];
}

interface Bracket {
  active: boolean;
  title: string;
  divisions: Division[];
}

interface Props {
  leagueId: string;
  user: User;
}

const DEFAULT_BRACKET: Bracket = {
  active: false,
  title: "Playoffs",
  divisions: [],
};

export function PlayoffsManager({ leagueId, user }: Props) {
  const [bracket, setBracket] = useState<Bracket>(DEFAULT_BRACKET);
  const [teams, setTeams] = useState<TeamLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const db = getDb();
      const [bracketSnap, teamSnap] = await Promise.all([
        getDoc(doc(db, `leagues/${leagueId}/site_config/playoffs`)),
        getDocs(collection(db, `leagues/${leagueId}/teams`)),
      ]);
      if (cancelled) return;
      if (bracketSnap.exists()) {
        const d = bracketSnap.data();
        setBracket({
          active: d.active === true,
          title: String(d.title ?? "Playoffs"),
          divisions: Array.isArray(d.divisions)
            ? (d.divisions as Division[])
            : [],
        });
      }
      setTeams(
        teamSnap.docs
          .map((d) => ({
            id: d.id,
            name: String(d.data().name ?? d.id),
            division: String(d.data().division ?? ""),
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  const teamsByDivision = useMemo(() => {
    const m = new Map<string, TeamLite[]>();
    for (const t of teams) {
      const k = t.division || "—";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(t);
    }
    return m;
  }, [teams]);

  function update(patch: Partial<Bracket>) {
    setBracket((cur) => ({ ...cur, ...patch }));
  }

  function updateDivision(di: number, patch: Partial<Division>) {
    setBracket((cur) => ({
      ...cur,
      divisions: cur.divisions.map((d, i) =>
        i === di ? { ...d, ...patch } : d,
      ),
    }));
  }

  function addDivision() {
    setBracket((cur) => ({
      ...cur,
      divisions: [
        ...cur.divisions,
        { label: "", rounds: [{ label: "Round 1", matches: [] }] },
      ],
    }));
  }

  function removeDivision(di: number) {
    if (
      !window.confirm(
        `Remove division "${bracket.divisions[di]?.label || di + 1}" from the bracket?`,
      )
    )
      return;
    setBracket((cur) => ({
      ...cur,
      divisions: cur.divisions.filter((_, i) => i !== di),
    }));
  }

  function updateRound(di: number, ri: number, patch: Partial<Round>) {
    setBracket((cur) => ({
      ...cur,
      divisions: cur.divisions.map((d, i) =>
        i !== di
          ? d
          : {
              ...d,
              rounds: d.rounds.map((r, j) =>
                j === ri ? { ...r, ...patch } : r,
              ),
            },
      ),
    }));
  }

  function addRound(di: number) {
    setBracket((cur) => ({
      ...cur,
      divisions: cur.divisions.map((d, i) =>
        i !== di
          ? d
          : {
              ...d,
              rounds: [
                ...d.rounds,
                {
                  label: `Round ${d.rounds.length + 1}`,
                  matches: [],
                },
              ],
            },
      ),
    }));
  }

  function removeRound(di: number, ri: number) {
    if (
      !window.confirm(
        `Remove round "${bracket.divisions[di]?.rounds[ri]?.label || ri + 1}"?`,
      )
    )
      return;
    setBracket((cur) => ({
      ...cur,
      divisions: cur.divisions.map((d, i) =>
        i !== di
          ? d
          : { ...d, rounds: d.rounds.filter((_, j) => j !== ri) },
      ),
    }));
  }

  function updateMatch(
    di: number,
    ri: number,
    mi: number,
    patch: Partial<Match>,
  ) {
    setBracket((cur) => ({
      ...cur,
      divisions: cur.divisions.map((d, i) =>
        i !== di
          ? d
          : {
              ...d,
              rounds: d.rounds.map((r, j) =>
                j !== ri
                  ? r
                  : {
                      ...r,
                      matches: r.matches.map((m, k) =>
                        k === mi ? { ...m, ...patch } : m,
                      ),
                    },
              ),
            },
      ),
    }));
  }

  function addMatch(di: number, ri: number) {
    setBracket((cur) => ({
      ...cur,
      divisions: cur.divisions.map((d, i) =>
        i !== di
          ? d
          : {
              ...d,
              rounds: d.rounds.map((r, j) =>
                j !== ri
                  ? r
                  : {
                      ...r,
                      matches: [
                        ...r.matches,
                        {
                          id: `m_${Math.random().toString(36).slice(2, 8)}`,
                          away_team_id: null,
                          away_seed: null,
                          home_team_id: null,
                          home_seed: null,
                          game_id: null,
                          away_score: null,
                          home_score: null,
                          winner_team_id: null,
                          status: "scheduled",
                        },
                      ],
                    },
              ),
            },
      ),
    }));
  }

  function removeMatch(di: number, ri: number, mi: number) {
    setBracket((cur) => ({
      ...cur,
      divisions: cur.divisions.map((d, i) =>
        i !== di
          ? d
          : {
              ...d,
              rounds: d.rounds.map((r, j) =>
                j !== ri
                  ? r
                  : {
                      ...r,
                      matches: r.matches.filter((_, k) => k !== mi),
                    },
              ),
            },
      ),
    }));
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/admin-playoffs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ leagueId, bracket }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setMsg({ ok: false, text: data.error ?? `HTTP ${res.status}` });
        return;
      }
      setMsg({
        ok: true,
        text: bracket.active
          ? "Saved. /playoffs is live."
          : "Saved as a draft (not yet visible on /playoffs).",
      });
    } catch (e) {
      setMsg({
        ok: false,
        text: e instanceof Error ? e.message : "Save failed",
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <section className="rounded-md border border-slate-200 bg-white p-4">
        <p className="font-semibold text-slate-900">Playoffs</p>
        <p className="text-sm text-slate-500 mt-2">Loading…</p>
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-md border border-slate-200 bg-white p-5">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <p className="text-lg font-bold text-slate-900">Playoffs</p>
          <p className="text-sm text-slate-600 mt-1">
            Build the bracket that renders at <code>/playoffs</code>. Toggle
            "Active" once you're ready for fans to see it.
          </p>
        </div>
        <a
          href="/playoffs"
          target="_blank"
          rel="noopener"
          className="text-xs text-slate-500 underline hover:text-slate-900"
        >
          View public page →
        </a>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 items-end">
        <label className="block sm:col-span-2">
          <span className="block text-sm font-semibold text-slate-800 mb-1.5">
            Title
          </span>
          <input
            type="text"
            value={bracket.title}
            onChange={(e) => update({ title: e.target.value })}
            placeholder="2026 Spring Playoffs"
            disabled={saving}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="flex items-center gap-3 select-none">
          <input
            type="checkbox"
            checked={bracket.active}
            onChange={(e) => update({ active: e.target.checked })}
            disabled={saving}
            className="h-5 w-5"
          />
          <span className="text-sm font-semibold text-slate-800">
            Active (publish to /playoffs)
          </span>
        </label>
      </div>

      {bracket.divisions.length === 0 ? (
        <p className="text-sm text-slate-500 italic">
          No divisions yet. Click <strong>+ Add division</strong> below.
        </p>
      ) : (
        bracket.divisions.map((div, di) => (
          <div
            key={di}
            className="rounded-md border border-slate-200 bg-slate-50 p-4 space-y-3"
          >
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="text"
                value={div.label}
                onChange={(e) =>
                  updateDivision(di, { label: e.target.value })
                }
                placeholder="Division (18+, 28+, 35+)"
                disabled={saving}
                className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm font-bold"
              />
              <button
                type="button"
                onClick={() => removeDivision(di)}
                disabled={saving}
                className="rounded-md border border-red-300 bg-white px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
              >
                Remove division
              </button>
            </div>

            {div.rounds.map((round, ri) => (
              <div
                key={ri}
                className="rounded-md border border-slate-200 bg-white p-3 space-y-2"
              >
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={round.label}
                    onChange={(e) =>
                      updateRound(di, ri, { label: e.target.value })
                    }
                    placeholder="Quarterfinals / Semifinals / Final"
                    disabled={saving}
                    className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm font-semibold"
                  />
                  <button
                    type="button"
                    onClick={() => removeRound(di, ri)}
                    disabled={saving}
                    className="rounded-md border border-red-300 bg-white px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
                  >
                    Remove round
                  </button>
                </div>

                <ul className="space-y-2">
                  {round.matches.map((m, mi) => (
                    <li
                      key={m.id}
                      className="rounded border border-slate-200 bg-slate-50 p-2 grid gap-2 sm:grid-cols-7 items-center"
                    >
                      <select
                        value={m.away_team_id ?? ""}
                        onChange={(e) =>
                          updateMatch(di, ri, mi, {
                            away_team_id: e.target.value || null,
                          })
                        }
                        disabled={saving}
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs sm:col-span-2"
                      >
                        <option value="">Away — TBD</option>
                        {(teamsByDivision.get(div.label) ?? teams).map(
                          (t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ),
                        )}
                      </select>
                      <input
                        type="number"
                        value={m.away_seed ?? ""}
                        onChange={(e) =>
                          updateMatch(di, ri, mi, {
                            away_seed: e.target.value
                              ? Number(e.target.value)
                              : null,
                          })
                        }
                        disabled={saving}
                        placeholder="seed"
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs font-mono w-16"
                      />
                      <select
                        value={m.home_team_id ?? ""}
                        onChange={(e) =>
                          updateMatch(di, ri, mi, {
                            home_team_id: e.target.value || null,
                          })
                        }
                        disabled={saving}
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs sm:col-span-2"
                      >
                        <option value="">Home — TBD</option>
                        {(teamsByDivision.get(div.label) ?? teams).map(
                          (t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ),
                        )}
                      </select>
                      <input
                        type="number"
                        value={m.home_seed ?? ""}
                        onChange={(e) =>
                          updateMatch(di, ri, mi, {
                            home_seed: e.target.value
                              ? Number(e.target.value)
                              : null,
                          })
                        }
                        disabled={saving}
                        placeholder="seed"
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs font-mono w-16"
                      />
                      <button
                        type="button"
                        onClick={() => removeMatch(di, ri, mi)}
                        disabled={saving}
                        className="text-xs font-semibold text-red-700 hover:underline justify-self-end"
                      >
                        Remove
                      </button>
                      {/* Second row — outcome details */}
                      <div className="grid gap-2 sm:grid-cols-5 sm:col-span-7 mt-1">
                        <input
                          type="number"
                          value={m.away_score ?? ""}
                          onChange={(e) =>
                            updateMatch(di, ri, mi, {
                              away_score: e.target.value
                                ? Number(e.target.value)
                                : null,
                            })
                          }
                          disabled={saving}
                          placeholder="Away score"
                          className="rounded-md border border-slate-300 px-2 py-1 text-xs font-mono"
                        />
                        <input
                          type="number"
                          value={m.home_score ?? ""}
                          onChange={(e) =>
                            updateMatch(di, ri, mi, {
                              home_score: e.target.value
                                ? Number(e.target.value)
                                : null,
                            })
                          }
                          disabled={saving}
                          placeholder="Home score"
                          className="rounded-md border border-slate-300 px-2 py-1 text-xs font-mono"
                        />
                        <select
                          value={m.winner_team_id ?? ""}
                          onChange={(e) =>
                            updateMatch(di, ri, mi, {
                              winner_team_id: e.target.value || null,
                            })
                          }
                          disabled={saving}
                          className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                        >
                          <option value="">Winner — TBD</option>
                          {m.away_team_id && (
                            <option value={m.away_team_id}>
                              Away wins
                            </option>
                          )}
                          {m.home_team_id && (
                            <option value={m.home_team_id}>
                              Home wins
                            </option>
                          )}
                        </select>
                        <select
                          value={m.status}
                          onChange={(e) =>
                            updateMatch(di, ri, mi, {
                              status: e.target.value as Match["status"],
                            })
                          }
                          disabled={saving}
                          className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                        >
                          <option value="scheduled">Scheduled</option>
                          <option value="live">Live</option>
                          <option value="final">Final</option>
                        </select>
                        <input
                          type="text"
                          value={m.game_id ?? ""}
                          onChange={(e) =>
                            updateMatch(di, ri, mi, {
                              game_id: e.target.value || null,
                            })
                          }
                          disabled={saving}
                          placeholder="game-id (optional)"
                          className="rounded-md border border-slate-300 px-2 py-1 text-xs font-mono"
                        />
                      </div>
                    </li>
                  ))}
                </ul>

                <button
                  type="button"
                  onClick={() => addMatch(di, ri)}
                  disabled={saving}
                  className="rounded-md border border-emerald-300 bg-white px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
                >
                  + Add match
                </button>
              </div>
            ))}

            <button
              type="button"
              onClick={() => addRound(di)}
              disabled={saving}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
            >
              + Add round
            </button>
          </div>
        ))
      )}

      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
        <button
          type="button"
          onClick={addDivision}
          disabled={saving}
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
        >
          + Add division
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ml-auto"
        >
          {saving ? "Saving…" : "Save bracket"}
        </button>
      </div>

      {msg && (
        <div
          className={
            "text-sm rounded-md px-3 py-2 " +
            (msg.ok
              ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border border-red-200 bg-red-50 text-red-800")
          }
        >
          {msg.ok ? "✓ " : "✗ "}
          {msg.text}
        </div>
      )}
    </section>
  );
}
