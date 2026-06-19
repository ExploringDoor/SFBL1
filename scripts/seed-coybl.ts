// COYBL fixture seed for local dev. Writes a COYBL tenant snapshot to a
// running emulator: league config + a small REAL sample of teams/games
// across two age groups so the Age Group -> Division hierarchy has data
// to render. COYBL runs STATS OFF (score-only -> standings), so no
// players or box scores are seeded.
//
// Usage: `FIRESTORE_EMULATOR_HOST=localhost:8080 GCLOUD_PROJECT=league-platform-5f3c8 tsx scripts/seed-coybl.ts`
// (with `npm run dev:emulators` already running).

import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error(
    "[seed-coybl] FIRESTORE_EMULATOR_HOST not set. Refusing to seed " +
      "without an explicit emulator target.",
  );
  process.exit(1);
}

const projectId =
  process.env.GCLOUD_PROJECT ??
  process.env.FIREBASE_PROJECT_ID ??
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??
  "league-platform-5f3c8";

initializeApp({ projectId });
const db = getFirestore();

const LEAGUE_ID = "coybl";

// Central Ohio Youth Baseball League — youth travel baseball, 7U-14U,
// each age group split into numbered division tiers. STATS OFF: standings
// come from final game scores (W/L), no player/box-score tracking.
const LEAGUE_CONFIG = {
  slug: LEAGUE_ID,
  name: "Central Ohio Youth Baseball League",
  abbrev: "COYBL",
  sport: "baseball",
  innings: 6,
  ruleset: "hardball",
  linescore_innings: 6,
  // Stats off — kept minimal until the no-stats flag is wired through.
  stat_columns: [],
  pitching: { tracked: false },
  rules_flags: { dropped_third_strike: false, balks: false, infield_fly: false },
  // Navy + COYBL red.
  theme: { primary: "#13284a", accent: "#c8102e", logo_url: null },
  billing: {
    status: "active",
    paid_through: "2027-season",
    last_payment: null,
    notes: "$5,000/yr annual — invoice COYBL-2026-001",
  },
  // Hide stats-oriented pages/columns; show the Five Tool tournaments link
  // and the pitch-count eligibility tracker.
  flags: {
    stats_enabled: false,
    show_tournaments: true,
    show_pitch_counts: true,
    ticker_by_age: true,
  },
  // Standings: straight W/L (PCT-based default — no points scheme).
};

// Small REAL sample (names pulled from COYBL's live 2026 standings),
// two age groups, two divisions each. `ageGroup` + `division` + ordering
// fields make the data ready for the Age Group -> Division hierarchy.
type SeedTeam = {
  id: string;
  name: string;
  abbrev: string;
  ageGroup: string;
  division: string;
  ageOrder: number;
  divOrder: number;
  color?: string;
};

