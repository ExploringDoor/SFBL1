"use client";

// Admin schedule generator.
//
// Four steps, in the order a director actually thinks: who is playing, when the
// season runs, where the games go, and which matchups must never happen.
//
// Preview-then-commit throughout. The maths runs in the browser via
// lib/schedule-generator (pure, no I/O), so the table on screen IS the
// schedule — pressing Create writes exactly those rows. Nothing touches the
// live schedule until then, and existing games are never modified.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import {
  generateSchedule,
  DAY_NAMES,
  weekdayOf,
  type GeneratedGame,
  type GeneratorField,
  type GeneratorResult,
} from "@/lib/schedule-generator";

interface TeamOpt {
  id: string;
  name: string;
  ageGroup: string;
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
const BTN: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 8,
  border: "1px solid rgba(0,0,0,0.18)",
  background: "#fff",
  fontWeight: 700,
  cursor: "pointer",
};

// One tap for the times a league actually uses, with a picker for anything
// else. Typing "17:30, 19:00" into a text box was the old way.
const COMMON_TIMES = [
  "09:00",
  "10:30",
  "12:00",
  "13:30",
  "15:00",
  "16:30",
  "17:30",
  "18:00",
  "19:00",
  "19:30",
];

/** 24h "17:30" -> "5:30 PM", which is how a coach reads a schedule. */
function pretty(t: string): string {
  const [h, m] = t.split(":").map(Number);
  if (h == null || m == null) return t;
  const ampm = h >= 12 ? "PM" : "AM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${String(m).padStart(2, "0")} ${ampm}`;
}

function chip(on: boolean): React.CSSProperties {
  return {
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
  };
}

