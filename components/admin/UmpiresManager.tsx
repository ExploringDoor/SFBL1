"use client";

// Umpire roster + game assignment.
//
// Two panels: the roster (who is available, where they travel, when they
// cannot work) and the assignment board (upcoming games, each with the
// officials who CAN take it).
//
// The dropdown only ever offers eligible umpires — available that date, willing
// to travel to that field, and not already working at that time — computed by
// lib/umpires, the same module the server validates against. Offering someone
// the UI knows is double-booked and then rejecting the save is a worse
// experience than not offering them.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import {
  eligibleUmpires,
  findUmpireIssues,
  assignmentCounts,
  type AssignableGame,
  type Umpire,
} from "@/lib/umpires";

interface Props {
  leagueId: string;
  user: User;
}

const BOX: React.CSSProperties = {
  border: "1px solid rgba(0,0,0,0.12)",
  borderRadius: 10,
  padding: 14,
  marginTop: 14,
  background: "#fff",
};
const INPUT: React.CSSProperties = {
  padding: "7px 9px",
  borderRadius: 8,
  border: "1px solid rgba(0,0,0,0.15)",
  fontSize: 13.5,
  fontFamily: "inherit",
  background: "#fff",
};
const BTN: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 9,
  border: "1px solid rgba(0,0,0,0.18)",
  background: "#fff",
  fontWeight: 700,
  fontSize: 13.5,
  cursor: "pointer",
  fontFamily: "inherit",
};
const LABEL: React.CSSProperties = {
  display: "block",
  fontSize: 11.5,
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  opacity: 0.62,
  marginBottom: 3,
};

