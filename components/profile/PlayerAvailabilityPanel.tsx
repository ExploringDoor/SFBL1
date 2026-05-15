"use client";

// Player-side availability panel for /profile#avail.
//
// Closes the loop the captain's "Remind Waiting" flow opened:
//   captain remindWaiting → push lands → tap → /profile#avail →
//   player marks Yes/Maybe/No → captain sees update in Team view.
//
// Differences from the captain's AttendanceTab "My Availability"
// view:
//   - Captain has a player picker (they may be marking for themselves
//     or for someone else); player only ever marks for themselves
//     (server-enforced via auth_uid match)
//   - Captain has team_id from claim; player has to find theirs by
//     auth-linking to their player record (calls /api/player-link)
//   - Captain UI lives inside the captain dashboard; player UI lives
//     in the profile (which any authenticated user can reach)
//
// Three states:
//   1. NOT LINKED — `/api/player-link` returned 0 matches. Player
//      isn't on a roster (fan, guest). Show a "Ask your captain to
//      add you" instruction.
//   2. AMBIGUOUS — multiple player records match this email. Tell
//      them to pick a season / contact the commissioner. Defer fancy
//      disambiguation UI for v1.
//   3. LINKED — show upcoming games + Yes/Maybe/No/clear buttons.

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useUser } from "@/lib/auth-client";
import { usePlayerLink } from "@/lib/usePlayerLink";
import { formatGameDate, formatTime12 } from "@/lib/format-time";

interface GameRow {
  id: string;
  date: string | null;
  time: string | null;
  field: string | null;
  status: string;
  away_team_id: string;
  home_team_id: string;
  wk: number | null;
}

interface AvailRow {
  game_id: string;
  status: "yes" | "maybe" | "no";
}

type Status = "yes" | "maybe" | "no";

interface Props {
  leagueId: string;
}

