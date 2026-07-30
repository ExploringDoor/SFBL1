"use client";

// Admin schedule generator.
//
// Mike's brief: tell it how many weeks, which fields and times, how often teams
// play, and which teams must not meet — then it builds the season.
//
// Flow is deliberately preview-then-commit. The maths runs in the browser via
// lib/schedule-generator (pure, no I/O), so the table on screen IS the schedule;
// pressing Create writes exactly those rows and nothing else. Nothing touches
// the live schedule until that button is pressed.
//
// The blocked-pairs picker is the shape Adam asked for: every team listed, click
// one then another to say "these two never play", repeat as many times as you
// like. The list is saved to the league so it is set once, not re-picked every
// time a schedule is built.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import {
  generateSchedule,
  type GeneratedGame,
  type GeneratorField,
  type GeneratorResult,
} from "@/lib/schedule-generator";

interface TeamOpt {
  id: string;
  name: string;
  division: string;
}

interface Props {
  leagueId: string;
  user: User;
}

const CARD: React.CSSProperties = {
  background: "var(--card)",
  border: "1px solid rgba(0,0,0,0.08)",
  borderRadius: 12,
  padding: 16,
  marginBottom: 14,
};
const LABEL: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--muted)",
  marginBottom: 5,
};
const INPUT: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid rgba(0,0,0,0.18)",
  borderRadius: 8,
  fontSize: 14,
  background: "#fff",
  color: "#1a1a1a",
};

