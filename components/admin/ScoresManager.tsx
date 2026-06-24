"use client";

// Admin Scores tab — fast lane for entering final scores.
//
// Two affordances on one screen:
//
//   1. Quick Scores grid — table of games (default: scheduled +
//      recent un-finalized) with two score inputs per row. Type
//      both, hit Enter, row commits. Or "Save all changes" at the
//      bottom for batch commit. Mirrors DVSL's admin scoring grid.
//
//   2. Conflict resolution — when a game has both home and away
//      captain submissions and they disagree, the row gets a red
//      "Conflict" badge with both submitted scores side-by-side.
//      Admin clicks "Use [side]" to promote that captain's
//      submission as authoritative.
//
// Sits alongside the existing paths:
//   - /captain/box-score  (full lineup + per-batter stats)
//   - /captain/box-score  (score-only toggle)
//   - /admin → Schedule → Edit (per-game inline)
// Five total ways to land scores on a game doc.

import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { formatTime12 } from "@/lib/format-time";
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
  // Captain submissions (if any) for conflict detection.
  away_submission?: { score_away: number; score_home: number } | null;
  home_submission?: { score_away: number; score_home: number } | null;
  has_conflict?: boolean;
}

interface TeamOpt {
  id: string;
  name: string;
}

interface Props {
  leagueId: string;
  user: User;
}

type Filter = "needs_score" | "all" | "conflicts";