export function ScheduleGenerator({ leagueId, user }: Props) {
  const [teams, setTeams] = useState<TeamOpt[]>([]);
  const [leagueFields, setLeagueFields] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  // --- who ---------------------------------------------------------------
  const [ageGroup, setAgeGroup] = useState("");
  const [division, setDivision] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  // --- when --------------------------------------------------------------
  const [startDate, setStartDate] = useState("");
  const [useEndDate, setUseEndDate] = useState(true);
  const [endDate, setEndDate] = useState("");
  const [weeks, setWeeks] = useState(8);
  const [days, setDays] = useState<number[]>([]);
  const [offDates, setOffDates] = useState<string[]>([]);
  const [newOffDate, setNewOffDate] = useState("");
  const [gamesPerWeek, setGamesPerWeek] = useState(1);
  const [pairing, setPairing] = useState<"same-opponent" | "different-opponents">(
    "same-opponent",
  );

  // --- where -------------------------------------------------------------
  // Times are held as a real list, not a comma string the admin has to type.
  const [fields, setFields] = useState<{ name: string; times: string[] }[]>([
    { name: "", times: ["17:30"] },
  ]);
  const [lastBatch, setLastBatch] = useState<string | null>(null);

  // --- blocked pairs -----------------------------------------------------
  const [blocked, setBlocked] = useState<[string, string][]>([]);
  // Per-team scheduling settings: club, home field, dates they cannot play.
  const [teamCfg, setTeamCfg] = useState<
    Record<string, { organization?: string; homeField?: string; unavailable?: string[] }>
  >({});
  const [newUnavail, setNewUnavail] = useState<Record<string, string>>({});
  const [pendingTeam, setPendingTeam] = useState<string | null>(null);
  const [rulesSaved, setRulesSaved] = useState(false);

  const [result, setResult] = useState<GeneratorResult | null>(null);
  const reset = () => setResult(null);

  useEffect(() => {
    (async () => {
      try {
        const db = getDb();
        const [teamSnap, rulesSnap, fieldsSnap] = await Promise.all([
          getDocs(collection(db, `leagues/${leagueId}/teams`)),
          getDoc(doc(db, `leagues/${leagueId}/site_config/schedule_rules`)),
          getDoc(doc(db, `leagues/${leagueId}/site_config/fields`)),
        ]);
        const rows: TeamOpt[] = [];
        teamSnap.forEach((d) => {
          const t = d.data() as Record<string, unknown>;
          if (t.active === false) return;
          rows.push({
            id: d.id,
            name: String(t.name ?? d.id),
            ageGroup: String(t.ageGroup ?? ""),
            division: String(t.division ?? ""),
          });
        });
        rows.sort((a, b) => a.name.localeCompare(b.name));
        setTeams(rows);

        const arr = fieldsSnap.exists() ? fieldsSnap.data()?.data : null;
        if (Array.isArray(arr)) {
          setLeagueFields(
            arr
              .map((f: { name?: unknown }) => String(f?.name ?? "").trim())
              .filter(Boolean)
              .sort((a: string, b: string) => a.localeCompare(b)),
          );
        }
        const ts = rulesSnap.exists() ? rulesSnap.data()?.team_settings : null;
        if (ts && typeof ts === "object") setTeamCfg(ts as typeof teamCfg);
        const bp = rulesSnap.exists() ? rulesSnap.data()?.blocked_pairs : null;
        if (Array.isArray(bp)) {
          setBlocked(
            bp
              .filter((p: unknown) => Array.isArray(p) && p.length === 2)
              .map((p: string[]) => [String(p[0]), String(p[1])] as [string, string]),
          );
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
  }, [leagueId]);

  const ageGroups = useMemo(
    () => [...new Set(teams.map((t) => t.ageGroup).filter(Boolean))].sort(),
    [teams],
  );
  const divisions = useMemo(
    () => [...new Set(teams.map((t) => t.division).filter(Boolean))].sort(),
    [teams],
  );
  const shown = useMemo(
    () =>
      teams.filter(
        (t) =>
          (!ageGroup || t.ageGroup === ageGroup) &&
          (!division || t.division === division),
      ),
    [teams, ageGroup, division],
  );

  // Narrowing the filters re-picks that group; the admin can untick any.
  useEffect(() => {
    setPicked(new Set(shown.map((t) => t.id)));
    setResult(null);
  }, [shown]);

  // Default the game day to whatever weekday the start date is.
  useEffect(() => {
    if (startDate && days.length === 0) setDays([weekdayOf(startDate)]);
  }, [startDate, days.length]);

  const nameOf = useCallback(
    (id: string) => teams.find((t) => t.id === id)?.name ?? id,
    [teams],
  );

  function toggle<T>(list: T[], v: T): T[] {
    return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  }

  function pickForBlock(id: string) {
    setDone(null);
    setRulesSaved(false);
    if (pendingTeam === null) return setPendingTeam(id);
    if (pendingTeam === id) return setPendingTeam(null);
    const key = [pendingTeam, id].sort().join("|");
    setBlocked((cur) =>
      cur.some(([a, b]) => [a, b].sort().join("|") === key)
        ? cur
        : [...cur, [pendingTeam, id] as [string, string]],
    );
    setPendingTeam(null);
    reset();
  }

  async function post(body: Record<string, unknown>) {
    const token = await user.getIdToken();
    const res = await fetch("/api/admin-schedule-generate", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ leagueId, ...body }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new Error(String(data.error ?? `HTTP ${res.status}`));
    return data;
  }

  async function saveRules() {
    setBusy(true);
    setError(null);
    try {
      await post({ action: "save_rules", blockedPairs: blocked, teamSettings: teamCfg });
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
      .map((f) => ({ name: f.name.trim(), times: [...f.times].sort() }))
      .filter((f) => f.name && f.times.length > 0);

    if (!startDate) return setError("Pick the first game date.");
    if (useEndDate && !endDate) return setError("Pick the last game date.");
    if (genFields.length === 0) return setError("Add at least one field with a time.");
    if (picked.size < 2) return setError("Select at least two teams.");

    setResult(
      generateSchedule({
        teams: [...picked].map((id) => ({
          id,
          name: nameOf(id),
          organization: teamCfg[id]?.organization ?? null,
          homeField: teamCfg[id]?.homeField ?? null,
          unavailable: teamCfg[id]?.unavailable ?? [],
        })),
        startDate,
        ...(useEndDate ? { endDate } : { weeks }),
        daysOfWeek: days.length ? days : undefined,
        blackoutDates: offDates,
        fields: genFields,
        gamesPerWeek,
        weeklyPairing: pairing,
        blockedPairs: blocked,
        division: ageGroup || division || undefined,
      }),
    );
  }

  async function commit() {
    if (!result || result.games.length === 0) return;
    if (
      !window.confirm(
        `Create ${result.games.length} games on the live schedule?\n\n` +
          `Existing games are not touched.`,
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const data = await post({ action: "create_games", games: result.games });
      setDone(`Created ${data.created} games. They are live on the schedule now.`);
      if (typeof data.batch === "string") setLastBatch(data.batch);
      setResult(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create games");
    } finally {
      setBusy(false);
    }
  }

  const byWeek = useMemo(() => {
    const m = new Map<number, GeneratedGame[]>();
    (result?.games ?? []).forEach((g) => m.set(g.week, [...(m.get(g.week) ?? []), g]));
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [result]);

  if (loading) return <p style={{ color: "var(--muted)" }}>Loading…</p>;

  return (
    <section>
      <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 0, lineHeight: 1.6 }}>
        Builds a full season: everyone plays everyone at least once, across the days,
        fields and times you set. Nothing is written until you press Create.
      </p>

      {/* ---- 1. WHO ------------------------------------------------------ */}
      <div style={CARD}>
        <p style={{ fontWeight: 800, margin: "0 0 10px" }}>1. Teams</p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
          {ageGroups.length > 0 && (
            <div style={{ minWidth: 170 }}>
              <label style={LABEL}>Age group</label>
              <select style={INPUT} value={ageGroup} onChange={(e) => setAgeGroup(e.target.value)}>
                <option value="">All ages</option>
                {ageGroups.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
          )}
          {divisions.length > 0 && (
            <div style={{ minWidth: 170 }}>
              <label style={LABEL}>Division</label>
              <select style={INPUT} value={division} onChange={(e) => setDivision(e.target.value)}>
                <option value="">All divisions</option>
                {divisions.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
          )}
        </div>
        <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 8px" }}>
          {picked.size} of {shown.length} selected. Click to include or exclude.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {shown.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setPicked((cur) => {
                  const n = new Set(cur);
                  n.has(t.id) ? n.delete(t.id) : n.add(t.id);
                  return n;
                });
                reset();
              }}
              style={chip(picked.has(t.id))}
            >
              {t.name}
            </button>
          ))}
        </div>
      </div>

      {/* ---- 2. WHEN ----------------------------------------------------- */}
      <div style={CARD}>
        <p style={{ fontWeight: 800, margin: "0 0 10px" }}>2. When</p>

        <label style={LABEL}>Game days</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
          {DAY_NAMES.map((d, i) => (
            <button
              key={d}
              type="button"
              onClick={() => {
                setDays((cur) => toggle(cur, i));
                reset();
              }}
              style={chip(days.includes(i))}
            >
              {d.slice(0, 3)}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 12 }}>
          <div style={{ minWidth: 165 }}>
            <label style={LABEL}>First game date</label>
            <input
              type="date"
              style={INPUT}
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                reset();
              }}
            />
          </div>

          <div style={{ minWidth: 210 }}>
            <label style={LABEL}>Season ends</label>
            <div style={{ display: "flex", gap: 8 }}>
              <select
                style={{ ...INPUT, width: 120 }}
                value={useEndDate ? "date" : "weeks"}
                onChange={(e) => {
                  setUseEndDate(e.target.value === "date");
                  reset();
                }}
              >
                <option value="date">On a date</option>
                <option value="weeks">After N weeks</option>
              </select>
              {useEndDate ? (
                <input
                  type="date"
                  style={INPUT}
                  value={endDate}
                  onChange={(e) => {
                    setEndDate(e.target.value);
                    reset();
                  }}
                />
              ) : (
                <input
                  type="number"
                  min={1}
                  max={40}
                  style={{ ...INPUT, width: 90 }}
                  value={weeks}
                  onChange={(e) => {
                    setWeeks(Number(e.target.value) || 1);
                    reset();
                  }}
                />
              )}
            </div>
          </div>

          <div style={{ width: 140 }}>
            <label style={LABEL}>Games per week</label>
            <input
              type="number"
              min={1}
              max={4}
              style={INPUT}
              value={gamesPerWeek}
              onChange={(e) => {
                setGamesPerWeek(Number(e.target.value) || 1);
                reset();
              }}
            />
          </div>
          {gamesPerWeek > 1 && (
            <div style={{ minWidth: 220 }}>
              <label style={LABEL}>Those games are against</label>
              <select
                style={INPUT}
                value={pairing}
                onChange={(e) => {
                  setPairing(e.target.value as typeof pairing);
                  reset();
                }}
              >
                <option value="same-opponent">The same opponent (doubleheader)</option>
                <option value="different-opponents">Different opponents</option>
              </select>
            </div>
          )}
        </div>

        <label style={LABEL}>Off days (no games)</label>
        <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 8px" }}>
          Holidays, field closures, tournament weekends. The season stretches by a week
          rather than losing those games.
        </p>
        <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
          <input
            type="date"
            style={{ ...INPUT, width: 180 }}
            value={newOffDate}
            onChange={(e) => setNewOffDate(e.target.value)}
          />
          <button
            type="button"
            style={BTN}
            onClick={() => {
              if (!newOffDate) return;
              setOffDates((cur) => (cur.includes(newOffDate) ? cur : [...cur, newOffDate].sort()));
              setNewOffDate("");
              reset();
            }}
          >
            + Add off day
          </button>
        </div>
        {offDates.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {offDates.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => {
                  setOffDates((cur) => cur.filter((x) => x !== d));
                  reset();
                }}
                style={{
                  ...chip(false),
                  border: "1px solid rgba(200,16,46,0.4)",
                  color: "var(--red, #c8102e)",
                }}
                title="Remove"
              >
                {d} ✕
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ---- 3. WHERE ---------------------------------------------------- */}
      <div style={CARD}>
        <p style={{ fontWeight: 800, margin: "0 0 4px" }}>3. Fields and times</p>
        <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 10px" }}>
          Each field has its own start times, so a field that only runs one game a night
          is not given slots it does not have. Separate times with commas.
        </p>
        {fields.map((f, i) => (
          <div key={i} style={{ display: "flex", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
            {leagueFields.length > 0 ? (
              <select
                style={{ ...INPUT, flex: 2, minWidth: 220 }}
                value={f.name}
                onChange={(e) => {
                  const v = e.target.value;
                  setFields((cur) => cur.map((x, ix) => (ix === i ? { ...x, name: v } : x)));
                  reset();
                }}
              >
                <option value="">— Pick a field —</option>
                {leagueFields.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            ) : (
              <input
                placeholder="Field name"
                style={{ ...INPUT, flex: 2, minWidth: 200 }}
                value={f.name}
                onChange={(e) => {
                  const v = e.target.value;
                  setFields((cur) => cur.map((x, ix) => (ix === i ? { ...x, name: v } : x)));
                  reset();
                }}
              />
            )}
            <button
              type="button"
              style={BTN}
              onClick={() => {
                setFields((cur) => cur.filter((_, ix) => ix !== i));
                reset();
              }}
            >
              Remove field
            </button>

            {/* Times: tap the common ones, or add any time with the picker.
                No comma-separated typing. */}
            <div style={{ width: "100%", marginTop: 4 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                {COMMON_TIMES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      setFields((cur) =>
                        cur.map((x, ix) =>
                          ix === i
                            ? {
                                ...x,
                                times: x.times.includes(t)
                                  ? x.times.filter((y) => y !== t)
                                  : [...x.times, t].sort(),
                              }
                            : x,
                        ),
                      );
                      reset();
                    }}
                    style={{ ...chip(f.times.includes(t)), padding: "5px 10px", fontSize: 12 }}
                  >
                    {pretty(t)}
                  </button>
                ))}
                <input
                  type="time"
                  aria-label="Add another time"
                  style={{ ...INPUT, width: 120, padding: "5px 8px" }}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) return;
                    setFields((cur) =>
                      cur.map((x, ix) =>
                        ix === i && !x.times.includes(v)
                          ? { ...x, times: [...x.times, v].sort() }
                          : x,
                      ),
                    );
                    reset();
                  }}
                />
              </div>
              {f.times.length > 0 && (
                <p style={{ fontSize: 12, color: "var(--muted)", margin: "6px 0 0" }}>
                  {f.times.length} game{f.times.length === 1 ? "" : "s"} a day here:{" "}
                  {f.times.map(pretty).join(", ")}
                </p>
              )}
            </div>
          </div>
        ))}
        <button
          type="button"
          style={BTN}
          onClick={() => setFields((cur) => [...cur, { name: "", times: ["17:30"] }])}
        >
          + Add field
        </button>
      </div>

      {/* ---- 4. BLOCKED -------------------------------------------------- */}
      <div style={CARD}>
        <p style={{ fontWeight: 800, margin: "0 0 4px" }}>
          4. Teams that must not play each other
        </p>
        <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 10px" }}>
          Click one team, then the team it must never be drawn against. Repeat for as many
          pairs as you need. Saved with the league, so you set this once.
        </p>
        {pendingTeam && (
          <p style={{ fontSize: 13, fontWeight: 700, color: "var(--brand-primary, #002d6e)", margin: "0 0 8px" }}>
            {nameOf(pendingTeam)} selected. Now click the team it cannot play.{" "}
            <button
              type="button"
              onClick={() => setPendingTeam(null)}
              style={{ marginLeft: 6, border: "none", background: "none", textDecoration: "underline", cursor: "pointer", color: "var(--muted)" }}
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
                ...chip(false),
                border:
                  pendingTeam === t.id
                    ? "2px solid var(--brand-primary, #002d6e)"
                    : "1px solid rgba(0,0,0,0.18)",
                background: pendingTeam === t.id ? "rgba(0,45,110,0.08)" : "#fff",
              }}
            >
              {t.name}
            </button>
          ))}
        </div>

        {blocked.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 10px" }}>
            No blocked matchups yet.
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: "0 0 10px" }}>
            {blocked.map(([a, b], i) => (
              <li
                key={`${a}|${b}`}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid rgba(0,0,0,0.06)", fontSize: 14 }}
              >
                <span style={{ fontWeight: 700 }}>{nameOf(a)}</span>
                <span style={{ color: "var(--muted)" }}>cannot play</span>
                <span style={{ fontWeight: 700 }}>{nameOf(b)}</span>
                <button
                  type="button"
                  onClick={() => {
                    setBlocked((cur) => cur.filter((_, ix) => ix !== i));
                    setRulesSaved(false);
                    reset();
                  }}
                  style={{ marginLeft: "auto", border: "none", background: "none", color: "var(--red, #c8102e)", cursor: "pointer", fontWeight: 700 }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <button type="button" onClick={saveRules} disabled={busy} style={BTN}>
          {rulesSaved ? "Saved" : "Save these rules"}
        </button>
      </div>

      {/* ---- 5. PER-TEAM SETTINGS ---------------------------------------- */}
      <div style={CARD}>
        <p style={{ fontWeight: 800, margin: "0 0 4px" }}>5. Per-team settings</p>
        <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 12px" }}>
          Optional. A club name stops that club&rsquo;s own teams being drawn against
          each other, without listing every pair by hand. A home field pulls a
          team&rsquo;s games there and makes them the home side. Dates a team cannot play
          are skipped for them only, and the rest of the division still plays.
          Saved with the rules above.
        </p>

        <details>
          <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
            Set up teams ({Object.keys(teamCfg).length} configured)
          </summary>

          <div style={{ marginTop: 10 }}>
            {shown.map((t) => {
              const cfg = teamCfg[t.id] ?? {};
              const un = cfg.unavailable ?? [];
              const patch = (p: Partial<typeof cfg>) => {
                setTeamCfg((cur) => ({ ...cur, [t.id]: { ...(cur[t.id] ?? {}), ...p } }));
                setRulesSaved(false);
                reset();
              };
              return (
                <div
                  key={t.id}
                  style={{
                    padding: "10px 0",
                    borderBottom: "1px solid rgba(0,0,0,0.06)",
                  }}
                >
                  <p style={{ fontWeight: 700, fontSize: 14, margin: "0 0 6px" }}>{t.name}</p>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                    <div style={{ minWidth: 190 }}>
                      <label style={LABEL}>Club / organization</label>
                      <input
                        placeholder="e.g. Phoenix Fire"
                        style={INPUT}
                        value={cfg.organization ?? ""}
                        onChange={(e) => patch({ organization: e.target.value })}
                      />
                    </div>
                    <div style={{ minWidth: 220 }}>
                      <label style={LABEL}>Home field</label>
                      <select
                        style={INPUT}
                        value={cfg.homeField ?? ""}
                        onChange={(e) => patch({ homeField: e.target.value })}
                      >
                        <option value="">— None —</option>
                        {leagueFields.map((n) => (
                          <option key={n} value={n}>{n}</option>
                        ))}
                      </select>
                    </div>
                    <div style={{ minWidth: 200 }}>
                      <label style={LABEL}>Cannot play on</label>
                      <div style={{ display: "flex", gap: 6 }}>
                        <input
                          type="date"
                          style={{ ...INPUT, width: 150 }}
                          value={newUnavail[t.id] ?? ""}
                          onChange={(e) =>
                            setNewUnavail((c) => ({ ...c, [t.id]: e.target.value }))
                          }
                        />
                        <button
                          type="button"
                          style={BTN}
                          onClick={() => {
                            const d = newUnavail[t.id];
                            if (!d) return;
                            if (!un.includes(d)) patch({ unavailable: [...un, d].sort() });
                            setNewUnavail((c) => ({ ...c, [t.id]: "" }));
                          }}
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  </div>
                  {un.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {un.map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() =>
                            patch({ unavailable: un.filter((x) => x !== d) })
                          }
                          style={{
                            ...chip(false),
                            padding: "4px 10px",
                            fontSize: 12,
                            border: "1px solid rgba(200,16,46,0.4)",
                            color: "var(--red, #c8102e)",
                          }}
                          title="Remove"
                        >
                          {d} ✕
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </details>
      </div>

      {/* ---- build ------------------------------------------------------- */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={build}
          disabled={busy}
          style={{ padding: "11px 20px", borderRadius: 10, border: "none", background: "var(--brand-primary, #002d6e)", color: "#fff", fontWeight: 800, fontSize: 15, cursor: "pointer" }}
        >
          Build schedule
        </button>
        {result && result.games.length > 0 && (
          <button
            type="button"
            onClick={commit}
            disabled={busy}
            style={{ padding: "11px 20px", borderRadius: 10, border: "none", background: "var(--green, #22c55e)", color: "#fff", fontWeight: 800, fontSize: 15, cursor: "pointer" }}
          >
            {busy ? "Creating…" : `Create ${result.games.length} games`}
          </button>
        )}
      </div>

      {error && <p style={{ color: "var(--red, #c8102e)", fontWeight: 600 }}>{error}</p>}
      {done && (
        <div style={{ marginBottom: 12 }}>
          <p style={{ color: "var(--green, #22c55e)", fontWeight: 700, margin: "0 0 8px" }}>
            {done}
          </p>
          {lastBatch && (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                if (
                  !window.confirm(
                    "Undo this generation?\n\nIt removes only the games that run created. " +
                      "Anything you added by hand stays, and it refuses if any of them " +
                      "already have scores.",
                  )
                )
                  return;
                setBusy(true);
                setError(null);
                try {
                  const d = await post({ action: "undo_batch", batch: lastBatch });
                  setDone(`Removed ${d.deleted} games. You can build again.`);
                  setLastBatch(null);
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Undo failed");
                } finally {
                  setBusy(false);
                }
              }}
              style={{ ...BTN, borderColor: "rgba(200,16,46,0.4)", color: "var(--red, #c8102e)" }}
            >
              Undo this generation
            </button>
          )}
        </div>
      )}

      {/* ---- preview ----------------------------------------------------- */}
      {result && (
        <div style={CARD}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
            <p style={{ fontWeight: 800, margin: 0 }}>
              Preview · {result.games.length} games
              {result.everyPairPlayed && " · everyone plays everyone"}
            </p>
            <button
              type="button"
              style={{ ...BTN, marginLeft: "auto" }}
              onClick={() => {
                // Straight CSV so it opens in Excel or Google Sheets, and can
                // be printed or emailed to coaches before it goes live.
                const rows = [
                  ["Week", "Date", "Day", "Time", "Field", "Away", "Home"],
                  ...result.games.map((g) => [
                    String(g.week),
                    g.date,
                    DAY_NAMES[weekdayOf(g.date)] ?? "",
                    pretty(g.time),
                    g.field,
                    nameOf(g.away_team_id),
                    nameOf(g.home_team_id),
                  ]),
                ];
                const csv = rows
                  .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
                  .join("\n");
                const url = URL.createObjectURL(
                  new Blob([csv], { type: "text/csv;charset=utf-8;" }),
                );
                const a = document.createElement("a");
                a.href = url;
                a.download = `schedule-${ageGroup || division || "all"}-${startDate}.csv`;
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              Download CSV
            </button>
          </div>

          {/* Fairness at a glance: how many home games each team ends up with.
              Catches a lopsided draw before it goes live. */}
          {(() => {
            const home = new Map<string, number>();
            const total = new Map<string, number>();
            result.games.forEach((g) => {
              home.set(g.home_team_id, (home.get(g.home_team_id) ?? 0) + 1);
              total.set(g.home_team_id, (total.get(g.home_team_id) ?? 0) + 1);
              total.set(g.away_team_id, (total.get(g.away_team_id) ?? 0) + 1);
            });
            const rows = [...total.entries()].sort((a, b) => b[1] - a[1]);
            if (rows.length === 0) return null;
            return (
              <details style={{ marginBottom: 10 }}>
                <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
                  Games per team ({rows.length} teams)
                </summary>
                <div style={{ fontSize: 13, marginTop: 8 }}>
                  {rows.map(([id, n]) => (
                    <div
                      key={id}
                      style={{ display: "flex", gap: 10, padding: "3px 0", color: "var(--text-body)" }}
                    >
                      <span style={{ flex: 1 }}>{nameOf(id)}</span>
                      <span style={{ color: "var(--muted)" }}>
                        {n} games · {home.get(id) ?? 0} home · {n - (home.get(id) ?? 0)} away
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            );
          })()}

          {result.warnings.map((w, i) => (
            <p
              key={i}
              style={{ fontSize: 13, margin: "0 0 8px", padding: "9px 12px", borderRadius: 8, background: "rgba(245,166,35,0.12)", border: "1px solid rgba(245,166,35,0.4)", color: "#7a4b00" }}
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
              <p style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)", margin: "0 0 6px" }}>
                Week {wk} · {[...new Set(games.map((g) => g.date))].join(", ")}
              </p>
              {games.map((g, i) => (
                <div
                  key={i}
                  style={{ display: "flex", gap: 12, padding: "6px 0", fontSize: 14, borderBottom: "1px solid rgba(0,0,0,0.05)", flexWrap: "wrap" }}
                >
                  <span style={{ width: 92, color: "var(--muted)" }}>
                    {DAY_NAMES[weekdayOf(g.date)]?.slice(0, 3)} {g.time}
                  </span>
                  <span style={{ flex: 1, minWidth: 220 }}>
                    {nameOf(g.away_team_id)} <span style={{ color: "var(--muted)" }}>at</span>{" "}
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
