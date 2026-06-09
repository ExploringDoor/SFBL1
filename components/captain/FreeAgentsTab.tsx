"use client";

// Captain "Free Agents" tab — the pool of players who registered but
// aren't on any roster yet, with contact info, so a manager who's
// short can reach out (Nelson, 2026-05-18). Data + PII gating live in
// /api/free-agents (captain/admin only).

import { useEffect, useState } from "react";
import { useUser } from "@/lib/auth-client";

interface FreeAgent {
  id: string;
  name: string;
  position: string;
  division: string;
  team_pref: string;
  email: string;
  phone: string;
  registered_at: string;
}

export function FreeAgentsTab({ leagueId }: { leagueId: string }) {
  const user = useUser();
  const [players, setPlayers] = useState<FreeAgent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const idToken = await user.getIdToken();
        const res = await fetch("/api/free-agents", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ leagueId }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          players?: FreeAgent[];
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) setError(data.error ?? `HTTP ${res.status}`);
        else setPlayers(data.players ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId, user]);

  const filtered = (players ?? []).filter((p) => {
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    return (
      p.name.toLowerCase().includes(s) ||
      p.position.toLowerCase().includes(s) ||
      p.division.toLowerCase().includes(s)
    );
  });

  return (
    <div className="cap-tab">
      <div className="cap-section-head">
        <h2 className="cap-section-title">Free Agents</h2>
        <p className="cap-section-sub">
          Players who registered but aren&rsquo;t on a roster yet. Short a
          player? Reach out directly — their contact info is below.
        </p>
      </div>

      {error && <div className="cap-error-banner">{error}</div>}

      {players === null && !error && (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>Loading…</p>
      )}

      {players !== null && players.length === 0 && (
        <p style={{ color: "var(--muted)", fontSize: 14 }}>
          No free agents in the pool right now. Players show up here after
          they register but before they&rsquo;re assigned to a team.
        </p>
      )}

      {players !== null && players.length > 0 && (
        <>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, position, division…"
            style={{
              width: "100%",
              maxWidth: 360,
              padding: "9px 12px",
              border: "1px solid rgba(0,0,0,0.15)",
              borderRadius: 10,
              fontSize: 14,
              marginBottom: 16,
            }}
          />
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: 12,
            }}
          >
            {filtered.map((p) => (
              <li
                key={p.id}
                style={{
                  background: "white",
                  border: "1px solid rgba(0,0,0,0.08)",
                  borderLeft: "4px solid var(--brand-primary)",
                  borderRadius: 12,
                  padding: "12px 14px",
                }}
              >
                <div
                  style={{
                    fontWeight: 800,
                    fontSize: 16,
                    color: "var(--text-strong)",
                  }}
                >
                  {p.name}
                </div>
                <div
                  style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}
                >
                  {[p.position, p.division].filter(Boolean).join(" · ")}
                  {p.team_pref ? ` · wants ${p.team_pref}` : ""}
                </div>
                <div style={{ marginTop: 8, fontSize: 14, lineHeight: 1.6 }}>
                  {p.phone && (
                    <div>
                      📞{" "}
                      <a href={`tel:${p.phone.replace(/[^\d+]/g, "")}`}>
                        {p.phone}
                      </a>
                    </div>
                  )}
                  {p.email && (
                    <div style={{ wordBreak: "break-all" }}>
                      ✉️ <a href={`mailto:${p.email}`}>{p.email}</a>
                    </div>
                  )}
                  {!p.phone && !p.email && (
                    <span style={{ color: "var(--muted)" }}>
                      No contact on file
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