export function UmpiresManager({ leagueId, user }: Props) {
  const [umpires, setUmpires] = useState<Umpire[]>([]);
  const [games, setGames] = useState<AssignableGame[]>([]);
  const [fields, setFields] = useState<string[]>([]);
  const [requiredPerGame, setRequiredPerGame] = useState(0);
  const [gameMinutes, setGameMinutes] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<Umpire>>({ name: "" });
  const [newDate, setNewDate] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const db = getDb();
      const [uSnap, gSnap, fSnap, cSnap] = await Promise.all([
        getDocs(collection(db, `leagues/${leagueId}/umpires`)),
        getDocs(collection(db, `leagues/${leagueId}/games`)),
        getDoc(doc(db, `leagues/${leagueId}/site_config/fields`)),
        getDoc(doc(db, `leagues/${leagueId}/site_config/umpires`)),
      ]);

      const us: Umpire[] = [];
      uSnap.forEach((d) => {
        const t = d.data() as Record<string, unknown>;
        us.push({
          id: d.id,
          name: String(t.name ?? d.id),
          level: t.level ? String(t.level) : "",
          email: t.email ? String(t.email) : "",
          phone: t.phone ? String(t.phone) : "",
          unavailable: Array.isArray(t.unavailable) ? (t.unavailable as string[]) : [],
          fields: Array.isArray(t.fields) ? (t.fields as string[]) : [],
          active: t.active !== false,
        });
      });
      us.sort((a, b) => a.name.localeCompare(b.name));
      setUmpires(us);

      const gs: AssignableGame[] = [];
      gSnap.forEach((d) => {
        const t = d.data() as Record<string, unknown>;
        const date = String(t.date ?? "").slice(0, 10);
        if (!date) return;
        gs.push({
          id: d.id,
          date,
          time: String(t.time ?? ""),
          field: String(t.field ?? ""),
          division: t.division ? String(t.division) : undefined,
          umpires: Array.isArray(t.umpires) ? (t.umpires as string[]) : [],
        });
      });
      gs.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? ""));
      setGames(gs);

      const arr = fSnap.exists() ? fSnap.data()?.data : null;
      if (Array.isArray(arr)) {
        setFields(
          arr
            .map((f: { name?: unknown }) => String(f?.name ?? "").trim())
            .filter(Boolean)
            .sort((a: string, b: string) => a.localeCompare(b)),
        );
      }
      if (cSnap.exists()) {
        setRequiredPerGame(Number(cSnap.data()?.required_per_game ?? 0) || 0);
        setGameMinutes(Number(cSnap.data()?.game_minutes ?? 0) || 0);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [leagueId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function post(body: Record<string, unknown>) {
    const token = await user.getIdToken();
    const res = await fetch("/api/admin-umpires", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ leagueId, ...body }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new Error(String(data.error ?? `HTTP ${res.status}`));
    return data;
  }

  async function act(body: Record<string, unknown>, msg: string) {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await post(body);
      setDone(msg);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  // Only games from today forward need assigning; a season of past games would
  // bury the ones that matter.
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = useMemo(
    () => games.filter((g) => g.date >= today).slice(0, 120),
    [games, today],
  );

  const issues = useMemo(
    () => findUmpireIssues(games, umpires, { gameMinutes, requiredPerGame }),
    [games, umpires, gameMinutes, requiredPerGame],
  );
  const counts = useMemo(() => assignmentCounts(umpires, games), [umpires, games]);

  if (loading) return <p style={{ color: "var(--muted)" }}>Loading…</p>;

  return (
    <section>
      <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6, marginTop: 0 }}>
        Keep the roster here, then assign officials to games. An umpire is only
        offered for a game they can actually work — free that night, willing to
        travel to that field, and not already booked at that time.
      </p>

      {error && <Msg tone="error">{error}</Msg>}
      {done && <Msg tone="ok">{done}</Msg>}

      {/* ── settings ─────────────────────────────────────────── */}
      <div style={BOX}>
        <p style={{ fontWeight: 800, margin: "0 0 10px" }}>Settings</p>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <label style={LABEL}>Umpires per game</label>
            <input
              type="number"
              min={0}
              max={6}
              value={requiredPerGame}
              onChange={(e) => setRequiredPerGame(Number(e.target.value))}
              style={{ ...INPUT, width: 90 }}
            />
          </div>
          <div>
            <label style={LABEL}>Game length (min)</label>
            <input
              type="number"
              min={0}
              max={360}
              value={gameMinutes}
              onChange={(e) => setGameMinutes(Number(e.target.value))}
              style={{ ...INPUT, width: 110 }}
            />
          </div>
          <button
            type="button"
            style={BTN}
            disabled={busy}
            onClick={() => act({ action: "settings", requiredPerGame, gameMinutes }, "Settings saved.")}
          >
            Save settings
          </button>
        </div>
        <p style={{ fontSize: 12, color: "var(--muted)", margin: "8px 0 0" }}>
          Game length is what catches back-to-back assignments. Leave it at 0 and
          only games starting at the exact same minute count as a clash.
        </p>
      </div>

      {/* ── problems ─────────────────────────────────────────── */}
      {issues.length > 0 && (
        <div style={{ ...BOX, borderColor: "rgba(220,38,38,0.4)" }}>
          <p style={{ fontWeight: 800, margin: "0 0 8px", color: "#7f1d1d" }}>
            {issues.filter((i) => i.severity === "error").length} problem
            {issues.filter((i) => i.severity === "error").length === 1 ? "" : "s"}
            {issues.some((i) => i.severity === "warning") &&
              ` · ${issues.filter((i) => i.severity === "warning").length} to check`}
          </p>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.65 }}>
            {issues.slice(0, 20).map((i, n) => (
              <li key={n} style={{ color: i.severity === "error" ? "#7f1d1d" : "#7a4b00" }}>
                {i.message}
              </li>
            ))}
          </ul>
          {issues.length > 20 && (
            <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>
              …and {issues.length - 20} more.
            </p>
          )}
        </div>
      )}

      {/* ── roster ───────────────────────────────────────────── */}
      <div style={BOX}>
        <p style={{ fontWeight: 800, margin: "0 0 10px" }}>
          Roster ({umpires.length})
        </p>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 14 }}>
          <div>
            <label style={LABEL}>Name</label>
            <input
              value={draft.name ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="Full name"
              style={{ ...INPUT, minWidth: 180 }}
            />
          </div>
          <div>
            <label style={LABEL}>Level</label>
            <input
              value={draft.level ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, level: e.target.value }))}
              placeholder="PIAA"
              style={{ ...INPUT, width: 110 }}
            />
          </div>
          <div>
            <label style={LABEL}>Email</label>
            <input
              value={draft.email ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
              style={{ ...INPUT, minWidth: 180 }}
            />
          </div>
          <div>
            <label style={LABEL}>Phone</label>
            <input
              value={draft.phone ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))}
              style={{ ...INPUT, width: 140 }}
            />
          </div>
          <button
            type="button"
            style={BTN}
            disabled={busy || !String(draft.name ?? "").trim()}
            onClick={async () => {
              await act({ action: "save_umpire", umpire: draft }, "Umpire added.");
              setDraft({ name: "" });
            }}
          >
            Add umpire
          </button>
        </div>
        <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 12px" }}>
          Contact details stay in the admin. They are never shown on the public
          site.
        </p>

        {counts.map(({ umpire: u, count }) => (
          <div
            key={u.id}
            style={{ padding: "10px 0", borderTop: "1px solid rgba(0,0,0,0.07)" }}
          >
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <strong style={{ fontSize: 14 }}>{u.name}</strong>
              {u.level && <Pill>{u.level}</Pill>}
              <Pill>{count} game{count === 1 ? "" : "s"}</Pill>
              {u.active === false && <Pill tone="off">inactive</Pill>}
              <button
                type="button"
                style={{ ...BTN, marginLeft: "auto", padding: "5px 10px", fontSize: 12.5 }}
                disabled={busy}
                onClick={() =>
                  act(
                    { action: "save_umpire", umpire: { ...u, active: u.active === false } },
                    u.active === false ? "Umpire reactivated." : "Umpire set inactive.",
                  )
                }
              >
                {u.active === false ? "Reactivate" : "Set inactive"}
              </button>
              <button
                type="button"
                style={{ ...BTN, padding: "5px 10px", fontSize: 12.5, color: "#7f1d1d" }}
                disabled={busy}
                onClick={() => {
                  if (
                    !window.confirm(
                      `Remove ${u.name}? They will also be taken off any games they are assigned to.`,
                    )
                  )
                    return;
                  void act({ action: "delete_umpire", umpireId: u.id }, "Umpire removed.");
                }}
              >
                Remove
              </button>
            </div>

            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 8 }}>
              <div style={{ minWidth: 230 }}>
                <label style={LABEL}>Covers these fields (none = all)</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, maxHeight: 80, overflowY: "auto" }}>
                  {fields.length === 0 && (
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>
                      Add fields in the Fields tab first.
                    </span>
                  )}
                  {fields.map((f) => {
                    const on = (u.fields ?? []).includes(f);
                    return (
                      <label
                        key={f}
                        style={{
                          fontSize: 12,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          border: "1px solid rgba(0,0,0,0.12)",
                          borderRadius: 999,
                          padding: "2px 8px",
                          cursor: "pointer",
                          background: on ? "var(--brand-primary,#14213d)" : "transparent",
                          color: on ? "#fff" : "inherit",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          style={{ margin: 0 }}
                          onChange={() => {
                            const cur = u.fields ?? [];
                            void act(
                              {
                                action: "save_umpire",
                                umpire: {
                                  ...u,
                                  fields: on ? cur.filter((x) => x !== f) : [...cur, f],
                                },
                              },
                              "Saved.",
                            );
                          }}
                        />
                        {f}
                      </label>
                    );
                  })}
                </div>
              </div>

              <div style={{ minWidth: 210 }}>
                <label style={LABEL}>Cannot work</label>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    type="date"
                    value={newDate[u.id] ?? ""}
                    onChange={(e) => setNewDate((c) => ({ ...c, [u.id]: e.target.value }))}
                    style={{ ...INPUT, width: 150 }}
                  />
                  <button
                    type="button"
                    style={BTN}
                    disabled={busy || !newDate[u.id]}
                    onClick={() => {
                      const d = newDate[u.id]!;
                      const cur = u.unavailable ?? [];
                      if (!cur.includes(d)) {
                        void act(
                          { action: "save_umpire", umpire: { ...u, unavailable: [...cur, d] } },
                          "Saved.",
                        );
                      }
                      setNewDate((c) => ({ ...c, [u.id]: "" }));
                    }}
                  >
                    Add
                  </button>
                </div>
                {(u.unavailable ?? []).length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
                    {(u.unavailable ?? []).map((d) => (
                      <button
                        key={d}
                        type="button"
                        title="Remove"
                        style={{ ...BTN, padding: "2px 8px", fontSize: 11.5 }}
                        onClick={() =>
                          act(
                            {
                              action: "save_umpire",
                              umpire: {
                                ...u,
                                unavailable: (u.unavailable ?? []).filter((x) => x !== d),
                              },
                            },
                            "Saved.",
                          )
                        }
                      >
                        {d} ×
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── assignment ───────────────────────────────────────── */}
      <div style={BOX}>
        <p style={{ fontWeight: 800, margin: "0 0 4px" }}>
          Assign games ({upcoming.length} upcoming)
        </p>
        <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 12px" }}>
          Only umpires who can actually work each game are listed.
        </p>
        {upcoming.length === 0 && (
          <p style={{ fontSize: 13, color: "var(--muted)" }}>No upcoming games.</p>
        )}
        {upcoming.map((g) => {
          const crew = (g.umpires ?? [])
            .map((id) => umpires.find((u) => u.id === id))
            .filter(Boolean) as Umpire[];
          const options = eligibleUmpires(g, umpires, games, { gameMinutes });
          const short = requiredPerGame > 0 && crew.length < requiredPerGame;
          return (
            <div
              key={g.id}
              style={{
                display: "flex",
                gap: 10,
                alignItems: "center",
                flexWrap: "wrap",
                padding: "8px 0",
                borderTop: "1px solid rgba(0,0,0,0.07)",
              }}
            >
              <span style={{ fontSize: 13, minWidth: 168, fontVariantNumeric: "tabular-nums" }}>
                <strong>{g.date}</strong> {g.time} · {g.field || "no field"}
              </span>
              <span style={{ display: "flex", gap: 5, flexWrap: "wrap", flex: "1 1 auto" }}>
                {crew.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    title="Remove from this game"
                    style={{ ...BTN, padding: "3px 9px", fontSize: 12.5 }}
                    disabled={busy}
                    onClick={() =>
                      act(
                        {
                          action: "assign",
                          gameId: g.id,
                          umpireIds: (g.umpires ?? []).filter((x) => x !== u.id),
                        },
                        "Updated.",
                      )
                    }
                  >
                    {u.name} ×
                  </button>
                ))}
                {crew.length === 0 && (
                  <span style={{ fontSize: 12.5, color: short ? "#7a4b00" : "var(--muted)" }}>
                    {short ? "needs an umpire" : "unassigned"}
                  </span>
                )}
              </span>
              <select
                value=""
                disabled={busy || options.length === 0}
                onChange={(e) => {
                  if (!e.target.value) return;
                  void act(
                    {
                      action: "assign",
                      gameId: g.id,
                      umpireIds: [...(g.umpires ?? []), e.target.value],
                    },
                    "Assigned.",
                  );
                }}
                style={{ ...INPUT, minWidth: 190 }}
              >
                <option value="">
                  {options.length === 0 ? "nobody available" : "+ add umpire…"}
                </option>
                {options.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                    {u.level ? ` (${u.level})` : ""}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Pill({ children, tone }: { children: React.ReactNode; tone?: "off" }) {
  return (
    <span
      style={{
        fontSize: 11.5,
        fontWeight: 700,
        padding: "2px 8px",
        borderRadius: 999,
        background: tone === "off" ? "rgba(0,0,0,0.06)" : "rgba(0,0,0,0.05)",
        opacity: tone === "off" ? 0.7 : 1,
      }}
    >
      {children}
    </span>
  );
}

function Msg({ tone, children }: { tone: "error" | "ok"; children: React.ReactNode }) {
  const err = tone === "error";
  return (
    <p
      style={{
        marginTop: 12,
        padding: "10px 13px",
        borderRadius: 9,
        fontSize: 13.5,
        background: err ? "rgba(220,38,38,0.08)" : "rgba(34,197,94,0.1)",
        border: `1px solid ${err ? "rgba(220,38,38,0.4)" : "rgba(34,197,94,0.4)"}`,
        color: err ? "#7f1d1d" : "#14532d",
      }}
    >
      {children}
    </p>
  );
}
