"use client";

// Attendance tab — verbatim port of DVSL captain.html `renderAttendance`
// + the three view-renderers (`renderMyAvailability`, `renderTeamAvailability`,
// `renderCaptainEdit`) and `captainRemindWaiting`. Lines 5255-5589 in
// the source.
//
// Three views (DVSL pattern):
//   - my   : player picks themselves from a dropdown, sees upcoming games
//            with Yes/Maybe/No buttons. Tap-already-selected to clear.
//   - team : captain sees per-game RSVP summary (Yes/Maybe/No/Waiting)
//            plus a "Remind Waiting" button that fires a team_chat push
//            to subscribers who haven't responded.
//   - edit : captain edit grid — every player × every upcoming game,
//            captain can set anyone's RSVP.
//
// Writes go through /api/availability-rsvp (mediated for ownership
// verification) instead of DVSL's direct client SDK writes.

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useUser } from "@/lib/auth-client";
import { formatGameDate, formatTime12 } from "@/lib/format-time";

interface PlayerRow {
  id: string;
  name: string;
  jersey: number | null;
  auth_uid: string | null;
}

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
  player_id: string;
  player_name: string;
  team_id: string;
  status: "yes" | "maybe" | "no";
}

type View = "my" | "team" | "edit";
type Status = "yes" | "maybe" | "no";

interface Props {
  leagueId: string;
  teamId: string;
}

// ── localStorage key for "my player" dropdown selection ────────────
// DVSL stores per (team_id) — captain.html:5263. We add leagueId to
// avoid cross-league collisions when one user is captain in multiple
// leagues on the same device.
function lsKey(leagueId: string, teamId: string): string {
  return `leagueplatform:availPlayer:${leagueId}:${teamId}`;
}

