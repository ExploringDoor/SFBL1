"use client";

// Admin inbox for score discrepancies.
//
// A dispute lands here when the two teams report different scores for the same
// game. The result is already off the site by then — this is where Mike decides
// what actually happened. He can take either coach's number in one click, type
// his own, or dismiss it (which leaves the game unplayed).

import { useCallback, useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { collection, getDocs } from "firebase/firestore";
import { getDb } from "@/lib/firebase";

interface Reported {
  home_score: number;
  away_score: number;
}
interface Dispute {
  id: string;
  game_id: string;
  date: string;
  label: string;
  status: string;
  created_at: string;
  reported?: { home?: Reported; away?: Reported };
  official?: Reported;
}

interface Props {
  leagueId: string;
  user: User;
}

export function ScoreDisputes({ leagueId, user }: Props) {
  const [rows, setRows] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState<Record<string, { h: string; a: string }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const snap = await getDocs(collection(getDb(), `leagues/${leagueId}/score_disputes`));
      const out: Dispute[] = [];
      snap.forEach((d) => out.push({ id: d.id, ...(d.data() as Omit<Dispute, "id">) }));
      out.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      setRows(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [leagueId]);

  useEffect(() => {
    load();
  }, [load]);

  async function resolve(d: Dispute, home: number, away: number) {
    setBusy(d.id);
    setError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/admin-resolve-score", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ leagueId, disputeId: d.id, home_score: home, away_score: away }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  async function dismiss(d: Dispute) {
    if (!window.confirm("Dismiss without setting a score?\n\nThe game goes back to unplayed."))
      return;
    setBusy(d.id);
    try {
      const token = await user.getIdToken();
      await fetch("/api/admin-resolve-score", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ leagueId, disputeId: d.id, action: "dismiss" }),
      });
      await load();
    } finally {
      setBusy(null);
    }
  }

  const open = rows.filter((r) => r.status === "open");
  const closed = rows.filter((r) => r.status !== "open");

  if (loading) return <p style={{ color: "var(--muted)" }}>Loading…</p>;

  return (
    <section>
      <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 0, lineHeight: 1.6 }}>
        When two teams report different scores for the same game, the result comes off
        the site and lands here. Your decision is final and puts it back live.
      </p>
      {error && <p style={{ color: "var(--red, #c8102e)", fontWeight: 600 }}>{error}</p>}

      {open.length === 0 ? (
        <p style={{ fontSize: 14, color: "var(--muted)" }}>
          No open discrepancies. Nothing needs your call right now.
        </p>
      ) : (
        open.map((d) => {
          const h = d.reported?.home;
          const a = d.reported?.away;
          const man = manual[d.id] ?? { h: "", a: "" };
          return (
            <div
              key={d.id}
              style={{
                background: "var(--card)",
                border: "1px solid rgba(200,16,46,0.35)",
                borderLeft: "4px solid var(--red, #c8102e)",
                borderRadius: 12,
                padding: 16,
                marginBottom: 12,
              }}
            >
              <p style={{ fontWeight: 800, margin: "0 0 2px" }}>{d.label}</p>
              <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 12px" }}>
                {d.date} · reported scores below are away–home
              </p>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
                {a && (
                  <button
                    type="button"
                    disabled={busy === d.id}
                    onClick={() => resolve(d, a.home_score, a.away_score)}
                    style={pick}
                  >
                    Away team says {a.away_score}–{a.home_score}
                  </button>
                )}
                {h && (
                  <button
                    type="button"
                    disabled={busy === d.id}
                    onClick={() => resolve(d, h.home_score, h.away_score)}
                    style={pick}
                  >
                    Home team says {h.away_score}–{h.home_score}
                  </button>
                )}
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, color: "var(--muted)" }}>Or set it yourself:</span>
                <input
                  type="number"
                  min={0}
                  placeholder="Away"
                  value={man.a}
                  onChange={(e) =>
                    setManual((c) => ({ ...c, [d.id]: { ...man, a: e.target.value } }))
                  }
                  style={num}
                />
                <span style={{ color: "var(--muted)" }}>–</span>
                <input
                  type="number"
                  min={0}
                  placeholder="Home"
                  value={man.h}
                  onChange={(e) =>
                    setManual((c) => ({ ...c, [d.id]: { ...man, h: e.target.value } }))
                  }
                  style={num}
                />
                <button
                  type="button"
                  disabled={busy === d.id || man.h === "" || man.a === ""}
                  onClick={() => resolve(d, Number(man.h), Number(man.a))}
                  style={pick}
                >
                  Use this
                </button>
                <button
                  type="button"
                  disabled={busy === d.id}
                  onClick={() => dismiss(d)}
                  style={{ ...pick, background: "#fff", color: "var(--muted)" }}
                >
                  Dismiss
                </button>
              </div>
            </div>
          );
        })
      )}

      {closed.length > 0 && (
        <details style={{ marginTop: 16 }}>
          <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
            Settled ({closed.length})
          </summary>
          <div style={{ marginTop: 8 }}>
            {closed.map((d) => (
              <div
                key={d.id}
                style={{ fontSize: 13, padding: "6px 0", borderBottom: "1px solid rgba(0,0,0,0.06)" }}
              >
                <strong>{d.label}</strong> · {d.date} ·{" "}
                {d.status === "resolved" && d.official
                  ? `set to ${d.official.away_score}–${d.official.home_score}`
                  : "dismissed"}
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

const pick: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 8,
  border: "1px solid rgba(0,0,0,0.18)",
  background: "var(--brand-primary, #002d6e)",
  color: "#fff",
  fontWeight: 700,
  cursor: "pointer",
};
const num: React.CSSProperties = {
  width: 78,
  padding: "7px 9px",
  border: "1px solid rgba(0,0,0,0.18)",
  borderRadius: 8,
  fontSize: 14,
  background: "#fff",
  color: "#1a1a1a",
};
