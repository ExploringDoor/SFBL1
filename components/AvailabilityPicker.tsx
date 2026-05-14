"use client";

// Client side of /availability — team picker, name picker, then a
// per-game Yes/Maybe/No grid that POSTs to /api/public-rsvp on
// every change. localStorage remembers the player's selection
// so a return visit lands them on their own RSVP row without
// having to pick again.

import { useEffect, useMemo, useState } from "react";

interface TeamRow {
  id: string;
  name: string;
  division: string | null;
  color?: string;
}
interface PlayerRow {
  id: string;
  name: string;
  team_id: string;
  number?: string | null;
}
interface GameRow {
  id: string;
  date: string;
  time: string;
  field: string | null;
  home_team_id: string;
  away_team_id: string;
}
interface RsvpRow {
  player_id: string;
  game_id: string;
  status: "yes" | "no" | "maybe";
}

const LS_TEAM = "le_availability_team_id";
const LS_PLAYER = "le_availability_player_id";

export function AvailabilityPicker({
  teams,
  players,
  games,
  initialRsvps,
}: {
  teams: TeamRow[];
  players: PlayerRow[];
  games: GameRow[];
  initialRsvps: RsvpRow[];
}) {
  const [teamId, setTeamId] = useState<string>("");
  const [playerId, setPlayerId] = useState<string>("");
  // RSVP map keyed by `${game_id}_${player_id}`. Hydrate from
  // initialRsvps so the UI shows pre-existing answers immediately.
  const [rsvps, setRsvps] = useState<Map<string, "yes" | "no" | "maybe">>(
    () => {
      const m = new Map<string, "yes" | "no" | "maybe">();
      for (const r of initialRsvps) {
        m.set(`${r.game_id}_${r.player_id}`, r.status);
      }
      return m;
    },
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Restore last selection on mount.
  useEffect(() => {
    const t = localStorage.getItem(LS_TEAM) || "";
    const p = localStorage.getItem(LS_PLAYER) || "";
    if (t) setTeamId(t);
    if (p) setPlayerId(p);
  }, []);

  useEffect(() => {
    if (teamId) localStorage.setItem(LS_TEAM, teamId);
  }, [teamId]);
  useEffect(() => {
    if (playerId) localStorage.setItem(LS_PLAYER, playerId);
  }, [playerId]);

  const teamPlayers = useMemo(
    () =>
      players
        .filter((p) => p.team_id === teamId)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [players, teamId],
  );

  // When team changes, clear playerId if it no longer belongs.
  useEffect(() => {
    if (!playerId) return;
    const ok = teamPlayers.some((p) => p.id === playerId);
    if (!ok) setPlayerId("");
  }, [teamPlayers, playerId]);

  // Games are filtered to the chosen team only — most players don't
  // care about other teams' schedules.
  const teamGames = useMemo(
    () =>
      games.filter(
        (g) => g.home_team_id === teamId || g.away_team_id === teamId,
      ),
    [games, teamId],
  );

  const teamName = teams.find((t) => t.id === teamId)?.name ?? "";

  async function setStatus(
    gameId: string,
    status: "yes" | "no" | "maybe" | "clear",
  ) {
    if (!playerId) {
      setError("Pick your name first.");
      return;
    }
    const key = `${gameId}_${playerId}`;
    setBusy(key);
    setError(null);
    // Optimistic update.
    setRsvps((prev) => {
      const next = new Map(prev);
      if (status === "clear") next.delete(key);
      else next.set(key, status);
      return next;
    });
    const playerName = players.find((p) => p.id === playerId)?.name ?? "";
    try {
      const res = await fetch("/api/public-rsvp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          team_id: teamId,
          player_id: playerId,
          player_name: playerName,
          game_id: gameId,
          status,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(data.error ?? `RSVP failed (${res.status})`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "RSVP failed");
    } finally {
      setBusy(null);
    }
  }

  function teamLabel(team: TeamRow): string {
    return team.division
      ? `${team.name} (${team.division})`
      : team.name;
  }

  function otherTeamId(g: GameRow): string {
    return g.home_team_id === teamId ? g.away_team_id : g.home_team_id;
  }
  function otherTeamName(g: GameRow): string {
    const id = otherTeamId(g);
    return teams.find((t) => t.id === id)?.name ?? id;
  }
  function isHome(g: GameRow): boolean {
    return g.home_team_id === teamId;
  }

  function formatDate(yyyyMmDd: string): string {
    if (!yyyyMmDd) return "";
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(yyyyMmDd);
    if (!m) return yyyyMmDd;
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00Z`);
    return d.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Step 1: Team picker. */}
      <section>
        <label
          style={{
            display: "block",
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--muted)",
            marginBottom: 8,
          }}
        >
          1. Your team
        </label>
        <select
          value={teamId}
          onChange={(e) => setTeamId(e.target.value)}
          style={{
            width: "100%",
            maxWidth: 460,
            padding: "12px 14px",
            border: "1px solid rgba(0,0,0,0.15)",
            borderRadius: 10,
            fontSize: 16,
            fontFamily: "inherit",
            background: "white",
          }}
        >
          <option value="">— pick your team —</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {teamLabel(t)}
            </option>
          ))}
        </select>
      </section>

      {/* Step 2: Player picker (after team chosen). */}
      {teamId && (
        <section>
          <label
            style={{
              display: "block",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "var(--muted)",
              marginBottom: 8,
            }}
          >
            2. Your name
          </label>
          <select
            value={playerId}
            onChange={(e) => setPlayerId(e.target.value)}
            style={{
              width: "100%",
              maxWidth: 460,
              padding: "12px 14px",
              border: "1px solid rgba(0,0,0,0.15)",
              borderRadius: 10,
              fontSize: 16,
              fontFamily: "inherit",
              background: "white",
            }}
          >
            <option value="">— pick your name —</option>
            {teamPlayers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.number ? `#${p.number} ${p.name}` : p.name}
              </option>
            ))}
          </select>
          {teamPlayers.length === 0 && (
            <p
              style={{
                marginTop: 6,
                fontSize: 13,
                color: "var(--muted)",
              }}
            >
              No roster found for {teamName}. Ask your captain to add
              you, then refresh.
            </p>
          )}
        </section>
      )}

      {/* Step 3: Per-game RSVP grid. */}
      {playerId && (
        <section>
          <h3
            className="font-display"
            style={{
              margin: "0 0 14px",
              fontSize: 20,
              color: "var(--text-strong)",
            }}
          >
            3. Upcoming games — mark each one
          </h3>
          {teamGames.length === 0 ? (
            <p style={{ color: "var(--muted)", fontSize: 14 }}>
              No upcoming games for {teamName}.
            </p>
          ) : (
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              {teamGames.map((g) => {
                const key = `${g.id}_${playerId}`;
                const current = rsvps.get(key) ?? null;
                const home = isHome(g);
                return (
                  <li
                    key={g.id}
                    style={{
                      background: "white",
                      border: "1px solid rgba(0,0,0,0.08)",
                      borderRadius: 12,
                      padding: "14px 16px",
                      display: "grid",
                      gridTemplateColumns: "1fr auto",
                      gap: 12,
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 700,
                          color: "var(--text-strong)",
                        }}
                      >
                        {formatDate(g.date)}
                        {g.time && (
                          <span
                            style={{
                              fontWeight: 500,
                              color: "var(--muted)",
                              marginLeft: 8,
                            }}
                          >
                            {g.time}
                          </span>
                        )}
                      </div>
                      <div
                        style={{
                          fontSize: 13,
                          color: "var(--muted)",
                          marginTop: 2,
                        }}
                      >
                        {home ? "vs" : "@"} {otherTeamName(g)}
                        {g.field && <> · {g.field}</>}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      {(["yes", "maybe", "no"] as const).map((opt) => {
                        const active = current === opt;
                        const color =
                          opt === "yes"
                            ? "#16a34a"
                            : opt === "maybe"
                              ? "#ca8a04"
                              : "#dc2626";
                        return (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => setStatus(g.id, opt)}
                            disabled={busy === key}
                            style={{
                              padding: "8px 14px",
                              borderRadius: 8,
                              border: `1px solid ${active ? color : "rgba(0,0,0,0.15)"}`,
                              background: active ? color : "white",
                              color: active ? "white" : "var(--text-strong)",
                              fontSize: 13,
                              fontWeight: 700,
                              cursor: busy === key ? "wait" : "pointer",
                              textTransform: "uppercase",
                              letterSpacing: "0.04em",
                              minWidth: 56,
                            }}
                          >
                            {opt}
                          </button>
                        );
                      })}
                      {current && (
                        <button
                          type="button"
                          onClick={() => setStatus(g.id, "clear")}
                          disabled={busy === key}
                          style={{
                            padding: "8px 10px",
                            borderRadius: 8,
                            border: "1px solid rgba(0,0,0,0.1)",
                            background: "transparent",
                            color: "var(--muted)",
                            fontSize: 11,
                            cursor: "pointer",
                          }}
                          title="Clear my RSVP"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {error && (
        <p
          style={{
            marginTop: 0,
            padding: "10px 14px",
            background: "rgba(220,38,38,0.08)",
            border: "1px solid rgba(220,38,38,0.25)",
            borderRadius: 10,
            color: "#991b1b",
            fontSize: 14,
          }}
        >
          {error}
        </p>
      )}
    </div>
  );
}