export function AttendanceTab({ leagueId, teamId }: Props) {
  const user = useUser();
  const [view, setView] = useState<View>("my");
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [games, setGames] = useState<GameRow[]>([]);
  const [teamNames, setTeamNames] = useState<Record<string, string>>({});
  const [avail, setAvail] = useState<AvailRow[]>([]);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Load players + games + opponent names + availability ─────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const db = getDb();
      const [playersSnap, gamesSnap, teamsSnap, availSnap] =
        await Promise.all([
          getDocs(
            query(
              collection(db, `leagues/${leagueId}/players`),
              where("team_id", "==", teamId),
            ),
          ),
          getDocs(collection(db, `leagues/${leagueId}/games`)),
          getDocs(collection(db, `leagues/${leagueId}/teams`)),
          getDocs(
            query(
              collection(db, `leagues/${leagueId}/availability`),
              where("team_id", "==", teamId),
            ),
          ),
        ]);
      if (cancelled) return;
      const ps: PlayerRow[] = playersSnap.docs
        .map((d) => {
          const data = d.data();
          // Skip orphan / inactive docs. LBDC's migration auto-
          // creates player records when a box-score line references
          // a player not on the canonical roster (Pool Player, name
          // variants, opposing team players in a tournament, etc.);
          // those get status="unknown" + orphan=true. Without this
          // filter the AttendanceTab listed ~150 ghost players per
          // team. Keeping the legacy `active === false` check too
          // for any older SFBL data that used that shape.
          if (data.active === false) return null;
          if (data.orphan === true) return null;
          if (data.status && data.status !== "active") return null;
          return {
            id: d.id,
            name: String(data.name ?? d.id),
            jersey: data.jersey != null ? Number(data.jersey) : null,
            auth_uid:
              typeof data.auth_uid === "string" ? data.auth_uid : null,
          };
        })
        .filter((p): p is PlayerRow => p !== null)
        .sort(
          (a, b) =>
            (a.jersey ?? 999) - (b.jersey ?? 999) ||
            a.name.localeCompare(b.name),
        );
      setPlayers(ps);

      const names: Record<string, string> = {};
      for (const d of teamsSnap.docs) {
        names[d.id] = String(d.data().name ?? d.id);
      }
      setTeamNames(names);

      const gs: GameRow[] = gamesSnap.docs
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
        .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
      setGames(gs);

      setAvail(
        availSnap.docs.map((d) => {
          const data = d.data();
          return {
            game_id: String(data.game_id ?? ""),
            player_id: String(data.player_id ?? ""),
            player_name: String(data.player_name ?? ""),
            team_id: String(data.team_id ?? ""),
            status: String(data.status ?? "no") as Status,
          };
        }),
      );

      // Restore saved player dropdown selection (DVSL pattern).
      try {
        const saved = window.localStorage.getItem(lsKey(leagueId, teamId));
        if (saved && ps.some((p) => p.id === saved)) {
          setSelectedPlayerId(saved);
        } else if (user) {
          // Auto-pick the player linked to the current auth uid (matches
          // DVSL's "you should be marking your own availability" assumption).
          const linked = ps.find((p) => p.auth_uid === user.uid);
          if (linked) setSelectedPlayerId(linked.id);
        }
      } catch {
        /* localStorage unavailable */
      }

      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId, teamId, user]);

  // ── Refetch availability after a write ────────────────────────────
  async function refetchAvail() {
    const db = getDb();
    const snap = await getDocs(
      query(
        collection(db, `leagues/${leagueId}/availability`),
        where("team_id", "==", teamId),
      ),
    );
    setAvail(
      snap.docs.map((d) => {
        const data = d.data();
        return {
          game_id: String(data.game_id ?? ""),
          player_id: String(data.player_id ?? ""),
          player_name: String(data.player_name ?? ""),
          team_id: String(data.team_id ?? ""),
          status: String(data.status ?? "no") as Status,
        };
      }),
    );
  }

  function onSelectPlayer(pid: string) {
    setSelectedPlayerId(pid);
    try {
      window.localStorage.setItem(lsKey(leagueId, teamId), pid);
    } catch {
      /* ignore */
    }
  }

  // ── Set / clear an RSVP. `clearOnSame` matches DVSL's tap-already-
  // selected-to-clear behaviour (captain.html:5360). ─────────────────
  async function setAvailability(
    gameId: string,
    playerId: string,
    next: Status,
    opts: { clearOnSame?: boolean } = {},
  ) {
    if (!user) return;
    const current = avail.find(
      (a) => a.game_id === gameId && a.player_id === playerId,
    );
    const isClear = opts.clearOnSame && current?.status === next;
    const sendStatus: "yes" | "maybe" | "no" | "clear" = isClear
      ? "clear"
      : next;

    setSaving(`${gameId}_${playerId}`);
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
          playerId,
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
      // Optimistic local update.
      setAvail((cur) => {
        if (isClear) {
          return cur.filter(
            (a) => !(a.game_id === gameId && a.player_id === playerId),
          );
        }
        const player = players.find((p) => p.id === playerId);
        const without = cur.filter(
          (a) => !(a.game_id === gameId && a.player_id === playerId),
        );
        return [
          ...without,
          {
            game_id: gameId,
            player_id: playerId,
            player_name: player?.name ?? "",
            team_id: teamId,
            status: next,
          },
        ];
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(null);
    }
  }

  // ── captainRemindWaiting — port of captain.html:5449 ──────────────
  async function remindWaiting(gameId: string) {
    if (!user) return;
    const game = games.find((g) => g.id === gameId);
    if (!game) {
      setError("Game not found");
      return;
    }
    const oppId =
      game.away_team_id === teamId ? game.home_team_id : game.away_team_id;
    const oppName = teamNames[oppId] ?? oppId;
    const ha = game.home_team_id === teamId ? "vs" : "@";
    const myTeamName = teamNames[teamId] ?? teamId;
    // Audit H1: build the push body's "when" from a stable local
    // calendar day + the separate time field (no UTC-midnight skew
    // for LBDC's Pacific captains).
    const whenDay = formatGameDate(game.date, game.time, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    const whenTime = game.time ? formatTime12(game.time) : "";
    const when = [whenDay, whenTime].filter(Boolean).join(" · ");
    const title = `${myTeamName} · Availability needed`;
    const body =
      `Please mark your availability for Wk ${game.wk ?? "?"} ${ha} ${oppName}` +
      (when ? ` · ${when}` : "") +
      ". Tap to submit.";

    // Compute the player_ids of teammates who already responded so the
    // server can skip their devices. Cross-references by player_name
    // (DVSL pattern at captain.html:5475) — could also key by player_id,
    // but matching DVSL keeps the port faithful.
    //
    // Audit L10 (known edge case, accepted): if two players on the
    // same team share an exact name ("John Smith" Jr/Sr), one's
    // "responded" status suppresses the other's reminder. DVSL hit
    // this once in years. Keying by player_id would fix it but
    // diverges from the DVSL availability-doc shape; revisit only if
    // a tenant actually reports a collision.
    const respondedNames = new Set(
      avail
        .filter((a) => a.game_id === gameId && a.team_id === teamId)
        .map((a) => a.player_name),
    );
    const excludePlayerIds = players
      .filter((p) => respondedNames.has(p.name))
      .map((p) => p.id);

    setSaving(`remind_${gameId}`);
    setError(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/send-notification", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          leagueId,
          title,
          body,
          // team_chat is gated server-side on authed_teams — only delivers
          // to signed-in players whose roster spot links to this team.
          // Prevents cross-team leakage. Matches DVSL captain.html:5481.
          category: "team_chat",
          teams: [teamId],
          // Deep-link to /profile#avail so players land on a tab they
          // can actually use — they can't reach /captain. Captains
          // tapping the push also land here, which is fine; they get
          // the same UI scoped to their own roster record.
          url: "/profile#avail",
          excludePlayerIds,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(data.error ?? "Reminder failed");
        return;
      }
      const data = (await res.json()) as { sent?: number };
      const sent = Number(data.sent) || 0;
      setError(
        sent
          ? `Sent to ${sent} player${sent === 1 ? "" : "s"} ✓`
          : "No waiting players to nudge",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reminder failed");
    } finally {
      setSaving(null);
    }
  }

  // ── Derived state ─────────────────────────────────────────────────
  const upcoming = useMemo(
    () => games.filter((g) => g.status === "scheduled"),
    [games],
  );

  const availByGameAndPlayer = useMemo(() => {
    const map: Record<string, Status> = {};
    for (const a of avail) map[`${a.game_id}_${a.player_id}`] = a.status;
    return map;
  }, [avail]);

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="cap-tab">
      <div className="cap-section-head">
        <h2 className="cap-section-title">Attendance</h2>
        <p className="cap-section-sub">
          Mark who's playing each week. Pick your own name from the
          dropdown, or switch to Team or Captain Edit to manage everyone.
        </p>
      </div>

      {error && <div className="cap-error-banner">{error}</div>}

      {/* View toggle */}
      <div className="avail-view-tabs">
        <button
          type="button"
          className={
            "avail-view-tab" + (view === "my" ? " active" : "")
          }
          onClick={() => setView("my")}
        >
          My Availability
        </button>
        <button
          type="button"
          className={
            "avail-view-tab" + (view === "team" ? " active" : "")
          }
          onClick={() => setView("team")}
        >
          Team
        </button>
        <button
          type="button"
          className={
            "avail-view-tab" + (view === "edit" ? " active" : "")
          }
          onClick={() => setView("edit")}
        >
          Captain Edit
        </button>
      </div>

      {/* Player picker — only for "my" view */}
      {view === "my" && (
        <div style={{ margin: "16px 0" }}>
          <label
            className="cap-form-lbl"
            htmlFor="avail-player-select"
            style={{ display: "block", marginBottom: 6 }}
          >
            Marking availability as:
          </label>
          <select
            id="avail-player-select"
            className="cap-form-input"
            value={selectedPlayerId}
            onChange={(e) => onSelectPlayer(e.target.value)}
            style={{ maxWidth: 320 }}
          >
            <option value="">— select your name —</option>
            {players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.jersey != null ? ` (#${p.jersey})` : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {loading ? (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>Loading…</p>
      ) : view === "my" ? (
        <MyView
          selectedPlayerId={selectedPlayerId}
          players={players}
          upcoming={upcoming}
          availByGameAndPlayer={availByGameAndPlayer}
          teamId={teamId}
          teamNames={teamNames}
          saving={saving}
          onRsvp={(gameId, status) =>
            setAvailability(gameId, selectedPlayerId, status, {
              clearOnSame: true,
            })
          }
        />
      ) : view === "team" ? (
        <TeamView
          players={players}
          upcoming={upcoming}
          avail={avail}
          teamId={teamId}
          teamNames={teamNames}
          saving={saving}
          onRemind={remindWaiting}
        />
      ) : (
        <EditView
          players={players}
          upcoming={upcoming}
          availByGameAndPlayer={availByGameAndPlayer}
          teamId={teamId}
          teamNames={teamNames}
          saving={saving}
          onSet={(gameId, playerId, status) =>
            setAvailability(gameId, playerId, status)
          }
          onClear={(gameId, playerId) =>
            setAvailability(gameId, playerId, "no", {
              clearOnSame: false,
            }).then(() =>
              setAvailability(gameId, playerId, "yes", {
                clearOnSame: false,
              }),
            )
          }
        />
      )}
    </div>
  );
}

// ── My view ────────────────────────────────────────────────────────
function MyView({
  selectedPlayerId,
  players,
  upcoming,
  availByGameAndPlayer,
  teamId,
  teamNames,
  saving,
  onRsvp,
}: {
  selectedPlayerId: string;
  players: PlayerRow[];
  upcoming: GameRow[];
  availByGameAndPlayer: Record<string, Status>;
  teamId: string;
  teamNames: Record<string, string>;
  saving: string | null;
  onRsvp: (gameId: string, status: Status) => void;
}) {
  if (!selectedPlayerId) {
    return (
      <p style={{ color: "var(--muted)", fontSize: 13 }}>
        Select your name above to get started.
      </p>
    );
  }
  if (upcoming.length === 0) {
    return (
      <p style={{ color: "var(--muted)", fontSize: 13 }}>
        No upcoming games scheduled.
      </p>
    );
  }
  const player = players.find((p) => p.id === selectedPlayerId);
  return (
    <>
      <p
        style={{
          fontSize: 12,
          color: "var(--muted)",
          marginBottom: 14,
          lineHeight: 1.5,
        }}
      >
        Tap a status to set it. Tap the same status again to clear your
        response.
      </p>
      <ul className="avail-game-list">
        {upcoming.map((g) => {
          const status = availByGameAndPlayer[`${g.id}_${selectedPlayerId}`];
          return (
            <li key={g.id} className="avail-game-row">
              <GameMeta game={g} teamId={teamId} teamNames={teamNames} />
              <RsvpButtons
                value={status}
                disabled={saving === `${g.id}_${selectedPlayerId}`}
                onChange={(s) => onRsvp(g.id, s)}
              />
            </li>
          );
        })}
      </ul>
      {player && (
        <p
          style={{
            fontSize: 11,
            color: "var(--muted)",
            marginTop: 18,
            lineHeight: 1.5,
          }}
        >
          Marking as <strong>{player.name}</strong>. Switch the dropdown
          above to pick a different player.
        </p>
      )}
    </>
  );
}

// ── Team view ──────────────────────────────────────────────────────
function TeamView({
  players,
  upcoming,
  avail,
  teamId,
  teamNames,
  saving,
  onRemind,
}: {
  players: PlayerRow[];
  upcoming: GameRow[];
  avail: AvailRow[];
  teamId: string;
  teamNames: Record<string, string>;
  saving: string | null;
  onRemind: (gameId: string) => void;
}) {
  if (upcoming.length === 0) {
    return (
      <p style={{ color: "var(--muted)", fontSize: 13 }}>
        No upcoming games.
      </p>
    );
  }
  return (
    <ul className="avail-team-list">
      {upcoming.map((g) => {
        const responded: Record<Status, string[]> = {
          yes: [],
          maybe: [],
          no: [],
        };
        const respondedNames = new Set<string>();
        for (const a of avail) {
          if (a.game_id !== g.id) continue;
          if (a.team_id !== teamId) continue;
          if (a.status === "yes" || a.status === "maybe" || a.status === "no") {
            responded[a.status].push(a.player_name);
            respondedNames.add(a.player_name);
          }
        }
        const waiting = players
          .filter((p) => !respondedNames.has(p.name))
          .map((p) => p.name);

        return (
          <li key={g.id} className="avail-team-row">
            <GameMeta game={g} teamId={teamId} teamNames={teamNames} />
            <div className="avail-cols">
              <AvailCol
                label="Yes"
                cls="yes"
                count={responded.yes.length}
                names={responded.yes}
              />
              <AvailCol
                label="Maybe"
                cls="maybe"
                count={responded.maybe.length}
                names={responded.maybe}
              />
              <AvailCol
                label="No"
                cls="no"
                count={responded.no.length}
                names={responded.no}
              />
              <AvailCol
                label="Waiting"
                cls="waiting"
                count={waiting.length}
                names={waiting}
              />
            </div>
            {waiting.length > 0 && (
              <button
                type="button"
                className="le-cap-btn-secondary avail-remind-btn"
                disabled={saving === `remind_${g.id}`}
                onClick={() => onRemind(g.id)}
              >
                {saving === `remind_${g.id}`
                  ? "Sending…"
                  : `📢 Remind ${waiting.length} waiting`}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function AvailCol({
  label,
  cls,
  count,
  names,
}: {
  label: string;
  cls: "yes" | "maybe" | "no" | "waiting";
  count: number;
  names: string[];
}) {
  return (
    <div className={"avail-col avail-col-" + cls}>
      <div className="avail-col-head">
        <span className="avail-col-label">{label}</span>
        <span className="avail-col-count">{count}</span>
      </div>
      {names.length > 0 && (
        <ul className="avail-col-names">
          {names.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Edit view ──────────────────────────────────────────────────────
function EditView({
  players,
  upcoming,
  availByGameAndPlayer,
  teamId,
  teamNames,
  saving,
  onSet,
}: {
  players: PlayerRow[];
  upcoming: GameRow[];
  availByGameAndPlayer: Record<string, Status>;
  teamId: string;
  teamNames: Record<string, string>;
  saving: string | null;
  onSet: (gameId: string, playerId: string, status: Status) => void;
  onClear: (gameId: string, playerId: string) => void;
}) {
  if (upcoming.length === 0) {
    return (
      <p style={{ color: "var(--muted)", fontSize: 13 }}>
        No upcoming games.
      </p>
    );
  }
  if (players.length === 0) {
    return (
      <p style={{ color: "var(--muted)", fontSize: 13 }}>
        No players on the roster.
      </p>
    );
  }
  return (
    <div className="avail-edit-wrap">
      {upcoming.map((g) => (
        <div key={g.id} className="avail-edit-game">
          <GameMeta game={g} teamId={teamId} teamNames={teamNames} />
          <ul className="avail-edit-rows">
            {players.map((p) => {
              const status = availByGameAndPlayer[`${g.id}_${p.id}`];
              return (
                <li key={p.id} className="avail-edit-row">
                  <span className="avail-edit-name">
                    {p.jersey != null && (
                      <span className="avail-edit-jersey">
                        #{p.jersey}
                      </span>
                    )}
                    {p.name}
                  </span>
                  <RsvpButtons
                    value={status}
                    disabled={saving === `${g.id}_${p.id}`}
                    onChange={(s) => onSet(g.id, p.id, s)}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ── Reusable bits ──────────────────────────────────────────────────

function GameMeta({
  game,
  teamId,
  teamNames,
}: {
  game: GameRow;
  teamId: string;
  teamNames: Record<string, string>;
}) {
  const isHome = game.home_team_id === teamId;
  const oppId = isHome ? game.away_team_id : game.home_team_id;
  const oppName = teamNames[oppId] ?? oppId;
  // Audit H1: stable local calendar day + separate time field.
  const dateLabel =
    formatGameDate(game.date, game.time, {
      weekday: "short",
      month: "short",
      day: "numeric",
    }) || "TBD";
  const timeLabel = game.time ? formatTime12(game.time) : "";
  return (
    <div className="avail-game-meta">
      {game.wk != null && (
        <span className="avail-game-week">Wk {game.wk}</span>
      )}
      <span className="avail-game-when">
        {dateLabel}
        {timeLabel ? ` · ${timeLabel}` : ""}
        {game.field ? ` · ${game.field}` : ""}
      </span>
      <span className="avail-game-vs">
        {isHome ? "vs" : "@"} {oppName}
      </span>
    </div>
  );
}

function RsvpButtons({
  value,
  disabled,
  onChange,
}: {
  value: Status | undefined;
  disabled: boolean;
  onChange: (s: Status) => void;
}) {
  const opts: { key: Status; label: string }[] = [
    { key: "yes", label: "Yes" },
    { key: "maybe", label: "Maybe" },
    { key: "no", label: "No" },
  ];
  return (
    <div className="avail-rsvp-btns">
      {opts.map((o) => (
        <button
          key={o.key}
          type="button"
          className={
            "avail-rsvp-btn avail-rsvp-" +
            o.key +
            (value === o.key ? " active" : "")
          }
          disabled={disabled}
          onClick={() => onChange(o.key)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
