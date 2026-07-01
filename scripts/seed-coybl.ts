// COYBL fixture seed for local dev. Writes a COYBL tenant snapshot to a
// running emulator: league config + a small REAL sample of teams/games
// across two age groups so the Age Group -> Division hierarchy has data
// to render. COYBL runs STATS OFF (score-only -> standings), so no
// players or box scores are seeded.
//
// Usage: `FIRESTORE_EMULATOR_HOST=localhost:8080 GCLOUD_PROJECT=league-platform-5f3c8 tsx scripts/seed-coybl.ts`
// (with `npm run dev:emulators` already running).

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";

// Safety: default to refusing any non-emulator target so nobody seeds prod by
// accident. A DELIBERATE prod seed must opt in with SEED_ALLOW_PROD=1 AND a
// service-account path — that combination can only be set on purpose.
if (
  !process.env.FIRESTORE_EMULATOR_HOST &&
  !(process.env.SEED_ALLOW_PROD === "1" && process.env.FIREBASE_SERVICE_ACCOUNT_PATH)
) {
  console.error(
    "[seed-coybl] FIRESTORE_EMULATOR_HOST not set. Refusing to seed " +
      "without an explicit emulator target. (For a deliberate prod seed, set " +
      "SEED_ALLOW_PROD=1 + FIREBASE_SERVICE_ACCOUNT_PATH.)",
  );
  process.exit(1);
}

const projectId =
  process.env.GCLOUD_PROJECT ??
  process.env.FIREBASE_PROJECT_ID ??
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??
  "league-platform-5f3c8";

// Emulator needs no credential; a prod seed authenticates with the
// service-account key at FIREBASE_SERVICE_ACCOUNT_PATH.
const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
if (saPath && !process.env.FIRESTORE_EMULATOR_HOST) {
  const sa = JSON.parse(readFileSync(saPath, "utf8"));
  initializeApp({ credential: cert(sa), projectId: sa.project_id });
} else {
  initializeApp({ projectId });
}
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
  // Navy + COYBL red. `secondary` drives the hero "2026" emphasis (defaults to
  // a light blue when unset) — set it red so the homepage reads navy + red.
  theme: { primary: "#13284a", accent: "#c8102e", secondary: "#c8102e", logo_url: null },
  // No home-page "Welcome" intro — dropped per Adam (2026-06-30); the banner
  // images already carry the league identity, so `about` is left unset and the
  // homepage Welcome block renders nothing.
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
    show_power_rankings: true,
    registration_open: true,
    // Hide the per-page text titles/heros — COYBL's header banner images
    // already show the league name + page, so the text was redundant.
    hide_page_titles: true,
  },
  // No admin password gate for now (preview) — the admin landing page opens
  // straight through when passwordless is true.
  admin: { passwordless: true },
  // Trim the platform nav to COYBL's pages. Matched case-insensitively against
  // the default nav labels (components/ui/nav-links.ts) — drops stats pages
  // (COYBL is score-only) + platform pages COYBL doesn't use.
  nav: {
    hide: [
      "stats",
      "team stats",
      "player of the week",
      "player registration",
      "team waiver",
      "news",
      "photos",
      "playoffs",
      "availability",
      "history",
      "umpire evaluation",
      "pay online",
      "sponsors",
      "store",
    ],
    // COYBL-specific primary nav items (the pitch-count eligibility tracker
    // + power rankings). Inserted before the Register/More dropdowns.
    add: [
      { label: "Pitch Counts", href: "/eligibility" },
      { label: "Power Rankings", href: "/power-rankings" },
      { label: "Rules", href: "/rules" },
      { label: "Alerts", href: "/alerts" },
    ],
  },
  // Standings: straight W/L (PCT-based default — no points scheme).
  // Tournaments run on Five Tool — list specific events that link out.
  // NOTE: event names are from COYBL's charity slate; the urls are PLACEHOLDERS
  // (generic Five Tool) until Adam supplies each event's real link.
  tournaments: {
    url: "https://play.fivetoolyouth.org",
    events: [
      { name: "Striking Out Pediatric Cancer", when: "Summer 2027 (dates TBD)", location: "Columbus, OH (venue TBD)", cost: "$TBD / team", ages: "8U-14U", note: "Benefits Nationwide Children's Hospital", url: "https://play.fivetoolyouth.org" },
      { name: "Super Heroes", when: "Summer 2027 (dates TBD)", location: "Columbus, OH (venue TBD)", cost: "$TBD / team", ages: "8U-14U", note: "Benefits Nationwide Children's Hospital", url: "https://play.fivetoolyouth.org" },
      { name: "Bust Out The Bats", when: "Summer 2027 (dates TBD)", location: "Columbus, OH (venue TBD)", cost: "$TBD / team", ages: "8U-14U", note: "Benefits Nationwide Children's Hospital", url: "https://play.fivetoolyouth.org" },
      { name: "Five Tool Ohio State Championships", when: "Summer 2027 (dates TBD)", location: "Columbus, OH (venue TBD)", cost: "$TBD / team", ages: "8U-14U", url: "https://play.fivetoolyouth.org" },
    ],
  },
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
  logo_url?: string;
  // Exact league record from coybl.org (see note below).
  w: number;
  l: number;
  t: number;
  record: string;
  overall: string;
};