export function ScheduleGenerator({ leagueId, user }: Props) {
  const [teams, setTeams] = useState<TeamOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  // --- inputs ------------------------------------------------------------
  const [division, setDivision] = useState<string>("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [startDate, setStartDate] = useState("");
  const [weeks, setWeeks] = useState(8);
  const [gamesPerWeek, setGamesPerWeek] = useState(1);
  const [pairing, setPairing] = useState<"same-opponent" | "different-opponents">(
    "same-opponent",
  );
  const [fields, setFields] = useState<{ name: string; times: string }[]>([
    { name: "", times: "17:30" },
  ]);

  // --- blocked pairs -----------------------------------------------------
  const [blocked, setBlocked] = useState<[string, string][]>([]);
  const [pendingTeam, setPendingTeam] = useState<string | null>(null);
  const [rulesSaved, setRulesSaved] = useState(false);

  const [result, setResult] = useState<GeneratorResult | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const db = getDb();
        const [teamSnap, rulesSnap] = await Promise.all([
          getDocs(collection(db, `leagues/${leagueId}/teams`)),
          getDoc(doc(db, `leagues/${leagueId}/site_config/schedule_rules`)),
        ]);
        const rows: TeamOpt[] = [];
        teamSnap.forEach((d) => {
          const t = d.data() as Record<string, unknown>;
          if (t.active === false) return;
          rows.push({
            id: d.id,
            name: String(t.name ?? d.id),
            division: String(t.division ?? t.ageGroup ?? ""),
          });
        });
        rows.sort((a, b) => a.name.localeCompare(b.name));
        setTeams(rows);
        const bp = rulesSnap.exists() ? rulesSnap.data()?.blocked_pairs : null;
        if (Array.isArray(bp)) {
          setBlocked(
            bp
              .filter((p: unknown) => Array.isArray(p) && p.length === 2)
              .map((p: string[]) => [String(p[0]), String(p[1])] as [string, string]),
          );
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load teams");
      } finally {
        setLoading(false);
      }
    })();
  }, [leagueId]);

  const divisions = useMemo(
    () => [...new Set(teams.map((t) => t.division).filter(Boolean))].sort(),
    [teams],
  );
  const inDivision = useMemo(
    () => (division ? teams.filter((t) => t.division === division) : teams),
    [teams, division],
  );

  // Selecting a division pre-selects its teams; the admin can then untick any.
  useEffect(() => {
    setPicked(new Set(inDivision.map((t) => t.id)));
    setResult(null);
  }, [inDivision]);

  const nameOf = useCallback(
    (id: string) => teams.find((t) => t.id === id)?.name ?? id,
    [teams],
  );

  function toggleTeam(id: string) {
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setResult(null);
  }

  // Click one team, then another: that pair can never play.
  function pickForBlock(id: string) {
    setDone(null);
    setRulesSaved(false);
    if (pendingTeam === null) {
      setPendingTeam(id);
      return;
    }
    if (pendingTeam === id) {
      setPendingTeam(null);
      return;
    }
    const key = [pendingTeam, id].sort().join("|");
    setBlocked((cur) =>
      cur.some(([a, b]) => [a, b].sort().join("|") === key)
        ? cur
        : [...cur, [pendingTeam, id] as [string, string]],
    );
    setPendingTeam(null);
    setResult(null);
  }

  function removeBlocked(i: number) {
    setBlocked((cur) => cur.filter((_, idx) => idx !== i));
    setRulesSaved(false);
    setResult(null);
  }

  async function saveRules() {
    setBusy(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/admin-schedule-generate", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ leagueId, action: "save_rules", blockedPairs: blocked }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setRulesSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  function build() {
    setError(null);
    setDone(null);
    const genFields: GeneratorField[] = fields
      .map((f) => ({
        name: f.name.trim(),
        times: f.times
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      }))
      .filter((f) => f.name && f.times.length > 0);

    if (!startDate) return setError("Pick the first game date.");
    if (genFields.length === 0) return setError("Add at least one field with a time.");
    if (picked.size < 2) return setError("Select at least two teams.");

    setResult(
      generateSchedule({
        teams: [...picked].map((id) => ({ id, name: nameOf(id) })),
        startDate,
        weeks,
        fields: genFields,
        gamesPerWeek,
        weeklyPairing: pairing,
        blockedPairs: blocked,
        division: division || undefined,
      }),
    );
  }

  async function commit() {
    if (!result || result.games.length === 0) return;
    if (
      !window.confirm(
        `Create ${result.games.length} games on the live schedule?\n\n` +
          `This adds them straight to the site. Existing games are not touched.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/admin-schedule-generate", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          leagueId,
          action: "create_games",
          games: result.games,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        created?: number;
      };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setDone(`Created ${data.created} games. They are live on the schedule now.`);
      setResult(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create games");
    } finally {
      setBusy(false);
    }
  }

  const byWeek = useMemo(() => {
    const m = new Map<number, GeneratedGame[]>();
    (result?.games ?? []).forEach((g) => {
      m.set(g.week, [...(m.get(g.week) ?? []), g]);
    });
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [result]);

  if (loading) return <p style={{ color: "var(--muted)" }}>Loading teams…</p>;

  return (
    <section>
      <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 0, lineHeight: 1.6 }}>
        Builds a full season: everyone plays everyone at least once, spread over the
        weeks, fields and times you set. Nothing is written until you press Create,
        and existing games are never touched.
      </p>

      {/* ---- 1. teams ---------------------------------------------------- */}
      <div style={CARD}>
        <p style={{ fontWeight: 800, margin: "0 0 10px" }}>1. Teams</p>
        {divisions.length > 0 && (
          <div style={{ marginBottom: 12, maxWidth: 280 }}>
            <label style={LABEL}>Division</label>
            <select
              style={INPUT}
              value={division}
              onChange={(e) => setDivision(e.target.value)}
            >
              <option value="">All teams</option>
              {divisions.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
        )}
        <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 8px" }}>
          {picked.size} of {inDivision.length} selected. Click to include or exclude.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {inDivision.map((t) => {
            const on = picked.has(t.id);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => toggleTeam(t.id)}
                style={{
                  padding: "7px 12px",
                  borderRadius: 999,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  border: on
                    ? "1px solid var(--brand-primary, #002d6e)"
                    : "1px solid rgba(0,0,0,0.18)",
                  background: on ? "var(--brand-primary, #002d6e)" : "#fff",
                  color: on ? "#fff" : "#1a1a1a",
                }}
              >
                {t.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* ---- 2. when ----------------------------------------------------- */}
      <div style={CARD}>
        <p style={{ fontWeight: 800, margin: "0 0 10px" }}>2. When</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
          <div style={{ minWidth: 180 }}>
            <label style={LABEL}>First game date</label>
            <input
              type="date"
              style={INPUT}
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setResult(null);
              }}
            />
          </div>
          <div style={{ width: 120 }}>
            <label style={LABEL}>Weeks</label>
            <input
              type="number"
              min={1}
              max={40}
              style={INPUT}
              value={weeks}
              onChange={(e) => {
                setWeeks(Number(e.target.value) || 1);
                setResult(null);
              }}
            />
          </div>
          <div style={{ width: 150 }}>
            <label style={LABEL}>Games per week</label>
            <input
              type="number"
              min={1}
              max={4}
              style={INPUT}
              value={gamesPerWeek}
              onChange={(e) => {
                setGamesPerWeek(Number(e.target.value) || 1);
                setResult(null);
              }}
            />
          </div>
          {gamesPerWeek > 1 && (
            <div style={{ minWidth: 230 }}>
              <label style={LABEL}>Those games are against</label>
              <select
                style={INPUT}
                value={pairing}
                onChange={(e) => {
                  setPairing(e.target.value as typeof pairing);
                  setResult(null);
                }}
              >
                <option value="same-opponent">
                  The same opponent (doubleheader)
                </option>
                <option value="different-opponents">Different opponents</option>
              </select>
            </div>
          )}
        </div>
        <p style={{ fontSize: 12, color: "var(--muted)", margin: "10px 0 0" }}>
          Each week is 7 days after the one before, starting on the date above.
        </p>
      </div>

      {/* ---- 3. fields + times ------------------------------------------- */}
      <div style={CARD}>
        <p style={{ fontWeight: 800, margin: "0 0 4px" }}>3. Fields and times</p>
        <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 10px" }}>
          Each field has its own start times, so a field that only runs one game a
          night is not given slots it does not have. Separate times with commas.
        </p>
        {fields.map((f, i) => (
          <div key={i} style={{ display: "flex", gap: 10, marginBottom: 8 }}>
            <input
              placeholder="Field name"
              style={{ ...INPUT, flex: 2 }}
              value={f.name}
              onChange={(e) => {
                const v = e.target.value;
                setFields((cur) => cur.map((x, ix) => (ix === i ? { ...x, name: v } : x)));
                setResult(null);
              }}
            />
            <input
              placeholder="17:30, 19:00"
              style={{ ...INPUT, flex: 2 }}
              value={f.times}
              onChange={(e) => {
                const v = e.target.value;
                setFields((cur) => cur.map((x, ix) => (ix === i ? { ...x, times: v } : x)));
                setResult(null);
              }}
            />
            <button
              type="button"
              onClick={() => setFields((cur) => cur.filter((_, ix) => ix !== i))}
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid rgba(0,0,0,0.18)",
                background: "#fff",
                cursor: "pointer",
              }}
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setFields((cur) => [...cur, { name: "", times: "17:30" }])}
          style={{
            padding: "8px 14px",
            borderRadius: 8,
            border: "1px solid rgba(0,0,0,0.18)",
            background: "#fff",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          + Add field
        </button>
      </div>

      {/* ---- 4. blocked matchups ----------------------------------------- */}
      <div style={CARD}>
        <p style={{ fontWeight: 800, margin: "0 0 4px" }}>
          4. Teams that must not play each other
        </p>
        <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 10px" }}>
          Click one team, then the team it must never be drawn against. Repeat for as
          many pairs as you need. Saved with the league, so you only set this once.
        </p>
        {pendingTeam && (
          <p
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "var(--brand-primary, #002d6e)",
              margin: "0 0 8px",
            }}
          >
            {nameOf(pendingTeam)} selected. Now click the team it cannot play.{" "}
            <button
              type="button"
              onClick={() => setPendingTeam(null)}
              style={{
                marginLeft: 6,
                border: "none",
                background: "none",
                textDecoration: "underline",
                cursor: "pointer",
                color: "var(--muted)",
              }}
            >
              cancel
            </button>
          </p>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          {teams.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => pickForBlock(t.id)}
              style={{
                padding: "7px 12px",
                borderRadius: 999,
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                border:
                  pendingTeam === t.id
                    ? "2px solid var(--brand-primary, #002d6e)"
                    : "1px solid rgba(0,0,0,0.18)",
                background: pendingTeam === t.id ? "rgba(0,45,110,0.08)" : "#fff",
                color: "#1a1a1a",
              }}
            >
              {t.name}
            </button>
          ))}
        </div>

        {blocked.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
            No blocked matchups yet.
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: "0 0 10px" }}>
            {blocked.map(([a, b], i) => (
              <li
                key={`${a}|${b}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "7px 0",
                  borderBottom: "1px solid rgba(0,0,0,0.06)",
                  fontSize: 14,
                }}
              >
                <span style={{ fontWeight: 700 }}>{nameOf(a)}</span>
                <span style={{ color: "var(--muted)" }}>cannot play</span>
                <span style={{ fontWeight: 700 }}>{nameOf(b)}</span>
                <button
                  type="button"
                  onClick={() => removeBlocked(i)}
                  style={{
                    marginLeft: "auto",
                    border: "none",
                    background: "none",
                    color: "var(--red, #c8102e)",
                    cursor: "pointer",
                    fontWeight: 700,
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={saveRules}
          disabled={busy}
          style={{
            padding: "8px 14px",
            borderRadius: 8,
            border: "1px solid rgba(0,0,0,0.18)",
            background: "#fff",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          {rulesSaved ? "Saved" : "Save these rules"}
        </button>
      </div>

      {/* ---- build ------------------------------------------------------- */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14 }}>
        <button
          type="button"
          onClick={build}
          disabled={busy}
          style={{
            padding: "11px 20px",
            borderRadius: 10,
            border: "none",
            background: "var(--brand-primary, #002d6e)",
            color: "#fff",
            fontWeight: 800,
            fontSize: 15,
            cursor: "pointer",
          }}
        >
          Build schedule
        </button>
        {result && result.games.length > 0 && (
          <button
            type="button"
            onClick={commit}
            disabled={busy}
            style={{
              padding: "11px 20px",
              borderRadius: 10,
              border: "none",
              background: "var(--green, #22c55e)",
              color: "#fff",
              fontWeight: 800,
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            {busy ? "Creating…" : `Create ${result.games.length} games`}
          </button>
        )}
      </div>

      {error && (
        <p style={{ color: "var(--red, #c8102e)", fontWeight: 600 }}>{error}</p>
      )}
      {done && (
        <p style={{ color: "var(--green, #22c55e)", fontWeight: 700 }}>{done}</p>
      )}

      {/* ---- preview ----------------------------------------------------- */}
      {result && (
        <div style={CARD}>
          <p style={{ fontWeight: 800, margin: "0 0 8px" }}>
            Preview · {result.games.length} games
            {result.everyPairPlayed && " · everyone plays everyone"}
          </p>

          {result.warnings.map((w, i) => (
            <p
              key={i}
              style={{
                fontSize: 13,
                margin: "0 0 8px",
                padding: "9px 12px",
                borderRadius: 8,
                background: "rgba(245,166,35,0.12)",
                border: "1px solid rgba(245,166,35,0.4)",
                color: "#7a4b00",
              }}
            >
              {w}
            </p>
          ))}

          {(result.skippedBlocked.length > 0 || result.skippedSameOrg.length > 0) && (
            <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 10px" }}>
              Not scheduled:{" "}
              {[...result.skippedBlocked, ...result.skippedSameOrg]
                .map((s) => `${s.a} v ${s.b}`)
                .join(", ")}
            </p>
          )}

          {byWeek.map(([wk, games]) => (
            <div key={wk} style={{ marginBottom: 14 }}>
              <p
                style={{
                  fontSize: 12,
                  fontWeight: 800,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--muted)",
                  margin: "0 0 6px",
                }}
              >
                Week {wk} · {games[0]?.date}
              </p>
              {games.map((g, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    gap: 12,
                    padding: "6px 0",
                    fontSize: 14,
                    borderBottom: "1px solid rgba(0,0,0,0.05)",
                  }}
                >
                  <span style={{ width: 60, color: "var(--muted)" }}>{g.time}</span>
                  <span style={{ flex: 1 }}>
                    {nameOf(g.away_team_id)}{" "}
                    <span style={{ color: "var(--muted)" }}>at</span>{" "}
                    {nameOf(g.home_team_id)}
                  </span>
                  <span style={{ color: "var(--muted)" }}>{g.field}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
