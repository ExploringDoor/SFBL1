"use client";

// Box-score editor — clone of DVSL captain.html showBoxScoreEntry +
// makeStep + _renderBsStats (lines 3481–3565). Exactly three steps:
//
//   STEP 1: AWAY lineup — captain taps cards from away team's roster
//           to build the away batting order (.lp-grid + .lp-strip).
//   STEP 2: HOME lineup — same picker for home team.
//   STEP 3: Stats entry — scoreboard + linescore + per-team batting
//           tables (tab toggle) + pitching + submit.
//
// Each lineup step has DVSL's auxiliary controls: "+ Add Player"
// (custom walk-on), Dummy / Apply (fills with placeholder batters
// "Batter 1"…"Batter N"). Both teams' rosters are read from the
// public /players collection — captain submission privacy applies
// only to the box_score_submissions doc, not roster reads.
//
// Submit writes to leagues/{tenantId}/box_score_submissions/{game_id}_{team_id}
// (captain's lane), then POSTs /api/captain-submit which promotes the
// captain's side into /box_scores and runs recalcLeague so leaderboards
// update without an admin visit.

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useTenant } from "@/lib/tenant-context";
import {
  useCaptainTeam,
  useLeagueRole,
  useUser,
} from "@/lib/auth-client";

// ── Types ──────────────────────────────────────────────────────────
interface RosterPlayer {
  id: string;
  name: string;
  jersey: number | null;
  position: string | null;
}

interface LineupEntry {
  /** Roster player_id, OR null when this is a walk-on / dummy. */
  player_id: string | null;
  name: string;
  num: string;
}

interface BatStats {
  ab: number;
  r: number;
  h: number;
  doubles: number;
  triples: number;
  hr: number;
  rbi: number;
  bb: number;
  so: number;
  sb: number;
  pb: number;
  /** Sacrifice bunt — optional, league config opt-in. */
  sac: number;
  /** Sacrifice fly — optional. */
  sf: number;
  /** Reached on error — optional. */
  roe: number;
  /** Fielder's choice — optional. */
  fc: number;
}

type BatRow = LineupEntry & BatStats;

interface PitRow {
  player_id: string | null;
  name: string;
  num: string;
  ip_outs: number;
  h: number;
  r: number;
  er: number;
  bb: number;
  so: number;
  hr: number;
  decision: "" | "W" | "L" | "S";
}

interface GameSnap {
  away_team_id: string;
  home_team_id: string;
  away_team_name: string;
  home_team_name: string;
  date: string | null;
  field: string | null;
  innings: number;
}

type Step = "lineupAway" | "lineupHome" | "stats";

// Sport-aware columns — intersection of tenant config and our def.
type ColKind = "bat" | "pit";
interface StatCol {
  key: keyof BatStats | keyof PitRow;
  label: string;
  kind: ColKind;
}

const ALL_COLS: StatCol[] = [
  { key: "ab", label: "AB", kind: "bat" },
  { key: "r", label: "R", kind: "bat" },
  { key: "h", label: "H", kind: "bat" },
  { key: "doubles", label: "2B", kind: "bat" },
  { key: "triples", label: "3B", kind: "bat" },
  { key: "hr", label: "HR", kind: "bat" },
  { key: "rbi", label: "RBI", kind: "bat" },
  { key: "bb", label: "BB", kind: "bat" },
  { key: "so", label: "K", kind: "bat" },
  { key: "sb", label: "SB", kind: "bat" },
  // Optional batting columns — included only if the league's
  // tenant.config.stat_columns lists them. Standard MLB shorthand:
  //   SAC = sac bunt, SF = sac fly, ROE = reached on error,
  //   FC  = fielder's choice, PB = passed ball (softball).
  { key: "sac", label: "SAC", kind: "bat" },
  { key: "sf", label: "SF", kind: "bat" },
  { key: "roe", label: "ROE", kind: "bat" },
  { key: "fc", label: "FC", kind: "bat" },
  { key: "pb", label: "PB", kind: "bat" },
  { key: "ip_outs", label: "IP", kind: "pit" },
  { key: "h", label: "H", kind: "pit" },
  { key: "r", label: "R", kind: "pit" },
  { key: "er", label: "ER", kind: "pit" },
  { key: "bb", label: "BB", kind: "pit" },
  { key: "so", label: "K", kind: "pit" },
  { key: "hr", label: "HR", kind: "pit" },
];

const COL_ALIASES: Record<string, string> = {
  "2b": "doubles",
  "3b": "triples",
  k: "so",
  // Optional advanced batting cols — accept both the field key and
  // the display label so tenant configs can write either.
  sacb: "sac",
  "sac-bunt": "sac",
  sacf: "sf",
  "sac-fly": "sf",
};

function filterCols(cols: string[] | undefined, kind: ColKind): StatCol[] {
  if (kind === "pit") return ALL_COLS.filter((c) => c.kind === "pit");
  const raw = (cols ?? [
    "ab",
    "r",
    "h",
    "doubles",
    "triples",
    "hr",
    "rbi",
    "bb",
    "so",
    "sb",
  ]).map((k) => k.toLowerCase());
  const keys = new Set<string>(raw.map((k) => COL_ALIASES[k] ?? k));
  return ALL_COLS.filter((c) => c.kind === "bat" && keys.has(c.key as string));
}

function newBatRow(e: LineupEntry): BatRow {
  return {
    ...e,
    ab: 0,
    r: 0,
    h: 0,
    doubles: 0,
    triples: 0,
    hr: 0,
    rbi: 0,
    bb: 0,
    so: 0,
    sb: 0,
    pb: 0,
    sac: 0,
    sf: 0,
    roe: 0,
    fc: 0,
  };
}