type SeedGame = {
  id: string;
  date: string | null;
  away_team_id: string;
  home_team_id: string;
  away_score: number;
  home_score: number;
  division: string;
  ageGroup: string;
  status: string;
};

// Real COYBL 2026 data scraped from coybl.org (SportsEngine): 196 teams
// across 30 divisions (7U-14U) + 974 played games with final scores.
// See scripts/coybl-2026-data.json (built from the live standings +
// schedule pages).
//
// IMPORTANT — standings records are STORED, not recomputed. SportsEngine
// flags which games count toward each team's LEAGUE record, and the
// age-level schedule mixes in cross-division play, so recomputing W-L
// from the games does NOT reproduce the site's standings. We therefore
// store each team's exact league record (w/l) from the standings page,
// and the stats-off standings UI displays it directly. The games are
// still seeded for the scores/schedule pages and game recaps.
const REAL = JSON.parse(
  readFileSync("scripts/coybl-2026-data.json", "utf8"),
) as { teams: SeedTeam[]; games: SeedGame[] };
const TEAMS: SeedTeam[] = REAL.teams;
const GAMES: SeedGame[] = REAL.games;

// Sample pitch outings below reference the old sample team ids; remap
// them onto real teams so the eligibility demo still has data.
const DEMO_PITCH_10U =
  TEAMS.find((t) => t.ageGroup === "10U")?.id ?? TEAMS[0]?.id ?? "unknown";
const DEMO_PITCH_12U =
  TEAMS.find((t) => t.ageGroup === "12U")?.id ?? TEAMS[0]?.id ?? "unknown";

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

// COYBL rules (markdown), summarized from the 2026 rule books (7U-8U,
// 9U-12U, 13U). Rendered by /rules and editable by the commissioner.
const RULES_MD = `# COYBL League Rules

Rules for the Central Ohio Youth Baseball League. COYBL follows **OHSAA / National Federation (NFHS)** high school rules except where noted below, and rules vary by age group.

## Age Divisions & Eligibility

A player's age on **April 30** sets their division (a player who is 9 on April 30 plays 9U). A **grade exemption** applies (see below), and players may always "play up" in an older division.

| Division | Grade exemption |
|---|---|
| 8U | 2nd grade |
| 9U | 3rd grade |
| 10U | 4th grade |
| 11U | 5th grade |
| 12U | 6th grade |
| 13U | 7th grade |
| 14U | 8th grade |

## Pitch Counts (Pitch Smart)

A pitcher may **not return to the mound** once removed. Required rest is based on pitches thrown in a day. If a pitcher crosses a threshold mid-at-bat, they may finish that batter and the coach records the threshold count.

**Daily maximum:** 9U–10U = **75** · 11U–12U = **85** · 13U–14U = **95**.

| Pitches in a day | Rest required |
|---|---|
| 1–20 | None |
| 21–35 | 1 calendar day |
| 36–50 | 2 calendar days |
| 51–65 | 3 calendar days |
| 66 or more | 4 calendar days |

*(7U–8U is coach pitch — no pitching rules.)*

## Game Length

- **9U–12U:** 6 innings (5½ if the home team leads). 2-hour time limit.
- **13U–14U:** 7 innings (6½ if the home team leads). 2-hour-15-minute limit.
- Division games cannot end in a tie — play continues until there is a winner.

## Run / Mercy Rules

- 15 runs after 4 innings (3½ if the home team leads)
- 10 runs after 5 innings

## Rosters & Players

- Maximum **22** players per roster; rosters must be posted online before the first game.
- A player on two teams may only pitch for their primary team.
- Coaches must carry rosters and birth certificates at all times.

## Equipment

- **Bats:** USSSA, USA Baseball, or Nations-approved.
- **Footwear:** rubber spikes recommended; **metal spikes are prohibited**.

## Other Rules

- DH, EH, and roster batting are allowed (you cannot use DH and EH together).
- Courtesy runners allowed for the pitcher/catcher with 2 outs.
- **Slug bunting is prohibited at 13U and below** (player safety).
- A team may start with 8 players (auto-out for the 9th spot); 7 or fewer is a forfeit.

## Safety

- **Lightning:** suspend play when lightning or thunder is detected; wait at least 30 minutes after the last flash/thunder before resuming. No exceptions.
- **Heat:** monitor the heat index and use caution in dangerous conditions.
- **Ejections:** an ejected coach sits that game and the next; report ejections within 24 hours.

## Insurance & Registration

- **Option 1 ($495):** team insurance + Five Tool Youth registration.
- **Option 2 ($425):** team provides its own insurance (proof required) + Five Tool Youth registration.
- Optional add-on: **USSSA membership (+$35)**.

## League End Date

The regular season ends **June 30** (9U–12U).
`;

