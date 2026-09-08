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
import { leagueToday } from "@/lib/format-time";
import {
  buildUmpirePreview,
  guessUmpireMapping,
  isImportableUmpire,
  looksBinarySpreadsheet,
  parseUmpireTable,
  UMPIRE_FIELD_LABEL,
  UMPIRE_FIELDS,
  type ParsedUmpireTable,
  type UmpireColumnMap,
  type UmpireField,
} from "@/lib/umpire-import";
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

interface TextMsg {
  umpireId: string;
  name: string;
  phone: string;
  games: number;
  text: string;
  chars: number;
  segments: number;
}

export function UmpiresManager({ leagueId, user }: Props) {
  const [umpires, setUmpires] = useState<Umpire[]>([]);
  const [games, setGames] = useState<AssignableGame[]>([]);
  const [fields, setFields] = useState<string[]>([]);
  const [requiredPerGame, setRequiredPerGame] = useState(0);
  const [gameMinutes, setGameMinutes] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mailMsg, setMailMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [mailWho, setMailWho] = useState("");
  const [texts, setTexts] = useState<TextMsg[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
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

  /**
   * Send umpires the games they are on.
   *
   * Mike asked for a button he can press once a night is settled: one umpire,
   * or everybody. Repeatable on purpose so a reshuffle can be re-sent.
   *
   * The message is truthful about what happened rather than encouraging. An
   * umpire with no address on file is counted and named in the result instead
   * of being quietly treated as sent, because "I emailed everyone" is the
   * thing an assignor will believe and act on.
   */
  async function emailAssignments(umpireId?: string) {
    setBusy(true);
    setError(null);
    setDone(null);
    setMailMsg(null);
    try {
      const r = (await post({
        action: "email_assignments",
        ...(umpireId ? { umpireIds: [umpireId] } : {}),
      })) as { sent?: number; noEmail?: number; none?: boolean };
      const sent = Number(r.sent ?? 0);
      const noEmail = Number(r.noEmail ?? 0);
      if (r.none) {
        setMailMsg({
          ok: false,
          text: umpireId
            ? "That umpire is not on any upcoming games."
            : "Nobody is assigned to an upcoming game yet.",
        });
      } else if (sent === 0) {
        setMailMsg({
          ok: false,
          text:
            noEmail > 0
              ? `Nothing sent. ${noEmail} umpire${noEmail === 1 ? " has" : "s have"} no email address on file.`
              : "Nothing sent.",
        });
      } else {
        setMailMsg({
          ok: true,
          text:
            `Emailed ${sent} umpire${sent === 1 ? "" : "s"} their assignments.` +
            (noEmail > 0
              ? ` ${noEmail} skipped with no email address on file.`
              : ""),
        });
      }
    } catch (e) {
      setMailMsg({ ok: false, text: e instanceof Error ? e.message : "Could not send." });
    } finally {
      setBusy(false);
    }
  }

  /**
   * Build the texts, do not send them.
   *
   * Mike texts from his own phone, from the number the umpires already know
   * and reply to. Sending SMS from the platform would need a Twilio number
   * and 10DLC registration, and replies would land nowhere. So this composes
   * the message and hands it over to copy, which is what he asked for.
   */
  async function loadTexts() {
    setBusy(true);
    setError(null);
    setDone(null);
    setMailMsg(null);
    try {
      const r = (await post({ action: "assignment_texts" })) as { messages?: TextMsg[] };
      setTexts(Array.isArray(r.messages) ? r.messages : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build the texts.");
    } finally {
      setBusy(false);
    }
  }

  async function copyText(m: TextMsg) {
    try {
      await navigator.clipboard.writeText(m.text);
      setCopied(m.umpireId);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      setError("Could not reach the clipboard. Select the message and copy it by hand.");
    }
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
  // bury the ones that matter. "Today" is the LEAGUE's calendar day: the UTC
  // day rolls over at 8pm Eastern, which dropped that evening's games off the
  // assignment board while they were still being played.
  const today = leagueToday();
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

        <div
          style={{
            border: "1px solid var(--border, rgba(0,0,0,0.12))",
            borderRadius: 8,
            padding: 12,
            margin: "0 0 16px",
          }}
        >
          <strong style={{ fontSize: 14 }}>Email assignments</strong>
          <p style={{ fontSize: 12, color: "var(--muted)", margin: "6px 0 10px" }}>
            Sends each umpire the upcoming games they are on. Everyone only ever sees their own
            games. Safe to send again after you move things around.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <button
              type="button"
              style={BTN}
              disabled={busy}
              onClick={() => void emailAssignments()}
            >
              Email everyone their assignments
            </button>
            <select
              value={mailWho}
              onChange={(e) => setMailWho(e.target.value)}
              style={INPUT}
              aria-label="Umpire to email"
            >
              <option value="">One umpire…</option>
              {umpires.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                  {u.email ? "" : " (no email)"}
                </option>
              ))}
            </select>
            <button
              type="button"
              style={BTN}
              disabled={busy || !mailWho}
              onClick={() => void emailAssignments(mailWho)}
            >
              Email just them
            </button>
          </div>
          {mailMsg && (
            <p style={{ fontSize: 12, marginTop: 8, color: mailMsg.ok ? "#047857" : "#b91c1c" }}>
              {mailMsg.text}
            </p>
          )}

          <div style={{ borderTop: "1px solid rgba(0,0,0,0.08)", marginTop: 12, paddingTop: 10 }}>
            <button type="button" style={BTN} disabled={busy} onClick={() => void loadTexts()}>
              {texts ? "Rebuild texts" : "Text messages to copy"}
            </button>
            <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: 8 }}>
              writes each umpire&rsquo;s text for you to send from your own phone
            </span>

            {texts && texts.length === 0 && (
              <p style={{ fontSize: 12, color: "#b91c1c", marginTop: 8 }}>
                Nobody is assigned to an upcoming game yet.
              </p>
            )}

            {texts && texts.length > 0 && (
              <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                {texts.map((m) => (
                  <div
                    key={m.umpireId}
                    style={{
                      border: "1px solid rgba(0,0,0,0.10)",
                      borderRadius: 6,
                      padding: 8,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 8,
                        alignItems: "center",
                        marginBottom: 6,
                      }}
                    >
                      <strong style={{ fontSize: 13 }}>{m.name}</strong>
                      {m.phone ? (
                        <a href={`sms:${m.phone.replace(/[^\d+]/g, "")}`} style={{ fontSize: 12 }}>
                          {m.phone}
                        </a>
                      ) : (
                        <span style={{ fontSize: 12, color: "#b91c1c" }}>no phone on file</span>
                      )}
                      <span style={{ fontSize: 11, color: "var(--muted)" }}>
                        {m.games} game{m.games === 1 ? "" : "s"} · {m.chars} chars ·{" "}
                        {m.segments} text{m.segments === 1 ? "" : "s"}
                      </span>
                      <button type="button" style={BTN} onClick={() => void copyText(m)}>
                        {copied === m.umpireId ? "Copied" : "Copy"}
                      </button>
                    </div>
                    <pre
                      style={{
                        whiteSpace: "pre-wrap",
                        fontFamily: "ui-monospace, monospace",
                        fontSize: 12,
                        margin: 0,
                        background: "rgba(0,0,0,0.03)",
                        borderRadius: 4,
                        padding: 8,
                      }}
                    >
                      {m.text}
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <ImportUmpires
          existing={umpires}
          busy={busy}
          onImport={async (rows) => {
            const r = (await post({ action: "import_umpires", umpires: rows })) as {
              imported?: number;
            };
            await load();
            return Number(r.imported ?? 0);
          }}
        />

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


/**
 * Bulk-add a roster.
 *
 * Columns are matched by HEADING, never by position. A positional importer
 * reads a real Arbiter or Assignr export silently wrong, and "silently" is
 * the problem: the assignor gets a roster full of people whose phone is in
 * the level field and no error to tell them. The guess is shown and can be
 * corrected before anything is written.
 */
function ImportUmpires({
  existing,
  busy,
  onImport,
}: {
  existing: { name?: string | null; email?: string | null }[];
  busy: boolean;
  onImport: (rows: { name: string; email: string; phone: string; level: string }[]) => Promise<number>;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [table, setTable] = useState<ParsedUmpireTable | null>(null);
  const [map, setMap] = useState<UmpireColumnMap | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [working, setWorking] = useState(false);

  const preview = table && map ? buildUmpirePreview(table.rows, map, existing) : [];
  const ready = preview.filter(isImportableUmpire);
  const skipped = preview.filter((p) => p.skip).length;
  const unnamed = preview.filter((p) => p.problems.length > 0).length;

  function ingest(raw: string) {
    setText(raw);
    setMsg(null);
    if (!raw.trim()) {
      setTable(null);
      setMap(null);
      return;
    }
    if (looksBinarySpreadsheet(raw)) {
      setTable(null);
      setMap(null);
      setMsg({
        ok: false,
        text: "That is an Excel file, which cannot be read directly. In Excel: File, then Save As, then CSV. Or select the cells in Excel and paste them into the box below, which works as-is.",
      });
      return;
    }
    const parsed = parseUmpireTable(raw);
    setTable(parsed);
    setMap(guessUmpireMapping(parsed.headers, parsed.hadHeader));
  }

  function readFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => ingest(String(reader.result));
    reader.readAsText(file);
  }

  return (
    <div
      style={{
        border: "1px solid var(--border, rgba(0,0,0,0.12))",
        borderRadius: 8,
        padding: 12,
        margin: "0 0 16px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <strong style={{ fontSize: 14 }}>Import a roster</strong>
        <button type="button" style={BTN} onClick={() => setOpen((o) => !o)}>
          {open ? "Hide" : "Show"}
        </button>
      </div>

      {open && (
        <>
          <p style={{ fontSize: 12, color: "var(--muted)", margin: "8px 0" }}>
            Drop a CSV from Arbiter, Assignr or a spreadsheet, or paste the cells straight out of
            Excel. Column order does not matter. Anyone already on your list is skipped.
          </p>

          <input
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/plain"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) readFile(f);
            }}
            style={{ fontSize: 12, marginBottom: 8 }}
          />

          <textarea
            rows={5}
            placeholder={"Name, Email, Phone, Level\nJane Doe, jane@example.com, 516-555-0132, Senior"}
            value={text}
            onChange={(e) => ingest(e.target.value)}
            style={{ ...INPUT, width: "100%", fontFamily: "ui-monospace, monospace", fontSize: 12 }}
          />

          {table && table.rows.length > 0 && map && (
            <>
              {!table.hadHeader && (
                <p style={{ fontSize: 12, color: "var(--muted)", margin: "6px 0" }}>
                  No column headings found, so these are being read in order. Check the matches
                  below.
                </p>
              )}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                  gap: 8,
                  margin: "8px 0",
                }}
              >
                {UMPIRE_FIELDS.map((f: UmpireField) => (
                  <label key={f} style={{ fontSize: 12 }}>
                    {UMPIRE_FIELD_LABEL[f]}
                    <select
                      value={map[f]}
                      onChange={(e) => setMap({ ...map, [f]: e.target.value })}
                      style={{ ...INPUT, width: "100%" }}
                    >
                      <option value="">— none —</option>
                      {table.headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>

              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ textAlign: "left" }}>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Phone</th>
                      <th>Level</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {preview.slice(0, 12).map((r, i) => (
                      <tr key={i} style={{ opacity: isImportableUmpire(r) ? 1 : 0.55 }}>
                        <td>{r.name || "—"}</td>
                        <td>{r.email || "—"}</td>
                        <td>{r.phone || "—"}</td>
                        <td>{r.level || "—"}</td>
                        <td style={{ color: r.problems.length > 0 ? "#b91c1c" : "var(--muted)" }}>
                          {r.problems.length > 0 ? r.problems.join(", ") : r.notes.join(", ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.length > 12 && (
                <p style={{ fontSize: 12, color: "var(--muted)" }}>
                  …and {preview.length - 12} more.
                </p>
              )}

              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>
                  {ready.length} to add
                  {skipped > 0 ? ` · ${skipped} already on your list` : ""}
                  {unnamed > 0 ? ` · ${unnamed} with no name` : ""}
                </span>
                <button
                  type="button"
                  style={BTN}
                  disabled={busy || working || ready.length === 0}
                  onClick={async () => {
                    setWorking(true);
                    setMsg(null);
                    try {
                      const n = await onImport(
                        ready.map((r) => ({
                          name: r.name,
                          email: r.email,
                          phone: r.phone,
                          level: r.level,
                        })),
                      );
                      setText("");
                      setTable(null);
                      setMap(null);
                      setMsg({
                        ok: true,
                        text: `Added ${n} umpire${n === 1 ? "" : "s"}.${
                          skipped > 0 ? ` ${skipped} already on your list, skipped.` : ""
                        }`,
                      });
                    } catch (e) {
                      setMsg({ ok: false, text: e instanceof Error ? e.message : "Failed" });
                    } finally {
                      setWorking(false);
                    }
                  }}
                >
                  Import {ready.length} umpire{ready.length === 1 ? "" : "s"}
                </button>
              </div>
            </>
          )}

          {msg && (
            <p style={{ fontSize: 12, marginTop: 8, color: msg.ok ? "#047857" : "#b91c1c" }}>
              {msg.text}
            </p>
          )}
        </>
      )}
    </div>
  );
}