export function ScoresManager({ leagueId, user }: Props) {
  const [games, setGames] = useState<GameRow[]>([]);
  const [teams, setTeams] = useState<TeamOpt[]>([]);
  const [drafts, setDrafts] = useState<
    Record<string, { away: string; home: string }>
  >({});
  const [busy, setBusy] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("needs_score");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const db = getDb();
      const [gameSnap, teamSnap, subsSnap] = await Promise.all([
        getDocs(collection(db, `leagues/${leagueId}/games`)),
        getDocs(collection(db, `leagues/${leagueId}/teams`)),
        getDocs(collection(db, `leagues/${leagueId}/box_score_submissions`)),
      ]);
      setTeams(
        teamSnap.docs
          .map((d) => ({ id: d.id, name: String(d.data().name ?? d.id) }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
      // Index submissions by game id for conflict detection.
      const subsByGame = new Map<
        string,
        { away?: { score_away: number; score_home: number }; home?: { score_away: number; score_home: number } }
      >();
      for (const d of subsSnap.docs) {
        const data = d.data();
        const gameId = String(data.game_id ?? "");
        const side = String(data.side ?? "");
        if (!gameId || (side !== "away" && side !== "home")) continue;
        // Submissions store the own-side score in `score`/`final_score`
        // (keyed by `side`) and the opponent's in `opp_final_score` or the
        // sum of `opp_linescore` — NOT away_score/home_score. Reading the
        // phantom fields made every submission NaN→skip, so conflicts were
        // never detected and the "Use [side]" buttons never rendered
        // (audit H4).
        const ownScore = Number(data.score ?? data.final_score);
        let oppScore = Number(data.opp_final_score);
        if (
          !Number.isFinite(oppScore) &&
          Array.isArray(data.opp_linescore) &&
          data.opp_linescore.length
        ) {
          oppScore = (data.opp_linescore as unknown[]).reduce(
            (acc: number, n) => acc + Number(n || 0),
            0,
          );
        }
        const aScore = side === "away" ? ownScore : oppScore;
        const hScore = side === "home" ? ownScore : oppScore;
        if (!Number.isFinite(aScore) || !Number.isFinite(hScore)) continue;
        const cur = subsByGame.get(gameId) ?? {};
        cur[side] = { score_away: aScore, score_home: hScore };
        subsByGame.set(gameId, cur);
      }

      const rows = gameSnap.docs.map((d): GameRow => {
        const data = d.data();
        const rawDate = String(data.date ?? "");
        const date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
          ? rawDate
          : rawDate.slice(0, 10);
        const subs = subsByGame.get(d.id);
        const away = subs?.away ?? null;
        const home = subs?.home ?? null;
        const hasConflict =
          !!away &&
          !!home &&
          (away.score_away !== home.score_away ||
            away.score_home !== home.score_home);
        return {
          id: d.id,
          date,
          time: String(data.time ?? ""),
          field: String(data.field ?? ""),
          away_team_id: String(data.away_team_id ?? ""),
          home_team_id: String(data.home_team_id ?? ""),
          division: String(data.division ?? ""),
          status: String(data.status ?? "scheduled"),
          away_score:
            data.away_score == null ? null : Number(data.away_score),
          home_score:
            data.home_score == null ? null : Number(data.home_score),
          away_submission: away,
          home_submission: home,
          has_conflict: hasConflict,
        };
      });
      // Sort: conflicts first (always — they need resolution),
      // then upcoming games (status != final/approved) ascending so
      // the very next game is on top and you walk forward through
      // the season, then played games at the bottom also ascending.
      // Mirrors the admin schedule + public /schedule ordering Adam
      // wants everywhere.
      rows.sort((a, b) => {
        if (a.has_conflict !== b.has_conflict) {
          return a.has_conflict ? -1 : 1;
        }
        const aPast = a.status === "final" || a.status === "approved";
        const bPast = b.status === "final" || b.status === "approved";
        if (aPast !== bPast) return aPast ? 1 : -1;
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        return a.time < b.time ? -1 : a.time > b.time ? 1 : 0;
      });
      setGames(rows);
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

  const teamName = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of teams) m.set(t.id, t.name);
    return (id: string) => m.get(id) ?? id;
  }, [teams]);

  const filtered = useMemo(() => {
    return games.filter((g) => {
      if (filter === "conflicts") return g.has_conflict;
      if (filter === "needs_score") {
        // Anything that isn't a clean final.
        if (g.status === "final" || g.status === "approved") {
          // Show if there's a conflict that needs resolving.
          return g.has_conflict;
        }
        if (g.status === "cancelled") return false;
        return true; // scheduled + postponed + draft etc.
      }
      return true;
    });
  }, [games, filter]);

  function setDraft(gameId: string, side: "away" | "home", value: string) {
    setDrafts((cur) => ({
      ...cur,
      [gameId]: {
        away: side === "away" ? value : (cur[gameId]?.away ?? ""),
        home: side === "home" ? value : (cur[gameId]?.home ?? ""),
      },
    }));
  }

  function effectiveScore(g: GameRow, side: "away" | "home"): string {
    const draft = drafts[g.id];
    if (draft && draft[side] !== "") return draft[side];
    if (draft && draft[side] === "") return "";
    const cur = side === "away" ? g.away_score : g.home_score;
    return cur == null ? "" : String(cur);
  }

  async function saveOne(g: GameRow) {
    const draft = drafts[g.id];
    const aScore = draft?.away !== undefined ? Number(draft.away) : g.away_score;
    const hScore = draft?.home !== undefined ? Number(draft.home) : g.home_score;
    if (!Number.isFinite(aScore) || !Number.isFinite(hScore)) {
      setError(`Both scores required for ${g.id}`);
      return;
    }
    setSavingId(g.id);
    setError(null);
    setSuccess(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/admin-score-quick", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          leagueId,
          updates: [
            {
              gameId: g.id,
              away_score: aScore,
              home_score: hScore,
              status: "final",
            },
          ],
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        errors?: { gameId: string; error: string }[];
      };
      if (!res.ok) {
        setError(data.errors?.[0]?.error ?? "Save failed");
        return;
      }
      setSuccess(
        `Saved ${teamName(g.away_team_id)} ${aScore} – ${hScore} ${teamName(g.home_team_id)}`,
      );
      // Clear draft for this game so the new value flows from server data.
      setDrafts((cur) => {
        const next = { ...cur };
        delete next[g.id];
        return next;
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSavingId(null);
    }
  }

  async function saveAll() {
    const updates = Object.entries(drafts)
      .filter(([, d]) => d.away !== "" && d.home !== "")
      .map(([gameId, d]) => ({
        gameId,
        away_score: Number(d.away),
        home_score: Number(d.home),
        status: "final" as const,
      }))
      .filter(
        (u) => Number.isFinite(u.away_score) && Number.isFinite(u.home_score),
      );
    if (updates.length === 0) {
      setError("Type at least one full pair (away + home) before Save all.");
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/admin-score-quick", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ leagueId, updates }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        written?: string[];
        errors?: { gameId: string; error: string }[];
      };
      if (!res.ok && data.errors?.length) {
        setError(`${data.errors.length} errors. First: ${data.errors[0]!.error}`);
        return;
      }
      setSuccess(
        `Saved ${data.written?.length ?? 0} game${
          data.written?.length === 1 ? "" : "s"
        }.`,
      );
      setDrafts({});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function resolveConflict(g: GameRow, side: "away" | "home") {
    const sub =
      side === "away" ? g.away_submission : g.home_submission;
    if (!sub) return;
    const sideName =
      side === "away" ? teamName(g.away_team_id) : teamName(g.home_team_id);
    if (
      !window.confirm(
        `Use ${sideName}'s submission (${sub.score_away}-${sub.score_home}) as the official score?`,
      )
    )
      return;
    setSavingId(g.id);
    setError(null);
    setSuccess(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/admin-score-quick", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          leagueId,
          action: "use_submission",
          gameId: g.id,
          side,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Resolve failed");
        return;
      }
      setSuccess(`Resolved ${g.id} using ${sideName}'s score.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Resolve failed");
    } finally {
      setSavingId(null);
    }
  }

  const conflictCount = games.filter((g) => g.has_conflict).length;
  const needsScoreCount = games.filter(
    (g) =>
      g.status !== "final" &&
      g.status !== "approved" &&
      g.status !== "cancelled",
  ).length;

  return (
    <section className="space-y-3 rounded-md border border-slate-200 bg-white p-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <p className="font-semibold text-slate-900">Quick scores</p>
          <p className="text-xs text-slate-600 mt-1 leading-relaxed">
            Fastest way to land final scores: type both numbers, hit
            Enter, move on. {needsScoreCount} game{needsScoreCount === 1 ? "" : "s"}{" "}
            still need a score
            {conflictCount > 0 && `, ${conflictCount} captain conflict${conflictCount === 1 ? "" : "s"} to resolve`}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as Filter)}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-xs"
          >
            <option value="needs_score">Needs score / has conflict</option>
            <option value="conflicts">Conflicts only</option>
            <option value="all">All games</option>
          </select>
        </div>
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

      {loading ? (
        <p className="text-sm text-slate-500">Loading games…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-slate-500 italic">
          {filter === "conflicts"
            ? "No conflicts. ✓"
            : filter === "needs_score"
              ? "All scores entered. ✓"
              : "No games."}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-500 uppercase tracking-wider text-[10px] border-b border-slate-200">
                  <th className="text-left py-2 pr-2">Date</th>
                  <th className="text-left py-2 pr-2">Matchup</th>
                  <th className="text-center py-2 px-2 w-20">Away</th>
                  <th className="text-center py-2 px-2 w-20">Home</th>
                  <th className="text-left py-2 pl-2">Status / Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((g) => (
                  <tr
                    key={g.id}
                    className={
                      "border-b border-slate-100 " +
                      (g.has_conflict ? "bg-red-50/50" : "")
                    }
                  >
                    <td className="py-2 pr-2 text-xs text-slate-600 font-mono">
                      {g.date}
                      {g.time && (
                        <div className="text-[10px] text-slate-400">
                          {formatTime12(g.time)}
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-2">
                      <div className="font-semibold text-slate-900">
                        {teamName(g.away_team_id)}{" "}
                        <span className="text-slate-400">@</span>{" "}
                        {teamName(g.home_team_id)}
                      </div>
                      {g.field && (
                        <div className="text-xs text-slate-500">
                          {g.field}
                        </div>
                      )}
                      {g.has_conflict && (
                        <div className="mt-1 flex flex-wrap items-center gap-1 text-xs">
                          <span className="rounded bg-red-100 text-red-800 px-1.5 py-0.5 font-bold uppercase tracking-wider text-[10px]">
                            ⚠ Conflict
                          </span>
                          <span className="text-slate-600">
                            Away cap:{" "}
                            <span className="font-mono font-semibold">
                              {g.away_submission!.score_away}-{g.away_submission!.score_home}
                            </span>
                            {" · Home cap: "}
                            <span className="font-mono font-semibold">
                              {g.home_submission!.score_away}-{g.home_submission!.score_home}
                            </span>
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="text-center py-2 px-2">
                      <input
                        type="number"
                        value={effectiveScore(g, "away")}
                        onChange={(e) => setDraft(g.id, "away", e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveOne(g);
                        }}
                        disabled={busy || savingId === g.id}
                        min={0}
                        className="w-16 rounded-md border border-slate-300 px-2 py-1 text-center font-mono"
                      />
                    </td>
                    <td className="text-center py-2 px-2">
                      <input
                        type="number"
                        value={effectiveScore(g, "home")}
                        onChange={(e) => setDraft(g.id, "home", e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveOne(g);
                        }}
                        disabled={busy || savingId === g.id}
                        min={0}
                        className="w-16 rounded-md border border-slate-300 px-2 py-1 text-center font-mono"
                      />
                    </td>
                    <td className="py-2 pl-2 text-xs">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusPill status={g.status} />
                        {g.has_conflict ? (
                          <>
                            <button
                              type="button"
                              onClick={() => resolveConflict(g, "away")}
                              disabled={busy || savingId === g.id}
                              className="rounded-md border border-amber-300 bg-white px-2 py-0.5 font-semibold text-amber-700 hover:bg-amber-50"
                            >
                              Use {teamName(g.away_team_id).split(" ")[0]}
                            </button>
                            <button
                              type="button"
                              onClick={() => resolveConflict(g, "home")}
                              disabled={busy || savingId === g.id}
                              className="rounded-md border border-amber-300 bg-white px-2 py-0.5 font-semibold text-amber-700 hover:bg-amber-50"
                            >
                              Use {teamName(g.home_team_id).split(" ")[0]}
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => saveOne(g)}
                            disabled={busy || savingId === g.id}
                            className="rounded-md bg-emerald-600 px-2 py-0.5 font-semibold text-white disabled:opacity-50"
                          >
                            {savingId === g.id ? "…" : "Save"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {Object.keys(drafts).length > 0 && (
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <span className="text-xs text-slate-600">
                {Object.keys(drafts).length} pending edit
                {Object.keys(drafts).length === 1 ? "" : "s"}
              </span>
              <button
                type="button"
                onClick={() => setDrafts({})}
                disabled={busy}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={saveAll}
                disabled={busy}
                className="rounded-md bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save all changes"}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function StatusPill({ status }: { status: string }) {
  const palette: Record<string, string> = {
    scheduled: "bg-blue-100 text-blue-800",
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