// Contact page — the real 2026 COYBL directors (from coybl.org's
// "Contact 2026 COYBL Directors" page).
const CONTACT_MD = `## League Office

Have a question about COYBL — registration, schedules, rules, or tournaments? Reach out to the league office or your age group's director below.

**League President:** Doug Hare — [doughare@coybl.org](mailto:doughare@coybl.org) — 614-778-1391

**Mailing address:** COYBL, 152 Glen Crossing Drive, Pataskala, OH 43062

## 2026 Age Directors

**7U & 8U — Doug Hare** — doughare@coybl.org — 614-778-1391

**9U — Nate Whisner** — natewhisner@gmail.com — 740-258-0550

**10U — Pete Tarnapoll** — pete.tarnapoll@gmail.com — 614-563-1905

**11U — Mark Dountz** — mdountz@gmail.com — 614-989-3874

**12U — Mark Dountz** — mdountz@gmail.com — 614-989-3874

**13U — Nate Whisner** — natewhisner@gmail.com — 740-258-0550

**14U — Pete Tarnapoll** — pete.tarnapoll@gmail.com — 614-563-1905

## Quick Links

- Register your team → [Team Registration](/team-registration)
- League rules → [Rules](/rules)
- Tournaments → [Tournaments](/tournaments)
`;

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

  // Teams (196) + games (974) are large now — write in batches of 400.
  {
    let batch = db.batch();
    let n = 0;
    const flush = async () => {
      if (n) {
        await batch.commit();
        batch = db.batch();
        n = 0;
      }
    };
    for (const t of TEAMS) {
      batch.set(db.doc(`leagues/${LEAGUE_ID}/teams/${t.id}`), {
        name: t.name,
        abbrev: t.abbrev,
        ageGroup: t.ageGroup,
        division: t.division,
        ageOrder: t.ageOrder,
        divOrder: t.divOrder,
        color: t.color ?? null,
        logo_url: t.logo_url ?? null,
        // Exact league record — the stats-off standings UI shows these
        // directly (see note on REAL above).
        w: t.w,
        l: t.l,
        t: t.t,
        record: t.record,
        overall: t.overall,
      });
      if (++n >= 400) await flush();
    }
    for (const g of GAMES) {
      batch.set(db.doc(`leagues/${LEAGUE_ID}/games/${g.id}`), {
        home_team_id: g.home_team_id,
        away_team_id: g.away_team_id,
        home_score: g.home_score,
        away_score: g.away_score,
        status: g.status,
        date: g.date,
        division: g.division ?? null,
        field: null,
      });
      if (++n >= 400) await flush();
    }
    await flush();
  }

  for (const o of PITCH_OUTINGS) {
    await db.collection(`leagues/${LEAGUE_ID}/pitch_outings`).add({
      team_id: o.team_id.startsWith("c12") ? DEMO_PITCH_12U : DEMO_PITCH_10U,
      player_name: o.player_name,
      date: o.date,
      pitches: o.pitches,
    });
  }

  await db.doc(`leagues/${LEAGUE_ID}/page_content/rules`).set({
    markdown: RULES_MD,
    updated_at: new Date().toISOString(),
    updated_by: "seed",
  });

  // Contact page — points to the real actions. No email/phone yet (add
  // COYBL's real contact when Doug provides it).
  await db.doc(`leagues/${LEAGUE_ID}/page_content/contact`).set({
    title: "Contact",
    markdown: CONTACT_MD,
    updated_at: new Date().toISOString(),
    updated_by: "seed",
  });

  console.log(
    `[seed-coybl] done — ${TEAMS.length} teams across 7U-14U, ${GAMES.length} games (stats off, no players/box scores)`,
  );
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[seed-coybl] failed:", err);
    process.exit(1);
  });
