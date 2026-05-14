// Shared data loader for the LBDC-style player profile.
//
// Both routes — /players/[id] (full page) and @modal/(.)players/[id]
// (intercepted modal) — call this to fetch + bucket the player's
// appearances. Returns the props PlayerProfileLBDC consumes.

import type { Firestore } from "firebase-admin/firestore";
import type {
  BattingLine,
  PitchingLine,
  RecentGame,
} from "@/components/ui/PlayerProfileLBDC";

export interface PlayerProfileData {
  found: boolean;
  name: string;
  photoUrl: string | null;
  team: { team_id: string; name: string; color?: string } | null;
  currentSeasonLabel: string;
  currentBatting: BattingLine | null;
  projectedBatting: BattingLine | null;
  careerBatting: BattingLine | null;
  recentGames: RecentGame[];
  pitchingBySeason: PitchingLine[];
  careerPitching: Omit<PitchingLine, "season"> | null;
  appearanceCount: number;
}

export async function loadPlayerProfileData(
  db: Firestore,
  tenantId: string,
  playerId: string,
): Promise<PlayerProfileData | null> {
  const playerSnap = await db
    .doc(`leagues/${tenantId}/players/${playerId}`)
    .get();
  if (!playerSnap.exists) return null;
  const data = playerSnap.data() ?? {};
  const name = String(data.name ?? playerId);
  const teamId = String(data.team_id ?? "");
  const photoUrl = data.photo_url ? String(data.photo_url) : null;

  let team: PlayerProfileData["team"] = null;
  if (teamId) {
    const teamSnap = await db.doc(`leagues/${tenantId}/teams/${teamId}`).get();
    if (teamSnap.exists) {
      const t = teamSnap.data() ?? {};
      team = {
        team_id: teamId,
        name: String(t.name ?? teamId),
        color: t.color ? String(t.color) : undefined,
      };
    }
  }

  const [boxesSnap, seasonsSnap, teamsSnap, gamesSnap] = await Promise.all([
    db.collection(`leagues/${tenantId}/box_scores`).get(),
    db.collection(`leagues/${tenantId}/seasons`).get(),
    db.collection(`leagues/${tenantId}/teams`).get(),
    db.collection(`leagues/${tenantId}/games`).get(),
  ]);

  const seasonName: Record<string, string> = {};
  for (const d of seasonsSnap.docs) {
    seasonName[d.id] = String(d.data().name ?? d.id);
  }
  const teamName: Record<string, string> = {};
  for (const d of teamsSnap.docs) {
    teamName[d.id] = String(d.data().name ?? d.id);
  }

  interface Appearance {
    gameId: string;
    season_id: string | null;
    date: string;
    opponentId: string;
    isHome: boolean;
    myScore: number;
    oppScore: number;
    batting: BoxLine | null;
    pitching: BoxLine | null;
  }
  const appearances: Appearance[] = [];
  for (const doc of boxesSnap.docs) {
    const b = doc.data();
    const awayTeam = String(b.away_team_id ?? "");
    const homeTeam = String(b.home_team_id ?? "");
    const date = String(b.date ?? "");
    const season_id =
      typeof b.season_id === "string" ? b.season_id : null;
    const myAwayLine = findLine(b.away_lineup, playerId);
    const myHomeLine = findLine(b.home_lineup, playerId);
    const myAwayPitch = findLine(b.away_pitchers, playerId);
    const myHomePitch = findLine(b.home_pitchers, playerId);
    const isAway = !!(myAwayLine || myAwayPitch);
    const isHomeSide = !!(myHomeLine || myHomePitch);
    if (!isAway && !isHomeSide) continue;
    const isHome = isHomeSide && !isAway;
    appearances.push({
      gameId: doc.id,
      season_id,
      date,
      opponentId: isHome ? awayTeam : homeTeam,
      isHome,
      myScore: Number(isHome ? b.home_score ?? 0 : b.away_score ?? 0),
      oppScore: Number(isHome ? b.away_score ?? 0 : b.home_score ?? 0),
      batting: isHome ? myHomeLine : myAwayLine,
      pitching: isHome ? myHomePitch : myAwayPitch,
    });
  }
  appearances.sort((a, b) => b.date.localeCompare(a.date));
  const currentSeasonId =
    appearances.find((a) => a.season_id)?.season_id ?? null;

  // Batting aggregates
  const careerBattingAcc = newBattingAcc();
  const currentBattingAcc = newBattingAcc();
  for (const ap of appearances) {
    if (!ap.batting) continue;
    addBatting(careerBattingAcc, ap.batting);
    if (currentSeasonId && ap.season_id === currentSeasonId) {
      addBatting(currentBattingAcc, ap.batting);
    }
  }
  const careerBatting = finalizeBatting(careerBattingAcc);
  const currentBatting = finalizeBatting(currentBattingAcc);

  // Projected
  let projectedBatting: BattingLine | null = null;
  if (currentBatting && currentBatting.gp > 0 && teamId) {
    const totalSeasonGames = gamesSnap.docs.filter((d) => {
      const g = d.data();
      const inDivision =
        String(g.home_team_id ?? "") === teamId ||
        String(g.away_team_id ?? "") === teamId;
      if (!inDivision) return false;
      const status = String(g.status ?? "");
      return (
        status === "scheduled" ||
        status === "final" ||
        status === "approved" ||
        status === "postponed"
      );
    }).length;
    if (totalSeasonGames > currentBatting.gp) {
      const scale = totalSeasonGames / currentBatting.gp;
      projectedBatting = projectBatting(currentBatting, scale);
    }
  }

  // Recent Games
  const recentGames: RecentGame[] = appearances.slice(0, 5).map((ap) => ({
    gameId: ap.gameId,
    date: ap.date,
    opponentName: teamName[ap.opponentId] ?? ap.opponentId,
    isHome: ap.isHome,
    myScore: ap.myScore,
    oppScore: ap.oppScore,
    result:
      ap.myScore > ap.oppScore ? "W" : ap.myScore < ap.oppScore ? "L" : "T",
    batting: ap.batting
      ? {
          ab: ap.batting.ab,
          r: ap.batting.r,
          h: ap.batting.h,
          doubles: ap.batting.doubles ?? 0,
          triples: ap.batting.triples ?? 0,
          hr: ap.batting.hr,
          rbi: ap.batting.rbi,
          bb: ap.batting.bb,
          so: ap.batting.so,
          sb: ap.batting.sb ?? 0,
        }
      : null,
  }));

  // Pitching — per season + career total
  type PitchAcc = ReturnType<typeof newPitchAcc>;
  const pitchAccBySeason = new Map<string, PitchAcc>();
  const careerPitchAcc = newPitchAcc(null);
  for (const ap of appearances) {
    if (!ap.pitching) continue;
    addPitching(careerPitchAcc, ap.pitching, ap.date);
    const key = ap.season_id ?? "__unknown";
    let bucket = pitchAccBySeason.get(key);
    if (!bucket) {
      bucket = newPitchAcc(ap.season_id);
      pitchAccBySeason.set(key, bucket);
    }
    addPitching(bucket, ap.pitching, ap.date);
  }
  // If every pitching bucket lacks a season_id (older tenants / SFBL
  // before the box_score schema change), don't render a single
  // "Unknown season" row that just duplicates the Career total —
  // drop the per-season table and let the Career footer carry the
  // numbers. When at least one season_id is present, only suppress
  // the unknown-season bucket itself.
  const allBuckets = [...pitchAccBySeason.values()];
  const haveAnySeason = allBuckets.some((b) => b.season_id);
  const pitchingBySeason: PitchingLine[] = (
    haveAnySeason ? allBuckets.filter((b) => b.season_id) : []
  )
    .sort((a, b) => b.latestDate.localeCompare(a.latestDate))
    .map((acc) => ({
      season: acc.season_id
        ? seasonName[acc.season_id] ?? acc.season_id
        : "Unknown season",
      app: acc.app,
      ip_outs: acc.ip_outs,
      w: acc.w,
      l: acc.l,
      sv: acc.sv,
      era: era(acc.er, acc.ip_outs),
      whip: whip(acc.h, acc.bb, acc.ip_outs),
      h: acc.h,
      r: acc.r,
      er: acc.er,
      bb: acc.bb,
      so: acc.so,
    }));
  const careerPitching = careerPitchAcc.app
    ? {
        app: careerPitchAcc.app,
        ip_outs: careerPitchAcc.ip_outs,
        w: careerPitchAcc.w,
        l: careerPitchAcc.l,
        sv: careerPitchAcc.sv,
        era: era(careerPitchAcc.er, careerPitchAcc.ip_outs),
        whip: whip(careerPitchAcc.h, careerPitchAcc.bb, careerPitchAcc.ip_outs),
        h: careerPitchAcc.h,
        r: careerPitchAcc.r,
        er: careerPitchAcc.er,
        bb: careerPitchAcc.bb,
        so: careerPitchAcc.so,
      }
    : null;

  const currentSeasonLabel =
    currentSeasonId && seasonName[currentSeasonId]
      ? labelForCurrentBatting(seasonName[currentSeasonId]!)
      : new Date().getFullYear().toString();

  return {
    found: true,
    name,
    photoUrl,
    team,
    currentSeasonLabel,
    currentBatting:
      currentBatting && currentBatting.gp > 0 ? currentBatting : null,
    projectedBatting,
    careerBatting:
      careerBatting && careerBatting.gp > 0 ? careerBatting : null,
    recentGames,
    pitchingBySeason,
    careerPitching,
    appearanceCount: appearances.length,
  };
}

