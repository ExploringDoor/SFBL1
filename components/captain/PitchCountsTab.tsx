"use client";

// Pitch Counts tab — a captain logs each pitcher's pitches per outing.
// Coaches pick the game (which fills in the date) and the pitcher from their
// roster; both fall back to free entry (a manual date / a typed name) so
// unscheduled outings and off-roster pitchers still work. Reads
// /pitch_outings, /players and /games directly (all public read); writes go
// through /api/captain-pitch-count (team-scoped by claim). These outings feed
// the public Pitch Smart eligibility tracker.

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useUser } from "@/lib/auth-client";

interface Outing {
  id: string;
  player_name: string;
  date: string;
  pitches: number;
}

interface GameOpt {
  id: string;
  date: string;
  label: string;
}

const CUSTOM = "__custom__";
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Timezone-safe friendly date for a "YYYY-MM-DD" string ("2026-07-12" → "Jul 12").
function friendlyDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const mon = MONTHS[Number(m[2]) - 1] ?? m[2];
  return `${mon} ${Number(m[3])}`;
}

export function PitchCountsTab({
  leagueId,
  teamId,
}: {
  leagueId: string;
  teamId: string;
}) {
  const user = useUser();
  const [outings, setOutings] = useState<Outing[]>([]);
  const [roster, setRoster] = useState<string[]>([]);
  const [games, setGames] = useState<GameOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const today = useMemo(todayLocal, []);
  const [name, setName] = useState("");
  const [customName, setCustomName] = useState(false);
  const [date, setDate] = useState(today);
  const [customDate, setCustomDate] = useState(false);
  const [pitches, setPitches] = useState("");

  async function loadOutings() {
    // Read via the server (Admin SDK) — the public client read of
    // /pitch_outings isn't enabled in every environment's rules yet.
    const res = await fetch(
      `/api/team-pitch-counts?leagueId=${encodeURIComponent(leagueId)}&teamId=${encodeURIComponent(teamId)}`,
    );
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      outings?: Outing[];
      error?: string;
    };
    if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    const rows: Outing[] = (data.outings ?? []).sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        a.player_name.localeCompare(b.player_name),
    );
    setOutings(rows);
  }

  // One-time load of the team's roster + games so the pitcher and game
  // dropdowns have options. Both collections are public-read.
  async function loadRefs() {
    const db = getDb();
    const [playersSnap, gamesSnap, teamsSnap] = await Promise.all([
      getDocs(
        query(
          collection(db, `leagues/${leagueId}/players`),
          where("team_id", "==", teamId),
        ),
      ),
      getDocs(collection(db, `leagues/${leagueId}/games`)),
      getDocs(collection(db, `leagues/${leagueId}/teams`)),
    ]);

    const names = playersSnap.docs
      .map((d) => String(d.data().name ?? "").trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    setRoster(names);

    const teamName = new Map<string, string>();
    teamsSnap.docs.forEach((d) =>
      teamName.set(d.id, String(d.data().name ?? d.id)),
    );
    const gs: GameOpt[] = gamesSnap.docs
      .map((d) => {
        const x = d.data() as {
          away_team_id?: string;
          home_team_id?: string;
          date?: string;
        };
        return { id: d.id, ...x };
      })
      .filter(
        (g) => g.away_team_id === teamId || g.home_team_id === teamId,
      )
      .map((g) => {
        const iso = String(g.date ?? "");
        const isHome = g.home_team_id === teamId;
        const oppId = String(isHome ? g.away_team_id : g.home_team_id);
        const opp = teamName.get(oppId) ?? oppId;
        return {
          id: g.id,
          date: iso,
          label: `${friendlyDate(iso)} — ${isHome ? "vs" : "@"} ${opp}`,
        };
      })
      .filter((g) => g.date)
      .sort((a, b) => b.date.localeCompare(a.date));
    setGames(gs);
    // Default to the most recent game so the date is pre-filled sensibly.
    if (gs.length && gs[0]) setDate(gs[0].date);
  }

  async function load() {
    setLoading(true);
    try {
      await Promise.all([loadOutings(), loadRefs()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load pitch counts.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId, teamId, user]);

  const knownNames = useMemo(
    () =>
      Array.from(
        new Set([...roster, ...outings.map((o) => o.player_name)]),
      ).sort(),
    [roster, outings],
  );

  // Show the free-text name input when the coach opts into it, or when there
  // are no roster players to pick from. Same idea for the date vs a game pick.
  const showNameInput = customName || roster.length === 0;
  const showDateInput = customDate || games.length === 0;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!user) {
      setError("Please sign in again.");
      return;
    }
    const p = Number(pitches);
    if (!name.trim()) {
      setError("Pick or enter a pitcher.");
      return;
    }
    if (!Number.isFinite(p) || p < 0) {
      setError("Enter a valid pitch count.");
      return;
    }
    setSaving(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/captain-pitch-count", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          leagueId,
          player_name: name.trim(),
          date,
          pitches: p,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setName("");
      setCustomName(false);
      setPitches("");
      await loadOutings();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!user) return;
    setBusyId(id);
    setError(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/captain-pitch-count", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ leagueId, id }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !data.ok) setError(data.error ?? `HTTP ${res.status}`);
      else await loadOutings();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="cap-section-head">
        <div className="cap-section-title">Pitch Counts</div>
        <div className="cap-section-sub">
          Log each pitcher&rsquo;s pitches per outing. This feeds the Pitch Smart
          eligibility tracker (required rest is based on pitches thrown).
        </div>
      </div>

      {error && <div className="cap-error-banner">{error}</div>}

      <form className="cap-inline-form" onSubmit={add}>
        <div className="cap-form-row">
          {/* Which game — picking one fills in the date. */}
          <div className="cap-form-col">
            <label className="cap-form-lbl">Game</label>
            {games.length > 0 && !showDateInput ? (
              <select
                className="cap-form-input"
                value={
                  games.find((g) => g.date === date)?.id ?? (customDate ? CUSTOM : "")
                }
                onChange={(e) => {
                  if (e.target.value === CUSTOM) {
                    setCustomDate(true);
                    return;
                  }
                  const g = games.find((x) => x.id === e.target.value);
                  if (g) setDate(g.date);
                }}
              >
                {games.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.label}
                  </option>
                ))}
                <option value={CUSTOM}>Other date…</option>
              </select>
            ) : (
              <input
                className="cap-form-input"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            )}
          </div>

          {/* Pitcher — pick from the roster, or type a name. */}
          <div className="cap-form-col">
            <label className="cap-form-lbl">Pitcher</label>
            {roster.length > 0 && !showNameInput ? (
              <select
                className="cap-form-input"
                value={roster.includes(name) ? name : ""}
                onChange={(e) => {
                  if (e.target.value === CUSTOM) {
                    setCustomName(true);
                    setName("");
                    return;
                  }
                  setName(e.target.value);
                }}
              >
                <option value="">Select a pitcher…</option>
                {roster.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
                <option value={CUSTOM}>Someone else…</option>
              </select>
            ) : (
              <input
                className="cap-form-input"
                list="coybl-pitcher-names"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Pitcher name"
              />
            )}
            <datalist id="coybl-pitcher-names">
              {knownNames.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </div>

          <div className="cap-form-col">
            <label className="cap-form-lbl">Pitches</label>
            <input
              className="cap-form-input"
              type="number"
              min={0}
              max={300}
              value={pitches}
              onChange={(e) => setPitches(e.target.value)}
              placeholder="e.g. 62"
            />
          </div>
        </div>
        <div className="cap-form-actions">
          <button
            type="submit"
            disabled={saving}
            style={{
              border: "none",
              borderRadius: 8,
              padding: "9px 18px",
              background: "var(--brand-primary)",
              color: "#fff",
              fontWeight: 800,
              fontSize: 14,
              cursor: saving ? "default" : "pointer",
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? "Saving…" : "+ Log outing"}
          </button>
        </div>
      </form>

      {loading ? (
        <p style={{ color: "var(--muted)" }}>Loading…</p>
      ) : outings.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>
          No pitch counts logged yet. Add a pitcher&rsquo;s outing above.
        </p>
      ) : (
        <div className="cap-roster-tbl-wrap">
          <table className="cap-roster-tbl">
            <thead>
              <tr>
                <th className="text-left">Pitcher</th>
                <th className="text-left">Date</th>
                <th>Pitches</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {outings.map((o) => (
                <tr key={o.id}>
                  <td className="text-left">{o.player_name}</td>
                  <td className="text-left">{o.date}</td>
                  <td>{o.pitches}</td>
                  <td>
                    <button
                      className="cap-btn-danger"
                      disabled={busyId === o.id}
                      onClick={() => remove(o.id)}
                    >
                      {busyId === o.id ? "…" : "Delete"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
