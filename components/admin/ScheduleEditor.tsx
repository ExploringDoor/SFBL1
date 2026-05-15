"use client";

// Admin schedule editor.
//
// Layout:
//   - Top bar: "+ Add Game" button, "🌧 Rain Out Day" quick action,
//     date filter (defaults to "upcoming + last 7 days").
//   - List grouped by date. Each game row collapses to an inline
//     edit form: date/time/teams/field/division/status/scores.
//   - Delete confirms with a hard prompt.
//
// Server contract:
//   POST /api/admin-schedule
//     { action: 'create' | 'update' | 'delete' | 'rain_out_day', ... }
//
// Why no separate "Reschedule" action: rescheduling is just an
// update of date/time. Doing it as one form keeps the UI flat.

import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { getDb } from "@/lib/firebase";

interface GameRow {
  id: string;
  date: string;
  time: string;
  field: string;
  away_team_id: string;
  home_team_id: string;
  division: string;
  status: string;
  away_score: number | null;
  home_score: number | null;
}

interface TeamOpt {
  id: string;
  name: string;
  division: string;
}

interface Props {
  leagueId: string;
  user: User;
}

const STATUSES = ["scheduled", "live", "postponed", "cancelled", "final", "approved"];

export function ScheduleEditor({ leagueId, user }: Props) {
  const [games, setGames] = useState<GameRow[]>([]);
  const [teams, setTeams] = useState<TeamOpt[]>([]);
  const [fields, setFields] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [divisionFilter, setDivisionFilter] = useState<string>("");
  const [searchTeam, setSearchTeam] = useState<string>("");

  // Inline edit / add state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showRainOut, setShowRainOut] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const db = getDb();
      const [gameSnap, teamSnap, leagueDoc, fieldsDoc] = await Promise.all([
        getDocs(collection(db, `leagues/${leagueId}/games`)),
        getDocs(collection(db, `leagues/${leagueId}/teams`)),
        // League config doc — older convention: a flat string array
        // at leagueData.fields. SFBL set this in lib/tenants.ts.
        getDoc(doc(db, `leagues/${leagueId}`)),
        // Newer convention (LBDC): rich field records at
        // /leagues/<id>/site_config/fields.data with {name, address,
        // mapsUrl, ...}. We extract just the names for the dropdown.
        // Either shape works — first non-empty list wins.
        getDoc(doc(db, `leagues/${leagueId}/site_config/fields`)),
      ]);
      const leagueData = leagueDoc.exists() ? leagueDoc.data() : null;
      let cfgFields = Array.isArray(leagueData?.fields)
        ? (leagueData!.fields as unknown[]).filter(
            (x): x is string => typeof x === "string" && x.length > 0,
          )
        : [];
      if (cfgFields.length === 0 && fieldsDoc.exists()) {
        const arr = fieldsDoc.data()?.data;
        if (Array.isArray(arr)) {
          cfgFields = arr
            .map((f) => {
              if (typeof f === "string") return f;
              if (f && typeof f === "object" && typeof f.name === "string") {
                return f.name;
              }
              return null;
            })
            .filter((s): s is string => !!s);
        }
      }
      // Stable, alphabetical so the dropdown reads consistently.
      cfgFields.sort((a, b) => a.localeCompare(b));
      setFields(cfgFields);
      setGames(
        gameSnap.docs
          .map((d) => {
            const data = d.data();
            // Game docs come from two sources with different shapes:
            //   • provision script: `date` = combined ISO datetime
            //     (e.g. "2026-02-15T14:30:00.000Z"), no `time` field.
            //     Need to parse and split into local-TZ date + time.
            //   • admin schedule editor: `date` = "YYYY-MM-DD",
            //     `time` = "HH:MM" stored separately.
            // splitDateTime handles both transparently.
            const { date, time } = splitDateTime(
              String(data.date ?? ""),
              String(data.time ?? ""),
            );
            return {
              id: d.id,
              date,
              time,
              field: String(data.field ?? ""),
              away_team_id: String(data.away_team_id ?? ""),
              home_team_id: String(data.home_team_id ?? ""),
              division: String(data.division ?? ""),
              status: String(data.status ?? "scheduled"),
              away_score:
                data.away_score == null ? null : Number(data.away_score),
              home_score:
                data.home_score == null ? null : Number(data.home_score),
            };
          })
          .sort((a, b) => {
            // Upcoming games on top, played games at the bottom —
            // admin spends 95% of their time editing what's still
            // ahead, not auditing the past. Within each group sort
            // by date+time ascending so 9:30 AM lines up before
            // 12:00 PM and earlier Sundays come before later ones.
            const aPast = a.status === "final" || a.status === "approved";
            const bPast = b.status === "final" || b.status === "approved";
            if (aPast !== bPast) return aPast ? 1 : -1;
            if (a.date !== b.date) return a.date < b.date ? -1 : 1;
            return a.time < b.time ? -1 : a.time > b.time ? 1 : 0;
          }),
      );
      setTeams(
        teamSnap.docs
          .map((d) => ({
            id: d.id,
            name: String(d.data().name ?? d.id),
            division: String(d.data().division ?? ""),
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  async function call(
    body: Record<string, unknown>,
    successMsg: string,
  ): Promise<boolean> {
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/admin-schedule", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ leagueId, ...body }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        affected?: number;
      };
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return false;
      }
      setSuccess(
        data.affected != null
          ? `${successMsg} (${data.affected} game${data.affected === 1 ? "" : "s"} affected)`
          : successMsg,
      );
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const teamName = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of teams) m.set(t.id, t.name);
    return (id: string) => m.get(id) ?? id;
  }, [teams]);

  const filteredGames = useMemo(() => {
    const search = searchTeam.toLowerCase().trim();
    return games.filter((g) => {
      if (statusFilter && g.status !== statusFilter) return false;
      if (divisionFilter && g.division !== divisionFilter) return false;
      if (search) {
        const home = teamName(g.home_team_id).toLowerCase();
        const away = teamName(g.away_team_id).toLowerCase();
        if (!home.includes(search) && !away.includes(search)) return false;
      }
      return true;
    });
  }, [games, statusFilter, divisionFilter, searchTeam, teamName]);

  // Group by date for display.
  const gamesByDate = useMemo(() => {
    const m = new Map<string, GameRow[]>();
    for (const g of filteredGames) {
      const d = g.date || "(no date)";
      if (!m.has(d)) m.set(d, []);
      m.get(d)!.push(g);
    }
    return m;
  }, [filteredGames]);

  const allDivisions = useMemo(() => {
    return Array.from(new Set(games.map((g) => g.division).filter(Boolean))).sort();
  }, [games]);

  return (
    <section className="space-y-3 rounded-md border border-slate-200 bg-white p-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <p className="font-semibold text-slate-900">Schedule</p>
          <p className="text-xs text-slate-600 mt-1">
            Add, edit, reschedule, or cancel games. Use Rain Out Day to
            postpone every game on a single date in one click.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={
              "/print/schedule" +
              (divisionFilter
                ? `?div=${encodeURIComponent(divisionFilter)}`
                : "")
            }
            target="_blank"
            rel="noopener"
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            📄 Export PDF
          </a>
          <button
            type="button"
            onClick={() => setShowRainOut(true)}
            className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-50"
          >
            🌧 Rain Out Day
          </button>
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110"
          >
            + Add Game
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <input
          type="text"
          value={searchTeam}
          onChange={(e) => setSearchTeam(e.target.value)}
          placeholder="Filter by team name…"
          className="rounded-md border border-slate-300 px-2 py-1.5 text-xs flex-1 min-w-[180px]"
        />
        <select
          value={divisionFilter}
          onChange={(e) => setDivisionFilter(e.target.value)}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-xs"
        >
          <option value="">All divisions</option>
          {allDivisions.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-xs"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <span className="text-slate-500">
          {filteredGames.length} of {games.length} games
        </span>
      </div>

      {error && (
        <p className="text-sm text-red-700 rounded bg-red-50 px-2 py-1 border border-red-200">
          {error}
        </p>
      )}
      {success && (
        <p className="text-sm text-emerald-700 rounded bg-emerald-50 px-2 py-1 border border-emerald-200">
          {success}
        </p>
      )}

      {showAdd && (
        <GameForm
          mode="create"
          teams={teams}
          fields={fields}
          busy={busy}
          onCancel={() => setShowAdd(false)}
          onSubmit={async (g) => {
            const ok = await call(
              { action: "create", game: g },
              `Added new game (${teamName(g.away_team_id ?? "")} @ ${teamName(g.home_team_id ?? "")})`,
            );
            if (ok) setShowAdd(false);
          }}
        />
      )}

      {showRainOut && (
        <RainOutForm
          busy={busy}
          onCancel={() => setShowRainOut(false)}
          onSubmit={async (date, notify) => {
            const ok = await call(
              { action: "rain_out_day", date, notify },
              `Rained out ${date}`,
            );
            if (ok) setShowRainOut(false);
          }}
        />
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading schedule…</p>
      ) : filteredGames.length === 0 ? (
        <p className="text-sm text-slate-500 italic">
          No games match the current filters.
        </p>
      ) : (
        <div className="space-y-3">
          {Array.from(gamesByDate.entries()).map(([date, list]) => (
            <div
              key={date}
              className="rounded-md border border-slate-200 overflow-hidden"
            >
              <div className="bg-slate-50 px-3 py-1.5 border-b border-slate-200 flex items-baseline justify-between">
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-700">
                  {formatDate(date)}
                </h3>
                <span className="text-xs text-slate-500">
                  {list.length} game{list.length === 1 ? "" : "s"}
                </span>
              </div>
              <ul className="divide-y divide-slate-200">
                {list.map((g) => (
                  <li key={g.id}>
                    <GameRowItem
                      game={g}
                      teamName={teamName}
                      isEditing={editingId === g.id}
                      busy={busy}
                      teams={teams}
                      fields={fields}
                      onToggleEdit={() =>
                        setEditingId(editingId === g.id ? null : g.id)
                      }
                      onSave={async (patch) => {
                        const ok = await call(
                          { action: "update", gameId: g.id, patch },
                          `Saved ${g.id}`,
                        );
                        if (ok) setEditingId(null);
                      }}
                      onDelete={async () => {
                        if (
                          !window.confirm(
                            `Delete game ${g.id} (${teamName(g.away_team_id)} @ ${teamName(g.home_team_id)})? This is permanent — use Cancel status instead if you want to keep the record.`,
                          )
                        )
                          return;
                        await call(
                          { action: "delete", gameId: g.id },
                          `Deleted ${g.id}`,
                        );
                      }}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Row + edit form ──────────────────────────────────────────────

function GameRowItem({
  game: g,
  teamName,
  teams,
  fields,
  isEditing,
  busy,
  onToggleEdit,
  onSave,
  onDelete,
}: {
  game: GameRow;
  teamName: (id: string) => string;
  teams: TeamOpt[];
  fields: string[];
  isEditing: boolean;
  busy: boolean;
  onToggleEdit: () => void;
  onSave: (patch: Partial<GameRow>) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const isFinal = g.status === "final" || g.status === "approved";
  const isPostponed = g.status === "postponed";
  const isCancelled = g.status === "cancelled";

  return (
    <>
      <div className="flex items-center gap-3 px-3 py-2 text-sm">
        <span className="text-xs font-mono text-slate-500 w-14 flex-shrink-0">
          {g.time || "—"}
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-slate-900 truncate">
            {teamName(g.away_team_id)}{" "}
            <span className="text-slate-400">@</span>{" "}
            {teamName(g.home_team_id)}
            {isFinal && (
              <span className="ml-2 font-mono text-slate-700">
                {g.away_score} – {g.home_score}
              </span>
            )}
          </div>
          <div className="text-xs text-slate-500 truncate">
            {g.field || "TBD"}
            {g.division ? ` · ${g.division}` : ""}
            {" · "}
            <StatusPill status={g.status} />
          </div>
        </div>
        <button
          type="button"
          onClick={onToggleEdit}
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          {isEditing ? "Close" : "Edit"}
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          className="rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          Delete
        </button>
      </div>
      {isEditing && (
        <GameForm
          mode="edit"
          initial={g}
          teams={teams}
          fields={fields}
          busy={busy}
          onCancel={onToggleEdit}
          onSubmit={async (patch) => {
            await onSave(patch);
          }}
        />
      )}
    </>
  );
}

function StatusPill({ status }: { status: string }) {
  const palette: Record<string, string> = {
    scheduled: "bg-blue-100 text-blue-800",
    live: "bg-red-100 text-red-800",
    final: "bg-emerald-100 text-emerald-800",
    approved: "bg-emerald-100 text-emerald-800",
    postponed: "bg-amber-100 text-amber-800",
    cancelled: "bg-slate-200 text-slate-700",
  };
  return (
    <span
      className={
        "inline-block rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider font-semibold " +
        (palette[status] ?? "bg-slate-100 text-slate-700")
      }
    >
      {status}
    </span>
  );
}

// ─── Add/Edit Game form ───────────────────────────────────────────

function GameForm({
  mode,
  initial,
  teams,
  fields,
  busy,
  onCancel,
  onSubmit,
}: {
  mode: "create" | "edit";
  initial?: GameRow;
  teams: TeamOpt[];
  fields: string[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (g: Partial<GameRow>) => Promise<void>;
}) {
  const [date, setDate] = useState(initial?.date ?? "");
  const [time, setTime] = useState(initial?.time ?? "");
  const [field, setField] = useState(initial?.field ?? "");
  const [awayId, setAwayId] = useState(initial?.away_team_id ?? "");
  const [homeId, setHomeId] = useState(initial?.home_team_id ?? "");
  const [division, setDivision] = useState(initial?.division ?? "");
  const [status, setStatus] = useState(initial?.status ?? "scheduled");
  const [awayScore, setAwayScore] = useState<string>(
    initial?.away_score == null ? "" : String(initial.away_score),
  );
  const [homeScore, setHomeScore] = useState<string>(
    initial?.home_score == null ? "" : String(initial.home_score),
  );

  // Auto-fill division from the picked teams (so admin doesn't have
  // to retype "28+" if both teams are in 28+).
  useEffect(() => {
    if (mode !== "create" || division) return;
    const home = teams.find((t) => t.id === homeId);
    if (home?.division) setDivision(home.division);
  }, [homeId, teams, mode, division]);

  const showScores = status === "final" || status === "approved";

  async function submit() {
    const patch: Partial<GameRow> = {
      date,
      time,
      field,
      away_team_id: awayId,
      home_team_id: homeId,
      division,
      status,
      away_score: showScores && awayScore !== "" ? Number(awayScore) : null,
      home_score: showScores && homeScore !== "" ? Number(homeScore) : null,
    };
    await onSubmit(patch);
  }

  return (
    <div className="border-t border-slate-200 bg-amber-50/40 px-3 py-3 space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="block text-xs font-semibold text-slate-700 mb-1">
            Date
          </span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={busy}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="block">
          <span className="block text-xs font-semibold text-slate-700 mb-1">
            Time
          </span>
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            disabled={busy}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="block">
          <span className="block text-xs font-semibold text-slate-700 mb-1">
            Field / location
          </span>
          {fields.length > 0 ? (
            <select
              value={field}
              onChange={(e) => setField(e.target.value)}
              disabled={busy}
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="">— pick a field —</option>
              {fields.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
              {/* If the saved field isn't in the configured list (e.g.
                  imported from an old CSV), surface it so the form
                  doesn't silently drop it on save. */}
              {field && !fields.includes(field) && (
                <option key="__custom" value={field}>
                  {field} (one-off)
                </option>
              )}
            </select>
          ) : (
            <input
              type="text"
              value={field}
              onChange={(e) => setField(e.target.value)}
              disabled={busy}
              placeholder="Flamingo Park"
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          )}
          {fields.length === 0 && (
            <span className="block text-xs text-slate-500 mt-1">
              No saved fields yet. Add some to <code>fields</code> on the
              league config (or use the Branding tab) to get a dropdown
              here.
            </span>
          )}
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="block text-xs font-semibold text-slate-700 mb-1">
            Away team
          </span>
          <select
            value={awayId}
            onChange={(e) => setAwayId(e.target.value)}
            disabled={busy}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="">— pick —</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs font-semibold text-slate-700 mb-1">
            Home team
          </span>
          <select
            value={homeId}
            onChange={(e) => setHomeId(e.target.value)}
            disabled={busy}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="">— pick —</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs font-semibold text-slate-700 mb-1">
            Division
          </span>
          <input
            type="text"
            value={division}
            onChange={(e) => setDivision(e.target.value)}
            disabled={busy}
            placeholder="28+"
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="block text-xs font-semibold text-slate-700 mb-1">
            Status
          </span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            disabled={busy}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        {showScores && (
          <>
            <label className="block">
              <span className="block text-xs font-semibold text-slate-700 mb-1">
                Away score
              </span>
              <input
                type="number"
                value={awayScore}
                onChange={(e) => setAwayScore(e.target.value)}
                disabled={busy}
                min={0}
                className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm font-mono"
              />
            </label>
            <label className="block">
              <span className="block text-xs font-semibold text-slate-700 mb-1">
                Home score
              </span>
              <input
                type="number"
                value={homeScore}
                onChange={(e) => setHomeScore(e.target.value)}
                disabled={busy}
                min={0}
                className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm font-mono"
              />
            </label>
          </>
        )}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={busy || (mode === "create" && (!date || !awayId || !homeId))}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Saving…" : mode === "create" ? "Create game" : "Save changes"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Rain Out Day quick action ────────────────────────────────────

function RainOutForm({
  busy,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (date: string, notify: boolean) => Promise<void>;
}) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notify, setNotify] = useState(true);

  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-3 space-y-3">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-bold text-amber-900">🌧 Rain Out Day</p>
      </div>
      <p className="text-xs text-amber-900">
        Marks every <strong>scheduled</strong> game on the chosen date as
        postponed. Final, cancelled, and already-postponed games are not
        touched. A single push notification goes to all subscribers.
      </p>
      <div className="flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
          Date
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={busy}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
          <input
            type="checkbox"
            checked={notify}
            onChange={(e) => setNotify(e.target.checked)}
            disabled={busy}
          />
          Send push notification
        </label>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onSubmit(date, notify)}
          disabled={busy || !date}
          className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Working…" : "Rain out this date"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── helpers ──────────────────────────────────────────────────────

function formatDate(yyyymmdd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(yyyymmdd)) return yyyymmdd;
  // Append T12:00 so timezone doesn't bump the date back/forward.
  const d = new Date(`${yyyymmdd}T12:00:00`);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Normalize a stored game date/time into UI-friendly local TZ
// strings. Handles both shapes:
//   • Combined ISO datetime in `dateRaw` ("2026-02-15T14:30:00Z"),
//     `timeRaw` empty → split via Date parse, return local YYYY-MM-DD
//     and HH:MM.
//   • Separate fields: `dateRaw` = "YYYY-MM-DD", `timeRaw` = "HH:MM"
//     → return as-is (after light validation).
function splitDateTime(
  dateRaw: string,
  timeRaw: string,
): { date: string; time: string } {
  const isCleanDate = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw);
  const isCleanTime = /^\d{1,2}:\d{2}$/.test(timeRaw);
  if (isCleanDate && isCleanTime) {
    return { date: dateRaw, time: timeRaw };
  }
  if (isCleanDate && !timeRaw) {
    return { date: dateRaw, time: "" };
  }
  // dateRaw has a time component (e.g. "2026-05-18T00:00:00.000Z").
  //
  // CRITICAL: if timeRaw is set, TRUST IT and just slice the YYYY-MM-DD
  // off dateRaw as plain text — DO NOT parse-as-Date, which would
  // re-interpret the ISO in the user's local timezone and silently
  // shift the date by a day for early-morning / late-night ISO
  // strings. Adam saw "Generals @ Black Sox should be 12 PM" but the
  // game came back as 5 PM because:
  //   dateRaw="2026-05-18T00:00:00.000Z" → UTC midnight May 18
  //   In Pacific (UTC-7) that's 5 PM May 17
  //   getHours() returns 17, getDate() returns 17
  //   → "2026-05-17" / "17:00"  ← wrong on BOTH axes
  // The fix: timeRaw="12:00" is the authoritative time, so we keep
  // it and ignore the bogus 00:00:00.000Z in dateRaw.
  if (isCleanTime) {
    return { date: dateRaw.slice(0, 10), time: timeRaw };
  }
  // Last-resort: timeRaw is empty AND dateRaw has a time component.
  // Parse-as-Date and use the local-time pieces (existing behaviour;
  // mostly hit for legacy data shipped from old DVSL imports).
  const d = new Date(dateRaw);
  if (Number.isNaN(d.getTime())) {
    return { date: dateRaw.slice(0, 10), time: timeRaw };
  }
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return { date: `${yyyy}-${mm}-${dd}`, time: `${hh}:${mi}` };
}