export function PlayerAvailabilityPanel({ leagueId }: Props) {
  const user = useUser();
  const linkState = usePlayerLink(leagueId, user);
  const [games, setGames] = useState<GameRow[]>([]);
  const [teamNames, setTeamNames] = useState<Record<string, string>>({});
  const [avail, setAvail] = useState<AvailRow[]>([]);
  const [playerName, setPlayerName] = useState<string>("Player");
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Once linked, load games + existing avail + look up player name.
  useEffect(() => {
    if (linkState.kind !== "linked") return;
    let cancelled = false;
    (async () => {
      const db = getDb();
      const [gamesSnap, teamsSnap, availSnap, playersSnap] =
        await Promise.all([
          getDocs(collection(db, `leagues/${leagueId}/games`)),
          getDocs(collection(db, `leagues/${leagueId}/teams`)),
          getDocs(
            query(
              collection(db, `leagues/${leagueId}/availability`),
              where("player_id", "==", linkState.playerId),
            ),
          ),
          getDocs(
            query(
              collection(db, `leagues/${leagueId}/players`),
              where("auth_uid", "==", user!.uid),
            ),
          ),
        ]);
      if (cancelled) return;
      const namedoc = playersSnap.docs.find(
        (d) => d.id === linkState.playerId,
      );
      if (namedoc) setPlayerName(String(namedoc.data().name ?? "Player"));

      const names: Record<string, string> = {};
      for (const d of teamsSnap.docs) {
        names[d.id] = String(d.data().name ?? d.id);
      }
      setTeamNames(names);

      const teamId = linkState.teamId;
      setGames(
        gamesSnap.docs
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
              wk: data.week != null ? Number(data.week) : null,
            };
          })
          .filter(
            (g) =>
              g.away_team_id === teamId || g.home_team_id === teamId,
          )
          .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "")),
      );

      setAvail(
        availSnap.docs.map((d) => {
          const data = d.data();
          return {
            game_id: String(data.game_id ?? ""),
            status: String(data.status ?? "no") as Status,
          };
        }),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId, linkState]);

  async function setAvailability(gameId: string, next: Status) {
    if (!user || linkState.kind !== "linked") return;
    const current = avail.find((a) => a.game_id === gameId)?.status;
    const isClear = current === next;
    const sendStatus: "yes" | "maybe" | "no" | "clear" = isClear
      ? "clear"
      : next;

    setSaving(gameId);
    setError(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/availability-rsvp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          leagueId,
          gameId,
          playerId: linkState.playerId,
          status: sendStatus,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(data.error ?? "Save failed");
        return;
      }
      setAvail((cur) => {
        if (isClear) return cur.filter((a) => a.game_id !== gameId);
        const without = cur.filter((a) => a.game_id !== gameId);
        return [...without, { game_id: gameId, status: next }];
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(null);
    }
  }

  const upcoming = useMemo(
    () => games.filter((g) => g.status === "scheduled"),
    [games],
  );

  return (
    <div className="cap-tab">
      <div className="cap-section-head">
        <h2 className="cap-section-title">Availability</h2>
        <p className="cap-section-sub">
          Mark whether you can make each upcoming game. Tap the same
          status again to clear it. Captains see who's responded in
          their team summary.
        </p>
      </div>

      {error && <div className="cap-error-banner">{error}</div>}

      {linkState.kind === "loading" ? (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>Loading…</p>
      ) : linkState.kind === "no-match" ? (
        <div className="cap-pending-card">
          <div className="cap-pending-row">
            <div>
              <strong>You're not on a roster yet</strong>
              <p
                style={{
                  fontSize: 13,
                  color: "var(--muted)",
                  margin: "6px 0 0",
                  lineHeight: 1.55,
                }}
              >
                We didn't find a player record matching{" "}
                <strong>{user?.email}</strong>. Ask your captain to add
                you to the roster — they'll need this exact email so we
                can link your account when you sign in next time.
              </p>
            </div>
          </div>
        </div>
      ) : linkState.kind === "ambiguous" ? (
        <div className="cap-pending-card">
          <div className="cap-pending-row">
            <div>
              <strong>We found multiple player records for your email</strong>
              <p
                style={{
                  fontSize: 13,
                  color: "var(--muted)",
                  margin: "6px 0 0",
                  lineHeight: 1.55,
                }}
              >
                Looks like you're rostered on more than one team (maybe
                from previous seasons too). Ask your captain or the
                commissioner to clean up the old records, then refresh
                this page.
              </p>
            </div>
          </div>
        </div>
      ) : upcoming.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>
          No upcoming games scheduled. You're all set —{" "}
          <strong>{playerName}</strong> on{" "}
          {teamNames[linkState.teamId] ?? linkState.teamId}.
        </p>
      ) : (
        <>
          <p
            style={{
              fontSize: 13,
              marginBottom: 14,
              color: "var(--muted)",
              lineHeight: 1.5,
            }}
          >
            Marking availability as{" "}
            <strong>{playerName}</strong> on{" "}
            {teamNames[linkState.teamId] ?? linkState.teamId}.
          </p>
          <ul className="avail-game-list">
            {upcoming.map((g) => {
              const isHome = g.home_team_id === linkState.teamId;
              const oppId = isHome ? g.away_team_id : g.home_team_id;
              const oppName = teamNames[oppId] ?? oppId;
              // Audit H1: parse date-only as a stable local calendar
              // day; prefer the separate `time` field for the clock
              // (no Date()/TZ math) so LBDC's Pacific RSVP panel
              // doesn't slip a day or show a bogus midnight.
              const dateLabel =
                formatGameDate(g.date, g.time, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                }) || "TBD";
              const timeLabel = g.time ? formatTime12(g.time) : "";
              const status = avail.find((a) => a.game_id === g.id)?.status;
              return (
                <li key={g.id} className="avail-game-row">
                  <div className="avail-game-meta">
                    {g.wk != null && (
                      <span className="avail-game-week">Wk {g.wk}</span>
                    )}
                    <span className="avail-game-when">
                      {dateLabel}
                      {timeLabel ? ` · ${timeLabel}` : ""}
                      {g.field ? ` · ${g.field}` : ""}
                    </span>
                    <span className="avail-game-vs">
                      {isHome ? "vs" : "@"} {oppName}
                    </span>
                  </div>
                  <div className="avail-rsvp-btns">
                    {(["yes", "maybe", "no"] as Status[]).map((s) => (
                      <button
                        key={s}
                        type="button"
                        className={
                          "avail-rsvp-btn avail-rsvp-" +
                          s +
                          (status === s ? " active" : "")
                        }
                        disabled={saving === g.id}
                        onClick={() => setAvailability(g.id, s)}
                      >
                        {s === "yes" ? "Yes" : s === "maybe" ? "Maybe" : "No"}
                      </button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