// ── Page ───────────────────────────────────────────────────────────
export default function BoxScoreEditorPage() {
  const params = useSearchParams();
  const gameId = params.get("game");
  const { tenantId, config } = useTenant();
  const user = useUser();
  const role = useLeagueRole(tenantId);
  const { teamId, loading: teamLoading } = useCaptainTeam(tenantId);

  const [game, setGame] = useState<GameSnap | null>(null);
  const [awayRoster, setAwayRoster] = useState<RosterPlayer[]>([]);
  const [homeRoster, setHomeRoster] = useState<RosterPlayer[]>([]);
  const [awayLineup, setAwayLineup] = useState<BatRow[]>([]);
  const [homeLineup, setHomeLineup] = useState<BatRow[]>([]);
  const [awayPitchers, setAwayPitchers] = useState<PitRow[]>([]);
  const [homePitchers, setHomePitchers] = useState<PitRow[]>([]);
  const [innings, setInnings] = useState<{ away: number[]; home: number[] }>({
    away: [],
    home: [],
  });
  const [errors, setErrors] = useState<{ away: number; home: number }>({
    away: 0,
    home: 0,
  });
  const [step, setStep] = useState<Step>("lineupAway");
  // Default to away — corrected to the captain's own side once the
  // game data loads and we know which side they're on.
  const [activeStatsTab, setActiveStatsTab] = useState<"away" | "home">(
    "away",
  );
  const [activeTabPinned, setActiveTabPinned] = useState(false);
  // Custom (walk-on) players added by the captain via "+ Add Player".
  // Tracked separately from the lineup so the card stays in the grid
  // even when deselected — captain can tap again to re-add. Cleared
  // only when the captain explicitly removes them (×) or reloads.
  const [awayCustom, setAwayCustom] = useState<RosterPlayer[]>([]);
  const [homeCustom, setHomeCustom] = useState<RosterPlayer[]>([]);
  // Per-team "Score Only" mode. When true, the team's tab in the
  // stats step hides the batting + pitching tables and shows a
  // single "Final Score" input. Submit writes
  //   { score_only: true, final_score: N, lineup: [], pitchers: [] }
  // to that captain's submission. Stats recalc skips the team's
  // players (no zero rows, no double counting).
  const [scoreOnly, setScoreOnly] = useState<{
    away: boolean;
    home: boolean;
  }>({ away: false, home: false });
  const [finalScores, setFinalScores] = useState<{
    away: number | null;
    home: number | null;
  }>({ away: null, home: null });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const batCols = useMemo(
    () => filterCols(config?.stat_columns, "bat"),
    [config?.stat_columns],
  );
  const pitCols = useMemo(() => filterCols(undefined, "pit"), []);

  // ── Load game + both rosters + saved lineups + prior submission ──
  useEffect(() => {
    if (!tenantId || !teamId || !gameId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const db = getDb();
      const innCount = Number(config?.linescore_innings ?? 7);
      const gameSnap = await getDoc(
        doc(db, `leagues/${tenantId}/games/${gameId}`),
      );
      if (cancelled) return;
      if (!gameSnap.exists()) {
        setLoading(false);
        return;
      }
      const g = gameSnap.data() ?? {};
      const awayId = String(g.away_team_id ?? "");
      const homeId = String(g.home_team_id ?? "");

      const [
        awayTeamSnap,
        homeTeamSnap,
        awayRosterSnap,
        homeRosterSnap,
        awayLineupSnap,
        homeLineupSnap,
        subSnap,
      ] = await Promise.all([
        getDoc(doc(db, `leagues/${tenantId}/teams/${awayId}`)),
        getDoc(doc(db, `leagues/${tenantId}/teams/${homeId}`)),
        getDocs(
          query(
            collection(db, `leagues/${tenantId}/players`),
            where("team_id", "==", awayId),
          ),
        ),
        getDocs(
          query(
            collection(db, `leagues/${tenantId}/players`),
            where("team_id", "==", homeId),
          ),
        ),
        getDoc(doc(db, `leagues/${tenantId}/lineups/${gameId}_${awayId}`)),
        getDoc(doc(db, `leagues/${tenantId}/lineups/${gameId}_${homeId}`)),
        getDoc(
          doc(
            db,
            `leagues/${tenantId}/box_score_submissions/${gameId}_${teamId}`,
          ),
        ),
      ]);
      if (cancelled) return;

      const ig: GameSnap = {
        away_team_id: awayId,
        home_team_id: homeId,
        away_team_name: awayTeamSnap.exists()
          ? String(awayTeamSnap.data()?.name ?? awayId)
          : awayId,
        home_team_name: homeTeamSnap.exists()
          ? String(homeTeamSnap.data()?.name ?? homeId)
          : homeId,
        date: g.date ? String(g.date) : null,
        field: g.field ? String(g.field) : null,
        innings: innCount,
      };
      setGame(ig);
      const awayRosterParsed = parseRoster(awayRosterSnap.docs);
      const homeRosterParsed = parseRoster(homeRosterSnap.docs);
      setAwayRoster(awayRosterParsed);
      setHomeRoster(homeRosterParsed);

      // Pre-fill lineups from saved orders.
      const awayLineupParsed = parseLineup(awayLineupSnap);
      const homeLineupParsed = parseLineup(homeLineupSnap);
      setAwayLineup(awayLineupParsed);
      setHomeLineup(homeLineupParsed);

      // Re-hydrate custom (walk-on) cards from the saved lineup so
      // they re-appear in the grid after reload. Any lineup entry
      // whose player_id isn't on the roster is treated as a custom
      // card. (Auto-created walk-ons should already be on the
      // roster, but synth-id entries from older sessions or
      // mid-flight saves end up here.)
      const customFrom = (
        rows: BatRow[],
        roster: RosterPlayer[],
      ): RosterPlayer[] =>
        rows
          .filter((b) => !roster.some((p) => p.id === b.player_id))
          .map((b) => ({
            id: b.player_id ?? `custom:${b.name}`,
            name: b.name,
            jersey: b.num ? Number(b.num) || null : null,
            position: null,
          }));
      setAwayCustom(customFrom(awayLineupParsed, awayRosterParsed));
      setHomeCustom(customFrom(homeLineupParsed, homeRosterParsed));
      setInnings({
        away: new Array(innCount).fill(0),
        home: new Array(innCount).fill(0),
      });

      // If captain has already submitted, pre-fill stats too and
      // jump straight to the stats step.
      if (subSnap.exists()) {
        const sd = subSnap.data() ?? {};
        const myLineup = (sd.lineup ?? []) as BatRow[];
        const myPitchers = (sd.pitchers ?? []) as PitRow[];
        const myLine = (sd.linescore ?? []) as number[];
        const myErr = Number(sd.errors ?? 0);
        const isHome = teamId === homeId;
        if (isHome) {
          setHomeLineup(myLineup);
          setHomePitchers(myPitchers);
          setInnings((cur) => ({ ...cur, home: myLine }));
          setErrors((cur) => ({ ...cur, home: myErr }));
        } else {
          setAwayLineup(myLineup);
          setAwayPitchers(myPitchers);
          setInnings((cur) => ({ ...cur, away: myLine }));
          setErrors((cur) => ({ ...cur, away: myErr }));
        }
        setStep("stats");
      }
      // Active stats tab defaults to the captain's OWN side — that's
      // where they enter their data. Without this, captains who skip
      // the opposing team land on the opposing tab (Score-Only) and
      // mistake it for their own. Skip if the captain has manually
      // switched tabs already (we don't want to clobber their choice
      // on a re-render).
      if (!activeTabPinned) {
        setActiveStatsTab(teamId === homeId ? "home" : "away");
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, teamId, gameId, config?.linescore_innings]);

  // ── Auth gates ───────────────────────────────────────────────────
  if (!tenantId || !gameId)
    return (
      <main className="container py-16">
        <p>Missing game id. Open from your captain dashboard.</p>
      </main>
    );
  if (user === undefined || role === "loading" || teamLoading)
    return <main className="container py-16">Checking access…</main>;
  if (user === null)
    return (
      <main className="container py-16">
        <p>Sign in first.</p>
        <Link href="/login" className="le-cap-btn-primary">
          Sign in
        </Link>
      </main>
    );
  if (role !== "captain" || !teamId)
    return (
      <main className="container py-16">
        <p>Not a captain in this league.</p>
        <Link href="/captain" className="le-cap-btn-secondary">
          Back to dashboard
        </Link>
      </main>
    );
  if (loading || !game)
    return <main className="container py-16">Loading game…</main>;

  // ── Lineup-step helpers (matches DVSL bsTogglePlayer / etc.) ────
  function pickToggle(side: "away" | "home", p: RosterPlayer) {
    const setter = side === "away" ? setAwayLineup : setHomeLineup;
    setter((cur) => {
      const idx = cur.findIndex((b) => b.player_id === p.id);
      if (idx >= 0) return cur.filter((_, i) => i !== idx);
      return [
        ...cur,
        newBatRow({
          player_id: p.id,
          name: p.name,
          num: p.jersey != null ? String(p.jersey) : "",
        }),
      ];
    });
  }
  function pickRemoveAt(side: "away" | "home", i: number) {
    const setter = side === "away" ? setAwayLineup : setHomeLineup;
    setter((cur) => cur.filter((_, idx) => idx !== i));
  }
  function pickMoveTo(side: "away" | "home", from: number, to: number) {
    const setter = side === "away" ? setAwayLineup : setHomeLineup;
    setter((cur) => {
      if (from === to || from < 0 || to < 0 || from >= cur.length) {
        return cur;
      }
      const next = [...cur];
      const [moved] = next.splice(from, 1);
      next.splice(Math.min(to, next.length), 0, moved!);
      return next;
    });
  }
  async function pickAddCustom(
    side: "away" | "home",
    name: string,
    num: string,
  ) {
    if (!user || !tenantId) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const customSetter = side === "away" ? setAwayCustom : setHomeCustom;
    const lineupSetter = side === "away" ? setAwayLineup : setHomeLineup;
    // Optimistic: add a local card with a synthetic id so the UI
    // updates instantly. We swap the id to the real one after the
    // server creates the player record.
    const tempId =
      "custom:" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const tempPlayer: RosterPlayer = {
      id: tempId,
      name: trimmed,
      jersey: num.trim() ? Number(num.trim()) || null : null,
      position: null,
    };
    customSetter((cur) => [...cur, tempPlayer]);
    lineupSetter((cur) => [
      ...cur,
      newBatRow({
        player_id: tempId,
        name: trimmed,
        num: num.trim(),
      }),
    ]);
    // POST to the server endpoint — creates a real `players/{id}`
    // doc on the captain's team so the walk-on rolls up to season
    // stats and shows on the roster going forward.
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/captain-add-player", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          leagueId: tenantId,
          name: trimmed,
          jersey: num.trim(),
        }),
      });
      if (!res.ok) {
        // Surface the failure so the captain knows the walk-on isn't
        // persisted to the roster. Their lineup keeps the synth ID so
        // they can still submit the box score; we just want them to
        // know to add the player properly later.
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setServerError(
          (data.error ?? "Couldn't save walk-on to roster.") +
            " Lineup entry kept; ask admin to fix the player record after the game.",
        );
        return;
      }
      const data = (await res.json()) as { player_id?: string };
      const realId = data.player_id;
      if (!realId) return;
      // Swap the synthetic id for the real one in custom + lineup.
      customSetter((cur) =>
        cur.map((p) => (p.id === tempId ? { ...p, id: realId } : p)),
      );
      lineupSetter((cur) =>
        cur.map((b) =>
          b.player_id === tempId ? { ...b, player_id: realId } : b,
        ),
      );
    } catch {
      /* network error — keep the synthetic id; submit still works */
    }
  }
  function pickRemoveCustom(side: "away" | "home", playerId: string) {
    const customSetter = side === "away" ? setAwayCustom : setHomeCustom;
    const lineupSetter = side === "away" ? setAwayLineup : setHomeLineup;
    customSetter((cur) => cur.filter((p) => p.id !== playerId));
    lineupSetter((cur) => cur.filter((b) => b.player_id !== playerId));
  }

  // Add a pitcher to a team — called from the lineup step's pitcher
  // dropdown. Captain picks from the team's roster + walk-ons; the
  // pitcher name + jersey are pre-populated from the player record.
  function pickAddPitcher(side: "away" | "home", p: RosterPlayer) {
    const setter = side === "away" ? setAwayPitchers : setHomePitchers;
    setter((cur) => {
      // Don't double-add the same pitcher.
      if (cur.some((x) => x.player_id === p.id)) return cur;
      return [
        ...cur,
        {
          player_id: p.id,
          name: p.name,
          num: p.jersey != null ? String(p.jersey) : "",
          ip_outs: 0,
          h: 0,
          r: 0,
          er: 0,
          bb: 0,
          so: 0,
          hr: 0,
          decision: "",
        },
      ];
    });
  }
  function pickApplyDummy(side: "away" | "home", count: number) {
    const lineupSetter = side === "away" ? setAwayLineup : setHomeLineup;
    const customSetter = side === "away" ? setAwayCustom : setHomeCustom;
    const safe = Math.max(1, Math.min(20, Math.floor(count)));
    const stamp = Date.now().toString(36);
    const players: RosterPlayer[] = Array.from(
      { length: safe },
      (_, i) => ({
        id: `custom:dummy-${stamp}-${i}`,
        name: `Batter ${i + 1}`,
        jersey: null,
        position: null,
      }),
    );
    customSetter(players);
    lineupSetter(
      players.map((p) => newBatRow({ player_id: p.id, name: p.name, num: "" })),
    );
  }

  // Stats-step helpers
  function updateBat(side: "away" | "home", i: number, key: string, val: number) {
    const setter = side === "away" ? setAwayLineup : setHomeLineup;
    setter((cur) =>
      cur.map((row, idx) =>
        idx === i ? ({ ...row, [key]: val } as BatRow) : row,
      ),
    );
  }
  function moveBat(side: "away" | "home", i: number, dir: -1 | 1) {
    const setter = side === "away" ? setAwayLineup : setHomeLineup;
    setter((cur) => {
      const j = i + dir;
      if (j < 0 || j >= cur.length) return cur;
      const next = [...cur];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  }
  function updatePit(
    side: "away" | "home",
    i: number,
    key: string,
    val: string | number,
  ) {
    const setter = side === "away" ? setAwayPitchers : setHomePitchers;
    setter((cur) =>
      cur.map((row, idx) =>
        idx === i ? ({ ...row, [key]: val } as PitRow) : row,
      ),
    );
  }
  function addPitcher(side: "away" | "home") {
    const setter = side === "away" ? setAwayPitchers : setHomePitchers;
    setter((cur) => [
      ...cur,
      {
        player_id: null,
        name: "",
        num: "",
        ip_outs: 0,
        h: 0,
        r: 0,
        er: 0,
        bb: 0,
        so: 0,
        hr: 0,
        decision: "",
      },
    ]);
  }
  function removePit(side: "away" | "home", i: number) {
    const setter = side === "away" ? setAwayPitchers : setHomePitchers;
    setter((cur) => cur.filter((_, idx) => idx !== i));
  }
  function updateInning(side: "away" | "home", i: number, val: number) {
    setInnings((cur) => ({
      ...cur,
      [side]: cur[side].map((n, idx) => (idx === i ? val : n)),
    }));
  }
  function addInning() {
    setInnings((cur) => ({
      away: [...cur.away, 0],
      home: [...cur.home, 0],
    }));
  }

  // ── Save lineup helper (writes to lineups/{game}_{team}) ────────
  async function persistLineup(
    side: "away" | "home",
    rows: BatRow[],
  ): Promise<void> {
    if (!tenantId || !game) return;
    const sideTeamId =
      side === "away" ? game.away_team_id : game.home_team_id;
    const db = getDb();
    await setDoc(
      doc(db, `leagues/${tenantId}/lineups/${gameId}_${sideTeamId}`),
      {
        team_id: sideTeamId,
        game_id: gameId,
        order: rows.map((b) => ({
          player_id: b.player_id,
          name: b.name,
          num: b.num,
        })),
        updated_at: serverTimestamp(),
      },
    );
  }

  // Only persist the captain's OWN team's lineup — Firestore rules
  // (firestore.rules:130–135) anchor lineup writes to the captain's
  // team_id. Writing the opposing team's lineup throws a rules
  // violation. For the opposing side, we keep the order in local
  // state for the in-session wizard and let the OTHER captain's
  // submission own that side's data.
  const captainsSide: "away" | "home" = teamId === game!.home_team_id
    ? "home"
    : "away";

  // Captain must pick a pitcher on their own team's lineup step
  // before advancing — unless they're submitting Score Only for that
  // side. The opposing side's lineup step never blocks (the other
  // captain owns that pitching anyway).
  function awayCanAdvance(): { ok: boolean; reason?: string } {
    if (captainsSide !== "away") return { ok: true };
    if (scoreOnly.away) return { ok: true };
    if (awayPitchers.length === 0) {
      return {
        ok: false,
        reason: "Pick at least one pitcher for your team before continuing (or use Skip if you're not submitting stats).",
      };
    }
    return { ok: true };
  }
  function homeCanAdvance(): { ok: boolean; reason?: string } {
    if (captainsSide !== "home") return { ok: true };
    if (scoreOnly.home) return { ok: true };
    if (homePitchers.length === 0) {
      return {
        ok: false,
        reason: "Pick at least one pitcher for your team before continuing (or use Skip if you're not submitting stats).",
      };
    }
    return { ok: true };
  }

  async function nextFromAway() {
    const gate = awayCanAdvance();
    if (!gate.ok) {
      setServerError(gate.reason ?? "Pick a pitcher first.");
      return;
    }
    setSaving(true);
    setServerError(null);
    try {
      if (captainsSide === "away") {
        await persistLineup("away", awayLineup);
      }
      setStep("lineupHome");
    } catch (e) {
      setServerError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }
  async function nextFromHome() {
    const gate = homeCanAdvance();
    if (!gate.ok) {
      setServerError(gate.reason ?? "Pick a pitcher first.");
      return;
    }
    setSaving(true);
    setServerError(null);
    try {
      if (captainsSide === "home") {
        await persistLineup("home", homeLineup);
      }
      setStep("stats");
    } catch (e) {
      setServerError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  // "Skip — no stats for this team" — clears the lineup for that side,
  // turns on Score Only mode for that team, and advances. The stats
  // step will render the team's tab with a "Final Score" input
  // instead of full batting/pitching tables.
  function skipAway() {
    setAwayLineup([]);
    setAwayPitchers([]);
    setScoreOnly((cur) => ({ ...cur, away: true }));
    setStep("lineupHome");
  }
  function skipHome() {
    setHomeLineup([]);
    setHomePitchers([]);
    setScoreOnly((cur) => ({ ...cur, home: true }));
    setStep("stats");
  }

  // ── Submit (stats step) ─────────────────────────────────────────
  const isHome = game.home_team_id === teamId;
  const myLineup = isHome ? homeLineup : awayLineup;
  const myPitchers = isHome ? homePitchers : awayPitchers;
  const myInnings = isHome ? innings.home : innings.away;
  const myErrors = isHome ? errors.home : errors.away;

  const myH = myLineup.reduce((a, b) => a + (Number(b.h) || 0), 0);
  const myLineRTotal = myInnings.reduce(
    (a, b) => a + (Number(b) || 0),
    0,
  );
  const myBatRTotal = myLineup.reduce(
    (a, b) => a + (Number(b.r) || 0),
    0,
  );
  const linescoreEntered = myInnings.some((n) => Number(n) > 0);
  // Authoritative team R precedence:
  //   1. Score-Only mode toggled → finalScores[side] is the score.
  //      Batting / linescore are ignored.
  //   2. Batting stats entered → batting R sum is authoritative.
  //      Per-inning cells are reference; the warning fires if they
  //      disagree.
  //   3. Otherwise fall back to linescore inning sum (pure
  //      score-only with per-inning detail).
  const mySide: "away" | "home" = isHome ? "home" : "away";
  const myScoreOnly = scoreOnly[mySide];
  const myFinalScoreOverride = finalScores[mySide];
  const battingHasData = myLineup.some(
    (b) => (Number(b.ab) || 0) > 0 || (Number(b.r) || 0) > 0 || (Number(b.h) || 0) > 0,
  );
  const myFinalR = myScoreOnly
    ? myFinalScoreOverride ?? 0
    : battingHasData
      ? myBatRTotal
      : linescoreEntered
        ? myLineRTotal
        : 0;

  const validation: string[] = [];
  // Score Only mode: validate only that a final score is entered.
  // Per-batter rules (H ≤ AB etc) don't apply when there are no
  // individual stats.
  if (myScoreOnly) {
    if (myFinalScoreOverride == null) {
      validation.push(
        "Enter a final score for your team (Score Only mode).",
      );
    }
  } else {
    // Guard against an entirely empty submission. Captain has to put
    // SOMETHING in: at least one batter with non-zero AB, OR a
    // linescore row, OR they should have toggled Score Only mode for
    // their team. Otherwise they're saving an empty box that
    // overwrites a real one if there is any.
    const hasAnyBatterData = myLineup.some(
      (b) =>
        b.name &&
        ((Number(b.ab) || 0) > 0 ||
          (Number(b.h) || 0) > 0 ||
          (Number(b.r) || 0) > 0),
    );
    if (!hasAnyBatterData && !linescoreEntered) {
      validation.push(
        "No batting data entered. Add per-batter stats, fill in the linescore, or toggle Score Only mode for your team.",
      );
    }
    for (const b of myLineup) {
      if (!b.name) continue;
      const ab = Number(b.ab) || 0;
      const h = Number(b.h) || 0;
      const xb =
        (Number(b.doubles) || 0) +
        (Number(b.triples) || 0) +
        (Number(b.hr) || 0);
      if (h > ab) validation.push(`${b.name}: H (${h}) > AB (${ab})`);
      if (xb > h) validation.push(`${b.name}: 2B+3B+HR (${xb}) > H (${h})`);
    }
  }

  async function submit() {
    if (!tenantId || !teamId || !gameId || !user) return;
    if (validation.length > 0) return;
    setSaving(true);
    setServerError(null);
    try {
      const db = getDb();
      const subId = `${gameId}_${teamId}`;
      // Score-Only mode: save a stripped submission with score_only:
      // true and only the final score. Recalc skips this team's
      // players (no roll-up). Public box score will render '–' for
      // the team's batting/pitching tables.
      // Captain may also submit data for the OPPOSING team —
      // either a Score-Only final score (skip-the-stats path) or
      // full batting + pitching detail (kept-the-book-for-both
      // path). The endpoint promotes the opposing-side data
      // conditionally: it won't overwrite a real submission from
      // the opposing captain.
      const oppSide: "away" | "home" = isHome ? "away" : "home";
      const oppScoreOnly = scoreOnly[oppSide];
      const oppFinalScore = finalScores[oppSide];
      const oppLineup = oppSide === "away" ? awayLineup : homeLineup;
      const oppPitchers =
        oppSide === "away" ? awayPitchers : homePitchers;
      const oppHasFullData =
        !oppScoreOnly &&
        (oppLineup.length > 0 || oppPitchers.length > 0);

      const oppInnings = innings[oppSide];
      const oppErrors = errors[oppSide];
      const oppHasLinescore = oppInnings.some((n) => n > 0);

      const oppFields = oppScoreOnly && oppFinalScore != null
        ? {
            opp_score_only: true,
            opp_side: oppSide,
            opp_final_score: oppFinalScore,
          }
        : oppHasFullData || oppHasLinescore
          ? {
              opp_side: oppSide,
              opp_lineup: oppLineup.filter((b) => b.name),
              opp_pitchers: oppPitchers.filter((p) => p.name),
              opp_linescore: oppHasLinescore ? oppInnings : [],
              opp_errors: oppErrors,
            }
          : {};

      const payload = myScoreOnly
        ? {
            game_id: gameId,
            team_id: teamId,
            side: isHome ? "home" : "away",
            score_only: true,
            final_score: myFinalScoreOverride ?? 0,
            lineup: [],
            pitchers: [],
            linescore: [],
            hits: 0,
            errors: 0,
            score: myFinalScoreOverride ?? 0,
            ...oppFields,
            submitted_at: serverTimestamp(),
            submitted_by_uid: user.uid,
          }
        : {
            game_id: gameId,
            team_id: teamId,
            side: isHome ? "home" : "away",
            score_only: false,
            lineup: myLineup.filter((b) => b.name),
            pitchers: myPitchers.filter((p) => p.name),
            linescore: linescoreEntered ? myInnings : [],
            hits: myH,
            errors: myErrors,
            score: myFinalR,
            ...oppFields,
            submitted_at: serverTimestamp(),
            submitted_by_uid: user.uid,
          };
      await setDoc(
        doc(db, `leagues/${tenantId}/box_score_submissions/${subId}`),
        payload,
      );
      // Promote to /box_scores + run recalc + fire push triggers.
      // CRITICAL: await this — earlier fire-and-forget swallowed
      // server errors silently (captain sees "Submitted" but the
      // public box-score doc never updates, recalc never runs, push
      // triggers never fire). If the promotion fails, surface it so
      // they can retry. Their private lane is already saved, so a
      // retry is safe.
      const idToken = await user.getIdToken();
      const res = await fetch("/api/captain-submit", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ leagueId: tenantId, gameId }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setServerError(
          (data.error ?? `Submit promotion failed (HTTP ${res.status}).`) +
            " Your edits are saved — try Submit again in a moment.",
        );
        setSaving(false);
        return;
      }
      setSavedAt(new Date());
    } catch (e: unknown) {
      setServerError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────
  return (
    <main className="le-cap-shell" style={{ paddingTop: 28 }}>
      <div style={{ padding: "0 28px 18px" }}>
        <Link
          href="/captain"
          className="font-barlow"
          style={{
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--muted)",
            textDecoration: "none",
          }}
        >
          ← Back to dashboard
        </Link>
        <h1
          className="font-barlow"
          style={{
            fontSize: "clamp(28px, 4vw, 40px)",
            fontWeight: 900,
            textTransform: "uppercase",
            margin: "8px 0 4px",
            lineHeight: 1,
          }}
        >
          {game.away_team_name} @ {game.home_team_name}
        </h1>
        <p style={{ fontSize: 13, color: "var(--muted)" }}>
          {step === "lineupAway"
            ? "Step 1 of 3 · Set the AWAY batting order."
            : step === "lineupHome"
              ? "Step 2 of 3 · Set the HOME batting order."
              : "Step 3 of 3 · Enter stats. Submit when done."}
        </p>
      </div>

      {step === "lineupAway" && (
        <LineupStep
          side="away"
          teamName={game.away_team_name}
          roster={awayRoster}
          order={awayLineup}
          custom={awayCustom}
          pitchers={awayPitchers}
          onToggle={(p) => pickToggle("away", p)}
          onRemoveAt={(i) => pickRemoveAt("away", i)}
          onMoveTo={(from, to) => pickMoveTo("away", from, to)}
          onAddCustom={(n, num) => pickAddCustom("away", n, num)}
          onRemoveCustom={(id) => pickRemoveCustom("away", id)}
          onApplyDummy={(c) => pickApplyDummy("away", c)}
          onAddPitcher={(p) => pickAddPitcher("away", p)}
          onRemovePitcher={(i) => removePit("away", i)}
          footer={
            <>
              <div className="bs-step-footer-row">
                <Link href="/captain" className="le-cap-btn-secondary">
                  Cancel
                </Link>
                <button
                  type="button"
                  className="le-cap-btn-secondary"
                  onClick={skipAway}
                  title="Skip away team's lineup and stats — fill in only what you have"
                >
                  Skip (no away stats)
                </button>
                <button
                  type="button"
                  className="le-cap-btn-primary"
                  disabled={saving}
                  onClick={nextFromAway}
                >
                  {saving
                    ? "Saving…"
                    : `Next: ${game.home_team_name} Lineup →`}
                </button>
              </div>
              {serverError && (
                <p
                  style={{
                    margin: "10px 0 0",
                    fontSize: 13,
                    color: "#dc2626",
                  }}
                >
                  {serverError}
                </p>
              )}
            </>
          }
        />
      )}

      {step === "lineupHome" && (
        <LineupStep
          side="home"
          teamName={game.home_team_name}
          roster={homeRoster}
          order={homeLineup}
          custom={homeCustom}
          pitchers={homePitchers}
          onToggle={(p) => pickToggle("home", p)}
          onRemoveAt={(i) => pickRemoveAt("home", i)}
          onMoveTo={(from, to) => pickMoveTo("home", from, to)}
          onAddCustom={(n, num) => pickAddCustom("home", n, num)}
          onRemoveCustom={(id) => pickRemoveCustom("home", id)}
          onApplyDummy={(c) => pickApplyDummy("home", c)}
          onAddPitcher={(p) => pickAddPitcher("home", p)}
          onRemovePitcher={(i) => removePit("home", i)}
          footer={
            <>
              <div className="bs-step-footer-row">
                <button
                  type="button"
                  className="le-cap-btn-secondary"
                  onClick={() => setStep("lineupAway")}
                >
                  ← Back
                </button>
                <button
                  type="button"
                  className="le-cap-btn-secondary"
                  onClick={skipHome}
                  title="Skip home team's lineup and stats — fill in only what you have"
                >
                  Skip (no home stats)
                </button>
                <button
                  type="button"
                  className="le-cap-btn-primary"
                  disabled={saving}
                  onClick={nextFromHome}
                >
                  {saving ? "Saving…" : "Enter Box Score →"}
                </button>
              </div>
              {serverError && (
                <p
                  style={{
                    margin: "10px 0 0",
                    fontSize: 13,
                    color: "#dc2626",
                  }}
                >
                  {serverError}
                </p>
              )}
            </>
          }
        />
      )}

      {step === "stats" && (
        <StatsStep
          game={game}
          batCols={batCols}
          pitCols={pitCols}
          activeTab={activeStatsTab}
          setActiveTab={(t) => {
            setActiveTabPinned(true);
            setActiveStatsTab(t);
          }}
          awayLineup={awayLineup}
          homeLineup={homeLineup}
          awayPitchers={awayPitchers}
          homePitchers={homePitchers}
          innings={innings}
          errors={errors}
          isHome={isHome}
          myFinalR={myFinalR}
          myH={myH}
          validation={validation}
          saving={saving}
          savedAt={savedAt}
          serverError={serverError}
          onUpdateBat={updateBat}
          onMoveBat={moveBat}
          onUpdatePit={updatePit}
          onAddPitcherFromRoster={(side, p) => pickAddPitcher(side, p)}
          onRemovePit={removePit}
          awayRoster={awayRoster}
          homeRoster={homeRoster}
          awayCustom={awayCustom}
          homeCustom={homeCustom}
          onUpdateInning={updateInning}
          onAddInning={addInning}
          onSetErrors={(side, v) =>
            setErrors((cur) => ({ ...cur, [side]: v }))
          }
          scoreOnly={scoreOnly}
          onSetScoreOnly={(side, v) =>
            setScoreOnly((cur) => ({ ...cur, [side]: v }))
          }
          finalScores={finalScores}
          onSetFinalScore={(side, v) =>
            setFinalScores((cur) => ({ ...cur, [side]: v }))
          }
          mySide={isHome ? "home" : "away"}
          onBack={() => setStep("lineupHome")}
          onSubmit={submit}
        />
      )}
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────
// LineupStep — DVSL makeStep equivalent (captain.html lines 3516–3545).
// One per side; the parent decides which side is active.
function LineupStep({
  side,
  teamName,
  roster,
  custom,
  order,
  pitchers,
  onToggle,
  onRemoveAt,
  onMoveTo,
  onAddCustom,
  onRemoveCustom,
  onApplyDummy,
  onAddPitcher,
  onRemovePitcher,
  footer,
}: {
  side: "away" | "home";
  teamName: string;
  roster: RosterPlayer[];
  custom: RosterPlayer[];
  order: BatRow[];
  pitchers: PitRow[];
  onToggle: (p: RosterPlayer) => void;
  onRemoveAt: (i: number) => void;
  onMoveTo: (from: number, to: number) => void;
  onAddCustom: (name: string, num: string) => void;
  onRemoveCustom: (playerId: string) => void;
  onApplyDummy: (count: number) => void;
  onAddPitcher: (p: RosterPlayer) => void;
  onRemovePitcher: (i: number) => void;
  footer: React.ReactNode;
}) {
  const [customName, setCustomName] = useState("");
  const [customNum, setCustomNum] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [dummyCount, setDummyCount] = useState(9);

  return (
    <div className="bs-step-wrap">
      <div className="bs-step-head">
        <span>
          {side === "away" ? "▲ AWAY" : "▼ HOME"}: {teamName.toUpperCase()}
        </span>
        <span className="bs-step-hint">Tap to set batting order</span>
      </div>

      <div className="lp-grid">
        {roster.length === 0 && order.length === 0 && (
          <p
            style={{
              gridColumn: "1 / -1",
              padding: 14,
              color: "var(--muted)",
              fontSize: 13,
            }}
          >
            No roster on file. Use "+ Add Player" or "Apply" dummy to
            build the lineup manually.
          </p>
        )}
        {roster.map((p) => {
          const slot = order.findIndex((b) => b.player_id === p.id);
          const selected = slot >= 0;
          return (
            <button
              key={p.id}
              type="button"
              className={"lp-card" + (selected ? " lp-sel" : "")}
              onClick={() => onToggle(p)}
            >
              {selected && <span className="lp-badge">{slot + 1}</span>}
              <span className="lp-cj">
                {p.jersey != null ? `#${p.jersey}` : ""}
              </span>
              <span className="lp-cn">{p.name}</span>
            </button>
          );
        })}
        {/* Custom-added (walk-on) players sit alongside the roster
         *  as their own cards. Card stays visible even when deselected
         *  so captain can re-tap to add back. The small × in the top
         *  corner deletes the card entirely (DVSL's "remove from grid"
         *  behaviour). Tapping the card body toggles inclusion in the
         *  lineup, same as roster cards. */}
        {custom.map((p) => {
          const slot = order.findIndex((b) => b.player_id === p.id);
          const selected = slot >= 0;
          return (
            <div key={p.id} className="lp-card-wrap">
              <button
                type="button"
                className={"lp-card" + (selected ? " lp-sel" : "")}
                onClick={() => onToggle(p)}
              >
                {selected && <span className="lp-badge">{slot + 1}</span>}
                <span className="lp-cj">
                  {p.jersey != null ? `#${p.jersey}` : ""}
                </span>
                <span className="lp-cn">{p.name}</span>
              </button>
              <button
                type="button"
                className="lp-card-delete"
                onClick={() => onRemoveCustom(p.id)}
                aria-label="Delete this walk-on player"
                title="Delete this player from the grid"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      <div className="lp-strip">
        {order.length === 0 ? (
          <span className="lp-strip-empty">
            Tap players above to build batting order
          </span>
        ) : (
          order.map((e, i) => (
            <span key={i} className="lp-chip">
              {/* The slot number is a clickable dropdown — pick any
                  position 1..N to move this batter directly there.
                  No more up/down clicking. */}
              <select
                className="lp-chip-slot"
                value={i + 1}
                onChange={(ev) =>
                  onMoveTo(i, Number(ev.target.value) - 1)
                }
                aria-label={`Batting slot for ${e.name}`}
                title="Click to change batting order position"
              >
                {order.map((_, idx) => (
                  <option key={idx} value={idx + 1}>
                    {idx + 1}
                  </option>
                ))}
              </select>
              {e.num && <span className="lp-chip-num">#{e.num}</span>}
              <span>{e.name}</span>
              <button
                type="button"
                className="lp-chip-x"
                onClick={() => onRemoveAt(i)}
                aria-label="Remove from lineup"
              >
                ×
              </button>
            </span>
          ))
        )}
      </div>

      <div className="bs-step-tools">
        <button
          type="button"
          className="le-cap-btn-secondary"
          onClick={() => setShowAdd((v) => !v)}
        >
          + Add Player
        </button>
        <div className="bs-step-dummy">
          <span className="bs-step-dummy-lbl">Dummy:</span>
          <input
            type="number"
            min={1}
            max={20}
            value={dummyCount}
            onChange={(e) =>
              setDummyCount(Number(e.target.value) || 9)
            }
            className="bs-step-dummy-num"
          />
          <button
            type="button"
            className="le-cap-btn-secondary"
            onClick={() => onApplyDummy(dummyCount)}
          >
            Apply
          </button>
        </div>
      </div>

      {showAdd && (
        <div className="bs-step-addrow">
          <input
            type="text"
            placeholder="Player name"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onAddCustom(customName, customNum);
                setCustomName("");
                setCustomNum("");
              }
            }}
            className="lp-add-input"
          />
          <input
            type="text"
            placeholder="#"
            value={customNum}
            onChange={(e) => setCustomNum(e.target.value)}
            className="lp-add-num"
          />
          <button
            type="button"
            className="le-cap-btn-primary"
            onClick={() => {
              onAddCustom(customName, customNum);
              setCustomName("");
              setCustomNum("");
            }}
          >
            Add to Order
          </button>
        </div>
      )}

      <PitcherPicker
        roster={roster}
        custom={custom}
        pitchers={pitchers}
        onAdd={onAddPitcher}
        onRemove={onRemovePitcher}
      />

      <div className="bs-step-footer">{footer}</div>
    </div>
  );
}

/* Inline pitcher selector for the lineup step. Captain picks from
 * the team's roster + walk-ons via a dropdown — matches Adam's
 * request to drop the free-text name field. Selected pitchers
 * appear as chips below; tap × to remove. Stat columns are filled
 * in later on the stats step. */
function PitcherPicker({
  roster,
  custom,
  pitchers,
  onAdd,
  onRemove,
}: {
  roster: RosterPlayer[];
  custom: RosterPlayer[];
  pitchers: PitRow[];
  onAdd: (p: RosterPlayer) => void;
  onRemove: (i: number) => void;
}) {
  const [draft, setDraft] = useState("");
  const all = [...roster, ...custom];
  const eligible = all.filter(
    (p) => !pitchers.some((pp) => pp.player_id === p.id),
  );
  return (
    <div className="bs-pitcher-picker">
      <div className="bs-pitcher-head">
        <span className="bs-pitcher-title">⚾ Pitcher</span>
        <span className="bs-pitcher-hint">
          Pick from your roster — stats go on the next step
        </span>
      </div>

      {pitchers.length === 0 ? (
        <p className="lp-strip-empty" style={{ padding: "8px 14px" }}>
          No pitcher selected yet — pick one below.
        </p>
      ) : (
        <div className="bs-pitcher-chips">
          {pitchers.map((p, i) => (
            <span key={i} className="lp-chip">
              {p.num && <span className="lp-chip-num">#{p.num}</span>}
              <span>{p.name}</span>
              <button
                type="button"
                className="lp-chip-x"
                onClick={() => onRemove(i)}
                aria-label="Remove pitcher"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="bs-pitcher-add">
        <select
          value={draft}
          onChange={(e) => {
            const id = e.target.value;
            if (!id) return;
            const player = all.find((x) => x.id === id);
            if (player) onAdd(player);
            setDraft("");
          }}
          className="bs-pitcher-select"
        >
          <option value="">+ Add pitcher from roster…</option>
          {eligible.map((p) => (
            <option key={p.id} value={p.id}>
              {p.jersey != null ? `#${p.jersey} ` : ""}
              {p.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// StatsStep — DVSL _renderBsStats equivalent (captain.html lines
// 3406–3479). Big scoreboard, linescore, tab toggle, batting +
// pitching tables, submit bar.
function StatsStep(props: {
  game: GameSnap;
  batCols: StatCol[];
  pitCols: StatCol[];
  activeTab: "away" | "home";
  setActiveTab: (t: "away" | "home") => void;
  awayLineup: BatRow[];
  homeLineup: BatRow[];
  awayPitchers: PitRow[];
  homePitchers: PitRow[];
  innings: { away: number[]; home: number[] };
  errors: { away: number; home: number };
  isHome: boolean;
  myFinalR: number;
  myH: number;
  validation: string[];
  saving: boolean;
  savedAt: Date | null;
  serverError: string | null;
  onUpdateBat: (side: "away" | "home", i: number, key: string, val: number) => void;
  onMoveBat: (side: "away" | "home", i: number, dir: -1 | 1) => void;
  onUpdatePit: (side: "away" | "home", i: number, key: string, val: string | number) => void;
  onAddPitcherFromRoster: (side: "away" | "home", p: RosterPlayer) => void;
  onRemovePit: (side: "away" | "home", i: number) => void;
  awayRoster: RosterPlayer[];
  homeRoster: RosterPlayer[];
  awayCustom: RosterPlayer[];
  homeCustom: RosterPlayer[];
  onUpdateInning: (side: "away" | "home", i: number, val: number) => void;
  onAddInning: () => void;
  onSetErrors: (side: "away" | "home", v: number) => void;
  scoreOnly: { away: boolean; home: boolean };
  onSetScoreOnly: (side: "away" | "home", v: boolean) => void;
  finalScores: { away: number | null; home: number | null };
  onSetFinalScore: (side: "away" | "home", v: number | null) => void;
  /** The captain's own side — they can only edit their own. */
  mySide: "away" | "home";
  onBack: () => void;
  onSubmit: () => void;
}) {
  const {
    game,
    batCols,
    pitCols,
    activeTab,
    setActiveTab,
    awayLineup,
    homeLineup,
    awayPitchers,
    homePitchers,
    innings,
    errors,
    isHome,
    validation,
    saving,
    savedAt,
    serverError,
    onUpdateBat,
    onMoveBat,
    onUpdatePit,
    onAddPitcherFromRoster,
    onRemovePit,
    onUpdateInning,
    onAddInning,
    onSetErrors,
    scoreOnly,
    onSetScoreOnly,
    finalScores,
    onSetFinalScore,
    mySide,
    awayRoster,
    homeRoster,
    awayCustom,
    homeCustom,
    onBack,
    onSubmit,
  } = props;

  const awayLineR = innings.away.reduce((a, b) => a + (b || 0), 0);
  const homeLineR = innings.home.reduce((a, b) => a + (b || 0), 0);
  const awayBatR = awayLineup.reduce((a, b) => a + (b.r || 0), 0);
  const homeBatR = homeLineup.reduce((a, b) => a + (b.r || 0), 0);
  const awayBatHasData = awayLineup.some(
    (b) => (b.ab || 0) > 0 || (b.r || 0) > 0 || (b.h || 0) > 0,
  );
  const homeBatHasData = homeLineup.some(
    (b) => (b.ab || 0) > 0 || (b.r || 0) > 0 || (b.h || 0) > 0,
  );
  // Score-Only mode wins; else batting; else linescore.
  const awayR = scoreOnly.away
    ? finalScores.away ?? 0
    : awayBatHasData
      ? awayBatR
      : innings.away.some((n) => n > 0)
        ? awayLineR
        : 0;
  const homeR = scoreOnly.home
    ? finalScores.home ?? 0
    : homeBatHasData
      ? homeBatR
      : innings.home.some((n) => n > 0)
        ? homeLineR
        : 0;
  const awayH = awayLineup.reduce((a, b) => a + (b.h || 0), 0);
  const homeH = homeLineup.reduce((a, b) => a + (b.h || 0), 0);

  return (
    <div style={{ padding: "0 28px 36px" }}>
      <button
        type="button"
        className="le-cap-btn-secondary"
        onClick={onBack}
        style={{ marginBottom: 16 }}
      >
        ← Back to Lineups
      </button>

      {/* Big scoreboard */}
      <div className="bs-cap-scoreboard">
        <div className="bs-cap-team">
          <div className="bs-cap-team-abbr">
            {game.away_team_name.toUpperCase()}
          </div>
          <div className="bs-cap-team-side">AWAY</div>
        </div>
        <div className="bs-cap-score-mid">
          <span className="bs-cap-score">{awayR}</span>
          <span className="bs-cap-dash">–</span>
          <span className="bs-cap-score">{homeR}</span>
        </div>
        <div className="bs-cap-team">
          <div className="bs-cap-team-abbr">
            {game.home_team_name.toUpperCase()}
          </div>
          <div className="bs-cap-team-side">HOME</div>
        </div>
      </div>

      {/* Linescore — both teams */}
      <div className="bs-cap-section-head">
        <h2 className="le-cap-section-title">Line Score</h2>
        <button
          type="button"
          className="le-cap-btn-secondary"
          onClick={onAddInning}
        >
          + Extra Inning
        </button>
      </div>
      <p className="bs-cap-hint">
        Per-inning runs are optional reference. The R column comes from
        each team's batting stats — entering an inning here won't
        overwrite that.
      </p>
      {(awayBatHasData &&
        innings.away.some((n) => n > 0) &&
        awayLineR !== awayBatR) ||
      (homeBatHasData &&
        innings.home.some((n) => n > 0) &&
        homeLineR !== homeBatR) ? (
        <div
          className="bs-cap-warn"
          style={{ marginTop: 0, marginBottom: 10 }}
        >
          <strong>Heads up:</strong> the inning runs you entered don't
          add up to the batting R total. The team R stays from batting
          ({" "}
          {awayBatR}–{homeBatR}) — double-check the per-inning numbers
          before submitting.
        </div>
      ) : null}
      <div className="bs-cap-ls-wrap">
        <table className="bs-cap-ls">
          <thead>
            <tr>
              <th className="left">Team</th>
              {innings.away.map((_, i) => (
                <th key={i}>{i + 1}</th>
              ))}
              <th className="rhe">R</th>
              <th className="rhe">H</th>
              <th className="rhe">E</th>
            </tr>
          </thead>
          <tbody>
            <LinescoreRow
              label={game.away_team_name}
              line={innings.away}
              r={awayR}
              h={awayH}
              e={errors.away}
              // Both rows always editable — captain may keep the
              // book for either or both teams, AND linescore stays
              // available even in Score Only mode (caller may know
              // per-inning runs without individual batting stats).
              editable
              rOverride={finalScores.away}
              onUpdate={(i, v) => onUpdateInning("away", i, v)}
              onSetE={(v) => onSetErrors("away", v)}
              onSetR={(v) => onSetFinalScore("away", v)}
            />
            <LinescoreRow
              label={game.home_team_name}
              line={innings.home}
              r={homeR}
              h={homeH}
              e={errors.home}
              editable
              rOverride={finalScores.home}
              onUpdate={(i, v) => onUpdateInning("home", i, v)}
              onSetE={(v) => onSetErrors("home", v)}
              onSetR={(v) => onSetFinalScore("home", v)}
            />
          </tbody>
        </table>
      </div>

      {/* Tabs — captain's own side is marked "(YOU)" so they always
       *  know which tab is theirs at a glance. */}
      <div className="bs-cap-tabs">
        <button
          type="button"
          className={
            "bs-cap-tab" + (activeTab === "away" ? " active" : "")
          }
          onClick={() => setActiveTab("away")}
        >
          ▲ {game.away_team_name}
          {mySide === "away" && (
            <span className="bs-cap-tab-you"> (YOU)</span>
          )}
        </button>
        <button
          type="button"
          className={
            "bs-cap-tab" + (activeTab === "home" ? " active" : "")
          }
          onClick={() => setActiveTab("home")}
        >
          ▼ {game.home_team_name}
          {mySide === "home" && (
            <span className="bs-cap-tab-you"> (YOU)</span>
          )}
        </button>
      </div>

      {/* Per-team mode toggle — visible on both tabs.
       *  Captains can submit full stats for BOTH teams if they want
       *  to (e.g. they kept the book for the whole game). The 3-lane
       *  model means the opposing captain may still submit their own
       *  version separately; admin reconciles any disagreement. */}
      <div className="bs-cap-mode-toggle" role="tablist">
        <button
          type="button"
          role="tab"
          className={
            "bs-cap-mode-btn" +
            (!scoreOnly[activeTab] ? " active" : "")
          }
          aria-selected={!scoreOnly[activeTab]}
          onClick={() => onSetScoreOnly(activeTab, false)}
        >
          📊 Full Box Score
        </button>
        <button
          type="button"
          role="tab"
          className={
            "bs-cap-mode-btn" +
            (scoreOnly[activeTab] ? " active" : "")
          }
          aria-selected={scoreOnly[activeTab]}
          onClick={() => onSetScoreOnly(activeTab, true)}
        >
          📝 Score Only
        </button>
        {activeTab !== mySide && (
          <span className="bs-cap-mode-hint">
            (opposing captain may also submit — admin resolves)
          </span>
        )}
      </div>

      {/* Batting + pitching for the active tab — OR a single
          "Final Score" input when Score Only mode is on. */}
      {scoreOnly[activeTab] ? (
        <div className="bs-cap-score-only-panel">
          <p className="bs-cap-score-only-blurb">
            <strong>Score Only mode.</strong> No batting or pitching
            stats will be saved for{" "}
            <strong>
              {activeTab === "away"
                ? game.away_team_name
                : game.home_team_name}
            </strong>
            . Enter the result up in the <strong>line score</strong>{" "}
            above — type per-inning runs, or skip straight to the R
            cell to record the final total. The public box score will
            show "–" for individual stats but keep your line score.
          </p>
        </div>
      ) : (
        <>
          <BattingTable
            side={activeTab}
            cols={batCols}
            rows={activeTab === "away" ? awayLineup : homeLineup}
            // Captain can edit both teams if they want to — the
            // other captain's eventual submission may still come in
            // and conflict, but admin resolves it. Score Only mode
            // hides this table entirely (handled above).
            editable={!scoreOnly[activeTab]}
            onUpdate={(i, k, v) => onUpdateBat(activeTab, i, k, v)}
            onMove={(i, d) => onMoveBat(activeTab, i, d)}
          />

          <PitchingTable
            side={activeTab}
            cols={pitCols}
            rows={
              activeTab === "away" ? awayPitchers : homePitchers
            }
            editable={!scoreOnly[activeTab]}
            roster={activeTab === "away" ? awayRoster : homeRoster}
            custom={activeTab === "away" ? awayCustom : homeCustom}
            onUpdate={(i, k, v) => onUpdatePit(activeTab, i, k, v)}
            onAdd={(p) => onAddPitcherFromRoster(activeTab, p)}
            onRemove={(i) => onRemovePit(activeTab, i)}
          />
        </>
      )}

      {/* Submit */}
      <div className="le-lineup-savebar" style={{ marginTop: 24 }}>
        <button
          type="button"
          className="le-cap-btn-primary"
          onClick={onSubmit}
          disabled={saving || validation.length > 0}
        >
          {saving ? "Submitting…" : "✅ Submit Box Score"}
        </button>
        {savedAt && !serverError && (
          <span style={{ fontSize: 12, color: "#16a34a", fontWeight: 600 }}>
            ✓ Submitted {savedAt.toLocaleTimeString()} · stats recalculating
          </span>
        )}
        {serverError && (
          <span style={{ fontSize: 12, color: "#dc2626" }}>
            {serverError}
          </span>
        )}
      </div>

      {validation.length > 0 && (
        <div className="bs-cap-error">
          <p className="bs-cap-error-lbl">Fix before submitting:</p>
          <ul>
            {validation.map((v, i) => (
              <li key={i}>{v}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function LinescoreRow({
  label,
  line,
  r,
  h,
  e,
  editable,
  rOverride,
  onUpdate,
  onSetE,
  onSetR,
}: {
  label: string;
  line: number[];
  r: number;
  h: number;
  e: number;
  editable: boolean;
  /** If set, the user typed a manual R total (skipping innings).
   *  We render that value instead of the auto-computed `r`. */
  rOverride: number | null;
  onUpdate: (i: number, v: number) => void;
  onSetE: (v: number) => void;
  onSetR: (v: number | null) => void;
}) {
  // Editable R cell: shows the override if set, else the auto sum.
  // Typing into it sets the override; clearing it (empty) re-enables
  // the auto sum.
  const rDisplay = rOverride != null ? rOverride : r;
  return (
    <tr>
      <td className="left">{label}</td>
      {line.map((n, i) => (
        <td key={i}>
          {editable ? (
            <input
              type="number"
              min={0}
              value={n || ""}
              placeholder="-"
              onChange={(ev) =>
                onUpdate(i, Number(ev.target.value) || 0)
              }
              className="bs-cap-num"
            />
          ) : (
            <span style={{ color: "var(--muted)" }}>{n || "-"}</span>
          )}
        </td>
      ))}
      <td>
        {editable ? (
          <input
            type="number"
            min={0}
            value={rDisplay || ""}
            placeholder="0"
            title="Total runs — auto-fills from inning detail; type here to enter directly without per-inning data"
            onChange={(ev) =>
              onSetR(
                ev.target.value === ""
                  ? null
                  : Number(ev.target.value) || 0,
              )
            }
            className="bs-cap-num bs-cap-r"
          />
        ) : (
          <span className="rhe-total">{rDisplay}</span>
        )}
      </td>
      <td className="rhe-total">{h}</td>
      <td>
        {editable ? (
          <input
            type="number"
            min={0}
            value={e || ""}
            placeholder="0"
            onChange={(ev) => onSetE(Number(ev.target.value) || 0)}
            className="bs-cap-num"
          />
        ) : (
          <span style={{ color: "var(--muted)" }}>{e || 0}</span>
        )}
      </td>
    </tr>
  );
}

function BattingTable({
  side,
  cols,
  rows,
  editable,
  onUpdate,
  onMove,
}: {
  side: "away" | "home";
  cols: StatCol[];
  rows: BatRow[];
  editable: boolean;
  onUpdate: (i: number, key: string, val: number) => void;
  onMove: (i: number, dir: -1 | 1) => void;
}) {
  return (
    <>
      <h2 className="le-cap-section-title" style={{ marginTop: 18 }}>
        Batting · {side.toUpperCase()}
      </h2>
      <div className="bs-cap-table-wrap">
        <table className="bs-cap-stat-tbl">
          <thead>
            <tr>
              <th className="bs-cap-arrow-col"></th>
              <th className="left">Player</th>
              {cols.map((c) => (
                <th key={c.label}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={cols.length + 2}
                  className="left"
                  style={{
                    color: "var(--muted)",
                    fontStyle: "italic",
                    fontSize: 13,
                  }}
                >
                  No stats submitted for this team — only the final score
                  is recorded.
                </td>
              </tr>
            )}
            {rows.map((b, i) => (
              <tr key={i}>
                <td className="bs-cap-arrow-col">
                  {editable && (
                    <>
                      <button
                        type="button"
                        onClick={() => onMove(i, -1)}
                        disabled={i === 0}
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        onClick={() => onMove(i, 1)}
                        disabled={i === rows.length - 1}
                      >
                        ▼
                      </button>
                    </>
                  )}
                </td>
                <td className="left">
                  <span className="bs-cap-batter-num">{i + 1}</span>
                  <span className="bs-cap-batter-name">{b.name}</span>
                  {b.num && (
                    <span className="bs-cap-batter-num-small">#{b.num}</span>
                  )}
                </td>
                {cols.map((c) => (
                  <td key={c.label}>
                    {editable ? (
                      <input
                        type="number"
                        min={0}
                        value={(b[c.key as keyof BatStats] as number) || ""}
                        placeholder="0"
                        onChange={(e) =>
                          onUpdate(
                            i,
                            c.key as string,
                            Number(e.target.value) || 0,
                          )
                        }
                        className="bs-cap-num"
                      />
                    ) : (
                      <span>
                        {(b[c.key as keyof BatStats] as number) || 0}
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="bs-cap-arrow-col"></td>
              <td className="left">Totals</td>
              {cols.map((c) => (
                <td key={c.label}>
                  {rows.reduce(
                    (a, b) =>
                      a + (Number(b[c.key as keyof BatStats]) || 0),
                    0,
                  )}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}

function PitchingTable({
  side,
  cols,
  rows,
  editable,
  roster,
  custom,
  onUpdate,
  onAdd,
  onRemove,
}: {
  side: "away" | "home";
  cols: StatCol[];
  rows: PitRow[];
  editable: boolean;
  roster: RosterPlayer[];
  custom: RosterPlayer[];
  onUpdate: (i: number, key: string, val: string | number) => void;
  onAdd: (p: RosterPlayer) => void;
  onRemove: (i: number) => void;
}) {
  const all = [...roster, ...custom];
  const eligible = all.filter(
    (p) => !rows.some((r) => r.player_id === p.id),
  );
  return (
    <>
      <h2 className="le-cap-section-title" style={{ marginTop: 22 }}>
        Pitching · {side.toUpperCase()}
      </h2>
      <div className="bs-cap-table-wrap">
        <table className="bs-cap-stat-tbl">
          <thead>
            <tr>
              <th className="left">Pitcher</th>
              {cols.map((c) => (
                <th key={c.label}>{c.label}</th>
              ))}
              <th>Dec</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={cols.length + 3}
                  className="left"
                  style={{
                    color: "var(--muted)",
                    fontStyle: "italic",
                    fontSize: 13,
                  }}
                >
                  No pitchers added.
                </td>
              </tr>
            )}
            {rows.map((p, i) => (
              <tr key={i}>
                <td className="left">
                  <span className="bs-cap-batter-name">{p.name}</span>
                  {p.num && (
                    <span className="bs-cap-batter-num-small">
                      #{p.num}
                    </span>
                  )}
                </td>
                {cols.map((c) => (
                  <td key={c.label}>
                    {editable ? (
                      <input
                        type="number"
                        min={0}
                        value={(p[c.key as keyof PitRow] as number) || ""}
                        placeholder="0"
                        onChange={(e) =>
                          onUpdate(
                            i,
                            c.key as string,
                            Number(e.target.value) || 0,
                          )
                        }
                        className="bs-cap-num"
                      />
                    ) : (
                      <span>{(p[c.key as keyof PitRow] as number) || 0}</span>
                    )}
                  </td>
                ))}
                <td>
                  {editable ? (
                    <select
                      value={p.decision}
                      onChange={(e) =>
                        onUpdate(i, "decision", e.target.value)
                      }
                      className="bs-cap-select"
                    >
                      <option value="">—</option>
                      <option value="W">W</option>
                      <option value="L">L</option>
                      <option value="S">S</option>
                    </select>
                  ) : (
                    <span>{p.decision || "—"}</span>
                  )}
                </td>
                <td>
                  {editable && (
                    <button
                      type="button"
                      className="bs-cap-row-x"
                      onClick={() => onRemove(i)}
                      aria-label="Remove pitcher"
                    >
                      ×
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editable && (
        <select
          className="bs-pitcher-select"
          style={{ marginTop: 8 }}
          value=""
          onChange={(e) => {
            const id = e.target.value;
            if (!id) return;
            const player = all.find((x) => x.id === id);
            if (player) onAdd(player);
          }}
        >
          <option value="">+ Add pitcher from roster…</option>
          {eligible.map((p) => (
            <option key={p.id} value={p.id}>
              {p.jersey != null ? `#${p.jersey} ` : ""}
              {p.name}
            </option>
          ))}
        </select>
      )}
    </>
  );
}

// Helpers
function parseRoster(
  docs: FirebaseFirestore.QueryDocumentSnapshot[] | unknown[],
): RosterPlayer[] {
  const arr = docs as Array<{
    id: string;
    data: () => Record<string, unknown>;
  }>;
  return arr
    .map((p) => {
      const d = p.data();
      return {
        id: p.id,
        name: String(d.name ?? p.id),
        jersey: d.jersey != null ? Number(d.jersey) : null,
        position: d.position ? String(d.position) : null,
      };
    })
    .sort(
      (a, b) =>
        (a.jersey ?? 999) - (b.jersey ?? 999) ||
        a.name.localeCompare(b.name),
    );
}

function parseLineup(
  snap: { exists(): boolean; data?: () => Record<string, unknown> } | unknown,
): BatRow[] {
  const s = snap as {
    exists: () => boolean;
    data: () => Record<string, unknown>;
  };
  if (!s.exists()) return [];
  const order = (s.data().order ?? []) as Array<{
    player_id?: string | null;
    name?: string;
    num?: string;
  }>;
  return order.map((e) =>
    newBatRow({
      player_id: e.player_id ?? null,
      name: String(e.name ?? ""),
      num: String(e.num ?? ""),
    }),
  );
}