const TEAMS: SeedTeam[] = [
  // 10U — Division 1
  { id: "c10_stix_eberhardt", name: "Olentangy Stix - Eberhardt", abbrev: "STIX", ageGroup: "10U", division: "Division 1", ageOrder: 10, divOrder: 1, color: "#1f3a5f" },
  { id: "c10_dgs_devaney",    name: "Dublin Green Sox - Devaney",  abbrev: "DGS",  ageGroup: "10U", division: "Division 1", ageOrder: 10, divOrder: 1, color: "#0a7d3c" },
  { id: "c10_ua_bears",       name: "Upper Arlington Bears",       abbrev: "UAB",  ageGroup: "10U", division: "Division 1", ageOrder: 10, divOrder: 1, color: "#000000" },
  { id: "c10_select_eagles",  name: "Ohio Select Eagles",          abbrev: "OSE",  ageGroup: "10U", division: "Division 1", ageOrder: 10, divOrder: 1, color: "#13284a" },
  // 10U — Division 2
  { id: "c10_panthers",       name: "Hilliard Panthers",           abbrev: "HP",   ageGroup: "10U", division: "Division 2", ageOrder: 10, divOrder: 2, color: "#3a1d6e" },
  { id: "c10_naturals_org",   name: "Naturals Orange",             abbrev: "NAT",  ageGroup: "10U", division: "Division 2", ageOrder: 10, divOrder: 2, color: "#e36c0a" },
  { id: "c10_radnor",         name: "Radnor Raptors",              abbrev: "RAD",  ageGroup: "10U", division: "Division 2", ageOrder: 10, divOrder: 2, color: "#0a6e6e" },
  { id: "c10_uc_tigers",      name: "UC Tigers - Eizensmits",      abbrev: "UCT",  ageGroup: "10U", division: "Division 2", ageOrder: 10, divOrder: 2, color: "#f7941e" },
  // 12U — Division 1
  { id: "c12_stix_ackerman",  name: "Olentangy Stix - Ackerman",   abbrev: "STIX", ageGroup: "12U", division: "Division 1", ageOrder: 12, divOrder: 1, color: "#1f3a5f" },
  { id: "c12_gahanna_blue",   name: "Gahanna Lions - Blue",        abbrev: "GAH",  ageGroup: "12U", division: "Division 1", ageOrder: 12, divOrder: 1, color: "#1d3f8a" },
  { id: "c12_gct_red",        name: "Grove City Titans Red - Ball", abbrev: "GCT", ageGroup: "12U", division: "Division 1", ageOrder: 12, divOrder: 1, color: "#9e1b32" },
  { id: "c12_ohio_sting",     name: "Ohio Sting",                  abbrev: "STG",  ageGroup: "12U", division: "Division 1", ageOrder: 12, divOrder: 1, color: "#111111" },
  // 12U — Division 3
  { id: "c12_naturals_town",  name: "Naturals - Townsend",         abbrev: "NAT",  ageGroup: "12U", division: "Division 3", ageOrder: 12, divOrder: 3, color: "#e36c0a" },
  { id: "c12_outlaws",        name: "Westerville Outlaws",         abbrev: "WO",   ageGroup: "12U", division: "Division 3", ageOrder: 12, divOrder: 3, color: "#1b1b1b" },
  { id: "c12_pcp_red",        name: "Plain City Pioneers - Red",   abbrev: "PCP",  ageGroup: "12U", division: "Division 3", ageOrder: 12, divOrder: 3, color: "#9e1b32" },
  { id: "c12_colts_white",    name: "Hilliard Colts White",        abbrev: "HC",   ageGroup: "12U", division: "Division 3", ageOrder: 12, divOrder: 3, color: "#2a2f6b" },
];

// A handful of final + scheduled games within each division so standings
// compute. Dates are illustrative (2027 season placeholder).
type SeedGame = {
  id: string;
  home: string;
  away: string;
  hs: number;
  as: number;
  status: "final" | "scheduled";
  date: string;
  field?: string;
};

const GAMES: SeedGame[] = [
  // 10U D1
  { id: "g1", home: "c10_stix_eberhardt", away: "c10_ua_bears",      hs: 8,  as: 3, status: "final", date: "2027-05-01T17:30:00-04:00", field: "Field 4" },
  { id: "g2", home: "c10_dgs_devaney",    away: "c10_select_eagles", hs: 6,  as: 5, status: "final", date: "2027-05-01T18:00:00-04:00", field: "Field 2" },
  { id: "g3", home: "c10_stix_eberhardt", away: "c10_dgs_devaney",   hs: 4,  as: 7, status: "final", date: "2027-05-08T17:30:00-04:00", field: "Field 4" },
  { id: "g4", home: "c10_ua_bears",       away: "c10_select_eagles", hs: 0,  as: 0, status: "scheduled", date: "2027-05-15T17:30:00-04:00", field: "Field 1" },
  // 10U D2
  { id: "g5", home: "c10_panthers",       away: "c10_radnor",        hs: 11, as: 1, status: "final", date: "2027-05-02T13:00:00-04:00", field: "Diamond 1" },
  { id: "g6", home: "c10_naturals_org",   away: "c10_uc_tigers",     hs: 9,  as: 4, status: "final", date: "2027-05-02T15:00:00-04:00", field: "Diamond 2" },
  { id: "g7", home: "c10_panthers",       away: "c10_naturals_org",  hs: 5,  as: 2, status: "final", date: "2027-05-09T13:00:00-04:00", field: "Diamond 1" },
  // 12U D1
  { id: "g8",  home: "c12_stix_ackerman", away: "c12_ohio_sting",    hs: 10, as: 3, status: "final", date: "2027-05-03T18:00:00-04:00", field: "Field 6" },
  { id: "g9",  home: "c12_gahanna_blue",  away: "c12_gct_red",       hs: 5,  as: 4, status: "final", date: "2027-05-03T18:00:00-04:00", field: "Field 7" },
  { id: "g10", home: "c12_stix_ackerman", away: "c12_gahanna_blue",  hs: 0,  as: 0, status: "scheduled", date: "2027-05-10T18:00:00-04:00", field: "Field 6" },
  // 12U D3
  { id: "g11", home: "c12_naturals_town", away: "c12_outlaws",       hs: 8,  as: 4, status: "final", date: "2027-05-04T18:00:00-04:00", field: "Field 3" },
  { id: "g12", home: "c12_pcp_red",       away: "c12_colts_white",   hs: 7,  as: 7, status: "final", date: "2027-05-04T18:00:00-04:00", field: "Field 5" },
];

