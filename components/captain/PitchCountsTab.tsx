"use client";

// Pitch Counts tab — a captain logs each pitcher's pitches per outing. COYBL
// is stats-off (no roster), so pitchers are free-text names (a datalist offers
// previously-entered names for quick re-entry). Reads /pitch_outings directly
// (public); writes go through /api/captain-pitch-count (team-scoped by claim).
// These outings feed the public Pitch Smart eligibility tracker.

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

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const today = useMemo(todayLocal, []);
  const [name, setName] = useState("");
  const [date, setDate] = useState(today);
  const [pitches, setPitches] = useState("");

  async function load() {
    setLoading(true);
    try {
      const db = getDb();
      const snap = await getDocs(
        query(
          collection(db, `leagues/${leagueId}/pitch_outings`),
          where("team_id", "==", teamId),
        ),
      );
      const rows: Outing[] = snap.docs
        .map((d) => {
          const x = d.data();
          return {
            id: d.id,
            player_name: String(x.player_name ?? ""),
            date: String(x.date ?? ""),
            pitches: Number(x.pitches ?? 0),
          };
        })
        .sort(
          (a, b) =>
            b.date.localeCompare(a.date) ||
            a.player_name.localeCompare(b.player_name),
        );
      setOutings(rows);
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
    () => Array.from(new Set(outings.map((o) => o.player_name))).sort(),
    [outings],
  );

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!user) {
      setError("Please sign in again.");
      return;
    }
    const p = Number(pitches);
    if (!name.trim()) {
      setError("Pitcher name is required.");
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
      setPitches("");
      setDate(today);
      await load();
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
      else await load();
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
          <div className="cap-form-col">
            <label className="cap-form-lbl">Pitcher</label>
            <input
              className="cap-form-input"
              list="coybl-pitcher-names"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Pitcher name"
            />
            <datalist id="coybl-pitcher-names">
              {knownNames.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </div>
          <div className="cap-form-col">
            <label className="cap-form-lbl">Date</label>
            <input
              className="cap-form-input"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
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
