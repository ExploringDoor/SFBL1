"use client";

// Schedule tab — verbatim port of DVSL captain.html `renderSchedule`
// (the list of upcoming + past games for the captain's team) plus the
// shared SubscribeCalendar buttons (Apple / Google / Copy URL).
//
// All games are read from the public /games collection (rules allow).
// Click a game → navigates to /games/[id] (opens box-score modal).

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  collection,
  getDocs,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useUser } from "@/lib/auth-client";
import { SubscribeCalendar } from "@/components/SubscribeCalendar";
import { combineDateTime, formatTime12 } from "@/lib/format-time";

interface GameRow {
  id: string;
  date: string | null;
  // Separate time field — most LBDC games store "HH:MM" here while
  // `date` holds plain "YYYY-MM-DD". Without it, `new Date(date)`
  // parses as UTC midnight and Florida users saw every game listed
  // as 8 PM (UTC midnight = EDT 8 PM the previous day).
  time: string | null;
  field: string | null;
  status: string;
  away_team_id: string;
  home_team_id: string;
  away_score: number;
  home_score: number;
}

interface ScheduleTabProps {
  leagueId: string;
  teamId: string;
}

export function ScheduleTab({ leagueId, teamId }: ScheduleTabProps) {
  const user = useUser();
  const [games, setGames] = useState<GameRow[]>([]);
  const [teamNames, setTeamNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const db = getDb();
      const [gamesSnap, teamsSnap] = await Promise.all([
        getDocs(collection(db, `leagues/${leagueId}/games`)),
        getDocs(collection(db, `leagues/${leagueId}/teams`)),
      ]);
      if (cancelled) return;
      const names: Record<string, string> = {};
      for (const d of teamsSnap.docs) {
        names[d.id] = String(d.data().name ?? d.id);
      }
      const myGames = gamesSnap.docs
        .map((d) => {
          const data = d.data();
          return {
            id: d.id,
            date: data.date ? String(data.date) : null,
            time: data.time ? String(data.time) : null,
            field: data.field ? String(data.field) : null,
            status: String(data.status ?? "draft"),
            away_team_id: String(data.away_team_id ?? ""),
            home_team_id: String(data.home_team_id ?? ""),
            away_score: Number(data.away_score ?? 0),
            home_score: Number(data.home_score ?? 0),
          };
        })
        .filter(
          (g) =>
            g.away_team_id === teamId || g.home_team_id === teamId,
        )
        .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
      setTeamNames(names);
      setGames(myGames);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId, teamId]);

  const upcoming = games.filter((g) => g.status === "scheduled");
  const past = games
    .filter((g) => g.status === "final" || g.status === "approved")
    .reverse();

  return (
    <div className="cap-tab">
      <div className="cap-section-head">
        <h2 className="cap-section-title">Schedule</h2>
        <p className="cap-section-sub">
          Your team's upcoming + past games. Subscribe to your team's
          schedule so the calendar app on your phone updates as games
          shift.
        </p>
      </div>

      <div style={{ marginBottom: 22 }}>
        <SubscribeCalendar teamId={teamId} />
      </div>

      {loading ? (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>
          Loading…
        </p>
      ) : (
        <>
          {editError && (
            <div className="cap-error-banner">{editError}</div>
          )}

          <h3 className="cap-section-h3">Upcoming</h3>
          {upcoming.length === 0 ? (
            <p style={{ color: "var(--muted)", fontSize: 13 }}>
              No upcoming games.
            </p>
          ) : (
            <ul className="cap-game-list">
              {upcoming.map((g) => (
                <GameRow
                  key={g.id}
                  g={g}
                  myTeamId={teamId}
                  teamNames={teamNames}
                  editing={editId === g.id}
                  onToggleEdit={() =>
                    setEditId(editId === g.id ? null : g.id)
                  }
                  onSaveEdit={async (payload) => {
                    if (!user) return false;
                    setEditError(null);
                    const idToken = await user.getIdToken();
                    const res = await fetch("/api/captain-schedule", {
                      method: "POST",
                      headers: {
                        "content-type": "application/json",
                        authorization: `Bearer ${idToken}`,
                      },
                      body: JSON.stringify({
                        leagueId,
                        gameId: g.id,
                        ...payload,
                      }),
                    });
                    if (!res.ok) {
                      const data = (await res
                        .json()
                        .catch(() => ({}))) as {
                        error?: string;
                      };
                      setEditError(data.error ?? "Save failed");
                      return false;
                    }
                    setEditId(null);
                    setLoading(true);
                    const db = getDb();
                    const fresh = await getDocs(
                      collection(db, `leagues/${leagueId}/games`),
                    );
                    const myGames: GameRow[] = fresh.docs
                      .map((d) => {
                        const data = d.data();
                        return {
                          id: d.id,
                          date: data.date ? String(data.date) : null,
                          time: data.time ? String(data.time) : null,
                          field: data.field ? String(data.field) : null,
                          status: String(data.status ?? "draft"),
                          away_team_id: String(
                            data.away_team_id ?? "",
                          ),
                          home_team_id: String(
                            data.home_team_id ?? "",
                          ),
                          away_score: Number(data.away_score ?? 0),
                          home_score: Number(data.home_score ?? 0),
                        };
                      })
                      .filter(
                        (g) =>
                          g.away_team_id === teamId ||
                          g.home_team_id === teamId,
                      )
                      .sort((a, b) =>
                        (a.date ?? "").localeCompare(b.date ?? ""),
                      );
                    setGames(myGames);
                    setLoading(false);
                    return true;
                  }}
                />
              ))}
            </ul>
          )}

          <h3 className="cap-section-h3" style={{ marginTop: 28 }}>
            Past Results
          </h3>
          {past.length === 0 ? (
            <p style={{ color: "var(--muted)", fontSize: 13 }}>
              No completed games yet.
            </p>
          ) : (
            <ul className="cap-game-list">
              {past.slice(0, 25).map((g) => (
                <GameRow
                  key={g.id}
                  g={g}
                  myTeamId={teamId}
                  teamNames={teamNames}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function GameRow({
  g,
  myTeamId,
  teamNames,
  editing,
  onToggleEdit,
  onSaveEdit,
}: {
  g: GameRow;
  myTeamId: string;
  teamNames: Record<string, string>;
  editing?: boolean;
  onToggleEdit?: () => void;
  onSaveEdit?: (payload: {
    date?: string | null;
    time?: string | null;
    field?: string;
    status?: string;
  }) => Promise<boolean>;
}) {
  const isHome = g.home_team_id === myTeamId;
  const oppId = isHome ? g.away_team_id : g.home_team_id;
  const oppName = teamNames[oppId] ?? oppId;
  const myScore = isHome ? g.home_score : g.away_score;
  const oppScore = isHome ? g.away_score : g.home_score;
  const isFinal = g.status === "final" || g.status === "approved";
  const won = isFinal && myScore > oppScore;
  const lost = isFinal && myScore < oppScore;
  // Use the date PORTION (string slice) for the date label so we
  // don't TZ-shift "2026-05-16" into "May 15" for evening users in
  // EDT. Use the separate `time` field for the clock — if it's
  // missing, hide the time row entirely rather than fall back to
  // midnight UTC (which Adam saw as "every game at 8 PM").
  const dateLabel = g.date
    ? (() => {
        const ymd = String(g.date).slice(0, 10);
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
        if (!m) return ymd;
        const d = new Date(
          Number(m[1]),
          Number(m[2]) - 1,
          Number(m[3]),
        );
        return d.toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
        });
      })()
    : "TBD";
  const timeLabel = g.time ? formatTime12(g.time) : "";

  return (
    <li className="cap-schedule-row">
      <div className="cap-schedule-row-main">
        <Link href={`/games/${g.id}`} className="cap-game-link">
          <div className="cap-game-meta">
            <span className="cap-game-when">
              {dateLabel}
              {timeLabel ? ` · ${timeLabel}` : ""}
              {g.field ? ` · ${g.field}` : ""}
            </span>
            <span className="cap-game-vs">
              {isHome ? "vs" : "@"} {oppName}
            </span>
          </div>
          {isFinal ? (
            <span
              className={
                "cap-game-result " +
                (won ? "won" : lost ? "lost" : "tied")
              }
            >
              {won ? "W" : lost ? "L" : "T"} {myScore}–{oppScore}
            </span>
          ) : g.status === "postponed" ? (
            <span
              className="cap-game-status"
              style={{ color: "#dc2626" }}
            >
              PPD
            </span>
          ) : (
            <span className="cap-game-status">SCHEDULED</span>
          )}
        </Link>
        {onToggleEdit && (
          <button
            type="button"
            className="le-cap-btn-secondary cap-schedule-edit-btn"
            onClick={onToggleEdit}
          >
            {editing ? "Close" : "Edit"}
          </button>
        )}
      </div>
      {editing && onSaveEdit && (
        <ScheduleEditForm game={g} onCancel={onToggleEdit!} onSave={onSaveEdit} />
      )}
    </li>
  );
}

function ScheduleEditForm({
  game,
  onCancel,
  onSave,
}: {
  game: GameRow;
  onCancel: () => void;
  onSave: (payload: {
    date?: string | null;
    time?: string | null;
    field?: string;
    status?: string;
  }) => Promise<boolean>;
}) {
  // Split the stored ISO datetime into a date + time pair so the
  // inputs are easy to use; we re-combine on save. Guard against
  // malformed `game.date` — Date(badString).toISOString() throws.
  const initialDateTime = (() => {
    if (!game.date) return null;
    const d = new Date(game.date);
    return Number.isFinite(d.getTime()) ? d : null;
  })();
  const initialDate = initialDateTime
    ? initialDateTime.toISOString().slice(0, 10)
    : "";
  const initialTime = initialDateTime
    ? initialDateTime.toTimeString().slice(0, 5)
    : "";

  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState(initialTime);
  const [field, setField] = useState(game.field ?? "");
  const [status, setStatus] = useState(game.status);
  const [busy, setBusy] = useState(false);

  return (
    <div
      className="cap-inline-form"
      style={{ marginTop: 10, marginBottom: 0 }}
    >
      <div className="cap-form-row">
        <div className="cap-form-col">
          <label className="cap-form-lbl">Date</label>
          <input
            type="date"
            className="cap-form-input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div className="cap-form-col">
          <label className="cap-form-lbl">Time</label>
          <input
            type="time"
            className="cap-form-input"
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </div>
        <div className="cap-form-col">
          <label className="cap-form-lbl">Field</label>
          <input
            type="text"
            className="cap-form-input"
            value={field}
            onChange={(e) => setField(e.target.value)}
            placeholder="Field name"
          />
        </div>
        <div className="cap-form-col" style={{ maxWidth: 160 }}>
          <label className="cap-form-lbl">Status</label>
          <select
            className="cap-form-input"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="scheduled">Scheduled</option>
            <option value="postponed">Postponed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>
      <div className="cap-form-actions">
        <button
          type="button"
          className="le-cap-btn-primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            // Save date + time as two separate plain strings — NOT
            // a combined ISO. Combining via toISOString() converts
            // to UTC, which when read back in a different TZ shifts
            // the date by a day (this is the bug that made game
            // 100010 appear as "May 17, 5 PM" when it should have
            // been "May 18, 12 PM"). The shape the rest of the
            // platform expects is { date: "YYYY-MM-DD", time: "HH:MM" }.
            await onSave({
              date: date || null,
              time: time || null,
              field,
              status,
            });
            setBusy(false);
          }}
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          className="le-cap-btn-secondary"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