// Sample pitch outings for one 10U team (uses the 9U-10U ruleset). Dates are
// near "today" so the eligibility view shows a realistic mix of eligible /
// resting. Coaches enter these per game in production.
const PITCH_OUTINGS = [
  { team_id: "c10_stix_eberhardt", player_name: "Mason Avery",  date: "2026-06-10", pitches: 22 },
  { team_id: "c10_stix_eberhardt", player_name: "Mason Avery",  date: "2026-06-17", pitches: 62 },
  { team_id: "c10_stix_eberhardt", player_name: "Eli Brooks",   date: "2026-06-08", pitches: 41 },
  { team_id: "c10_stix_eberhardt", player_name: "Eli Brooks",   date: "2026-06-15", pitches: 30 },
  { team_id: "c10_stix_eberhardt", player_name: "Noah Carter",  date: "2026-06-13", pitches: 70 },
  { team_id: "c10_stix_eberhardt", player_name: "Liam Dunn",    date: "2026-06-16", pitches: 45 },
  { team_id: "c10_stix_eberhardt", player_name: "Owen Ford",    date: "2026-06-14", pitches: 12 },
  // 12U team — uses the 11U-12U ruleset (daily max 85). Cole's 80 is legal
  // here but would exceed the 10U cap.
  { team_id: "c12_stix_ackerman",  player_name: "Cole Reyes",   date: "2026-06-16", pitches: 80 },
  { team_id: "c12_stix_ackerman",  player_name: "Jack Tobin",   date: "2026-06-15", pitches: 33 },
  { team_id: "c12_stix_ackerman",  player_name: "Drew Coleman", date: "2026-06-13", pitches: 55 },
];

async function run() {
  console.log(`[seed-coybl] writing to ${process.env.FIRESTORE_EMULATOR_HOST} (${projectId})`);

  // Wipe stale docs so renamed teams don't linger.
  for (const sub of ["teams", "games", "players", "box_scores", "pitch_outings"]) {
    const stale = await db.collection(`leagues/${LEAGUE_ID}/${sub}`).get();
    if (stale.empty) continue;
    const batch = db.batch();
    for (const d of stale.docs) batch.delete(d.ref);
    await batch.commit();
  }

  await db.doc(`leagues/${LEAGUE_ID}`).set(LEAGUE_CONFIG);

  for (const t of TEAMS) {
    await db.doc(`leagues/${LEAGUE_ID}/teams/${t.id}`).set({
      name: t.name,
      abbrev: t.abbrev,
      ageGroup: t.ageGroup,
      division: t.division,
      ageOrder: t.ageOrder,
      divOrder: t.divOrder,
      color: t.color ?? null,
      logo_url: null,
    });
  }

  for (const g of GAMES) {
    await db.doc(`leagues/${LEAGUE_ID}/games/${g.id}`).set({
      home_team_id: g.home,
      away_team_id: g.away,
      home_score: g.hs,
      away_score: g.as,
      status: g.status,
      date: g.date,
      field: g.field ?? null,
    });
  }

  for (const o of PITCH_OUTINGS) {
    await db.collection(`leagues/${LEAGUE_ID}/pitch_outings`).add({
      team_id: o.team_id,
      player_name: o.player_name,
      date: o.date,
      pitches: o.pitches,
    });
  }

  console.log(
    `[seed-coybl] done — ${TEAMS.length} teams across 10U/12U, ${GAMES.length} games (stats off, no players/box scores)`,
  );
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[seed-coybl] failed:", err);
    process.exit(1);
  });