// ── Internal helpers ───────────────────────────────────────────────

interface BoxLine {
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
  ip_outs: number;
  er: number;
  decision?: "W" | "L" | "S";
}

function findLine(arr: unknown, playerId: string): BoxLine | null {
  if (!Array.isArray(arr)) return null;
  for (const r of arr as Array<Record<string, unknown>>) {
    if (String(r.player_id ?? "") !== playerId) continue;
    return {
      ab: Number(r.ab ?? 0),
      r: Number(r.r ?? 0),
      h: Number(r.h ?? 0),
      doubles: Number(r.doubles ?? 0),
      triples: Number(r.triples ?? 0),
      hr: Number(r.hr ?? 0),
      rbi: Number(r.rbi ?? 0),
      bb: Number(r.bb ?? 0),
      so: Number(r.so ?? r.k ?? 0),
      sb: Number(r.sb ?? 0),
      ip_outs: Number(r.ip_outs ?? 0),
      er: Number(r.er ?? 0),
      decision:
        r.decision === "W" || r.decision === "L" || r.decision === "S"
          ? (r.decision as "W" | "L" | "S")
          : undefined,
    };
  }
  return null;
}

interface BattingAcc {
  gp: number;
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
}
function newBattingAcc(): BattingAcc {
  return {
    gp: 0, ab: 0, r: 0, h: 0, doubles: 0, triples: 0, hr: 0,
    rbi: 0, bb: 0, so: 0, sb: 0,
  };
}
function addBatting(acc: BattingAcc, line: BoxLine) {
  acc.gp += 1;
  acc.ab += line.ab;
  acc.r += line.r;
  acc.h += line.h;
  acc.doubles += line.doubles;
  acc.triples += line.triples;
  acc.hr += line.hr;
  acc.rbi += line.rbi;
  acc.bb += line.bb;
  acc.so += line.so;
  acc.sb += line.sb;
}
function finalizeBatting(acc: BattingAcc): BattingLine | null {
  if (acc.gp === 0) return null;
  return { ...acc, avg: acc.ab > 0 ? acc.h / acc.ab : 0 };
}
function projectBatting(line: BattingLine, scale: number): BattingLine {
  return {
    gp: Math.round(line.gp * scale),
    ab: Math.round(line.ab * scale),
    r: Math.round(line.r * scale),
    h: Math.round(line.h * scale),
    doubles: Math.round(line.doubles * scale),
    triples: Math.round(line.triples * scale),
    hr: Math.round(line.hr * scale),
    rbi: Math.round(line.rbi * scale),
    bb: Math.round(line.bb * scale),
    so: Math.round(line.so * scale),
    sb: Math.round(line.sb * scale),
    avg: line.avg,
  };
}

function newPitchAcc(season_id: string | null) {
  return {
    season_id,
    latestDate: "",
    app: 0,
    ip_outs: 0,
    w: 0,
    l: 0,
    sv: 0,
    h: 0,
    r: 0,
    er: 0,
    bb: 0,
    so: 0,
  };
}
function addPitching(
  acc: ReturnType<typeof newPitchAcc>,
  line: BoxLine,
  date: string,
) {
  acc.app += 1;
  acc.ip_outs += line.ip_outs;
  if (line.decision === "W") acc.w += 1;
  if (line.decision === "L") acc.l += 1;
  if (line.decision === "S") acc.sv += 1;
  acc.h += line.h;
  acc.r += line.r;
  acc.er += line.er;
  acc.bb += line.bb;
  acc.so += line.so;
  if (date > acc.latestDate) acc.latestDate = date;
}
function era(er: number, outs: number): number {
  if (outs === 0) return 0;
  return (er * 27) / outs;
}
function whip(h: number, bb: number, outs: number): number {
  if (outs === 0) return 0;
  return ((h + bb) * 3) / outs;
}
function labelForCurrentBatting(name: string): string {
  const m = /\b(20\d{2})\b/.exec(name);
  return m ? m[1]! : name;
}
