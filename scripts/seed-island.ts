// Island Fastpitch tenant seed.
//
// Long Island youth fastpitch softball (Mike, Smithtown NY). Signed 7/21/26.
// Modelled on seed-coybl.ts: STATS OFF (score-only -> standings), so no players
// and no box scores are written; team records are stored on the team docs and the
// standings UI reads them directly.
//
// Data comes from scripts/data/island-seed.json, which is generated from a full
// archive of their old Wix site by:
//     island-fastpitch-site/scrape/scrape_all.py        (archive every page)
//  -> island-fastpitch-site/scrape/build_seed_data.py   (clean + dedupe teams)
//  -> island-fastpitch-site/scrape/make_tenant_seed.py  (tenant doc shapes)
//
// AXES (decided 7/21/26): ageGroup = the AGE ("12U"), division = the LEAGUE
// ("Weeknight"). Age is the outer axis because app/page.tsx sorts age groups with
// parseInt, so a non-numeric value there silently sorts to zero.
//
// Usage:
//   emulator: FIRESTORE_EMULATOR_HOST=localhost:8080 GCLOUD_PROJECT=island-fastpitch tsx scripts/seed-island.ts
//   prod:     SEED_ALLOW_PROD=1 FIREBASE_SERVICE_ACCOUNT_PATH=<path> tsx scripts/seed-island.ts

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Refuse to touch anything but an emulator unless a prod seed is opted into
// explicitly. Same guard as seed-coybl.ts.
if (
  !process.env.FIRESTORE_EMULATOR_HOST &&
  !(process.env.SEED_ALLOW_PROD === "1" && process.env.FIREBASE_SERVICE_ACCOUNT_PATH)
) {
  console.error(
    "[seed-island] FIRESTORE_EMULATOR_HOST not set. Refusing to seed without an " +
      "explicit emulator target. For a deliberate prod seed set SEED_ALLOW_PROD=1 " +
      "and FIREBASE_SERVICE_ACCOUNT_PATH.",
  );
  process.exit(1);
}

const LEAGUE_ID = "island";

const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
if (saPath && !process.env.FIRESTORE_EMULATOR_HOST) {
  const sa = JSON.parse(readFileSync(saPath, "utf8"));
  initializeApp({ credential: cert(sa), projectId: sa.project_id });
} else {
  initializeApp({
    projectId:
      process.env.GCLOUD_PROJECT ??
      process.env.FIREBASE_PROJECT_ID ??
      "island-fastpitch",
  });
}
const db = getFirestore();

// ---------------------------------------------------------------------------
// Tenant config
// ---------------------------------------------------------------------------
const LEAGUE_CONFIG = {
  slug: LEAGUE_ID,
  name: "Island Fastpitch",
  abbrev: "IFP",

  sport: "softball" as const,
  ruleset: "fastpitch" as const,
  // Weeknight 12U and up play a single 7 inning game; 10U and 8U play 6.
  // 7 is the league default; the shorter divisions just end early.
  innings: 7,
  linescore_innings: 7,

  // STATS OFF. Island is score-only: coaches report a final, standings recompute.
  // No individual player stats are published anywhere (youth league).
  stat_columns: [] as string[],
  pitching: { tracked: false },
  rules_flags: {
    // Their 10U rule reads "a batter is out after their third strike",
    // i.e. no dropped third strike.
    dropped_third_strike: false,
    balks: false,
    infield_fly: false,
  },

  // Brand comes from their logo: black ground, chrome wordmark, electric blue
  // "FASTPITCH", optic-yellow softball. On a light SFBL-style layout the deep
  // navy carries the chrome and the electric blue reads as the accent.
  theme: {
    primary: "#0b2e4f",
    accent: "#35afea",
    secondary: "#c8dc2e",
    logo_url: null as string | null,
    // Link-preview card for texts / Facebook / X. Without this Island
    // inherited /og-default.png, which is SFBL's logo — Adam texted an Island
    // link and got a South Florida Baseball League card (2026-07-22).
    // Built from the homepage banner, centred on black at 1200x630.
    og_image_url: "/island/og.png",
  },

  billing: {
    status: "active" as const,
    paid_through: "2027-season",
    last_payment: null as string | null,
    // NO `notes` here on purpose. /leagues/{id} is world-readable (firestore.rules
    // makes it public so the Edge middleware can resolve the tenant pre-auth), so
    // anything on this doc is exposed to an unauthenticated Firestore REST read.
    // The commercial terms ("$6,000/yr billed $500/month, signed 2026-07-21") were
    // leaking here; they live in the project record instead, not on a public doc.
    // status + paid_through are non-sensitive and paid_through feeds the internal
    // platform-overview API. (Audit 2026-07-23.)
  },

  flags: {
    // Score-only league: hide every stats surface.
    stats_enabled: false,
    // They run ~30 tournaments a year at $525-$700 per team. Year one is
    // included free per the signed deal.
    show_tournaments: true,
    // No baseball pitch-count mandate in fastpitch.
    show_pitch_counts: false,
    registration_open: true,
    // Mike specifically asked for the LMLL-style scrolling ticker. Island is
    // the ONLY tenant with this flag; SFBL, LBDC and COYBL keep the manual
    // pan, so enabling it here cannot change their sites. The marquee pauses
    // on hover and focus, which is what keeps tiles clickable (the reason
    // DVSL removed the scroll in the first place).
    ticker_scroll: true,
    // The header banner already reads ISLAND FASTPITCH with the tagline, so the
    // "IFP 2026" text hero underneath was the league name twice in two styles.
    // NOT hide_page_titles, which would also strip the headings off /rules and
    // /tournaments — neither has a banner to replace them.
    hide_home_hero: true,
    // Opt-in motion layer: scroll reveals with stagger, count-ups, a slow
    // push-in on the header banner, hover lift on cards, win-percentage bars
    // behind standings rows, frosted nav once scrolled. Island only — SFBL,
    // COYBL and LBDC keep a completely static site until Adam says otherwise.
    // Honours prefers-reduced-motion. (Adam, 7/22/26: "more animations / cool
    // things ... someone will be like WOW check this out".)
    motion_fx: true,
    // Keep the top nav (Home / Scores / …) pinned when scrolling rather than
    // sliding the whole bar off. The ticker still tucks away; the nav rises to
    // take its place. (Adam, 7/22/26: "when you scroll down I want the tabs at
    // the top to stay.")
    sticky_nav: true,
    // Their header art is logo-on-black. PageBanner's default natural-size mode
    // left white gutters at the sides (it uses width:auto under a height cap,
    // so it can only fill the screen when the image ratio happens to exceed
    // viewportWidth/maxHeight). Full bleed crops to a strip instead.
    banner_full_bleed: true,
  },

  // Straight win/loss. NOT SFBL's points scheme (2/1/0) — Island's own rules
  // never mention points, and their standings page is headed "Placing / Team".
  // Tiebreaker is pct rather than the default rd, because a stats-off league
  // has no run data and every rd would be zero.
  standings: {
    scoring: "pct" as const,
    tiebreaker: "pct" as const,
  },

  // Matched case-insensitively against the default nav labels in
  // components/ui/nav-links.ts.
  nav: {
    hide: [
      "stats",
      "team stats",
      "player of the week",
      "availability",
      "photos",
      "news",
      "sponsors",
      "store",
      "pay online",
      "history",
      "player registration",
      // No bracket engine yet, so nothing to show until playoffs are built.
      "playoffs",
      // The "Info" child of the league dropdown points at /sfbl-info, which is
      // SFBL's own content. Island's equivalent info lives on the Contact page.
      "info",
      // Rules and Fields are the other two children of that same league
      // dropdown. Hiding all three empties it, and computeNavLinks drops a
      // parent whose children are all hidden — which is how the "IFP" dropdown
      // disappears. Both pages come back below: Fields as its own top-level
      // button, Rules inside "Information". (Adam, 7/22/26.)
      "rules",
      "fields",
    ],
    // Rules, Fields, Tournaments, Scores, Schedule, Standings and Teams are all
    // already in DEFAULT_LINKS, so they are NOT re-added here.
    //
    // "Coach Login" IS added, and deliberately under that label rather than the
    // default "Captain" link: components/ui/nav-links.ts:121 keeps a hardcoded
    // SFBL_ONLY_LABELS list (["SFBL","Player of the Week","Captain"]) and strips
    // those for every tenant whose short name is not "SFBL". Island would
    // therefore have NO visible route to the captain sign-in, which is the whole
    // product. Tenant-added links are inserted after that filter runs, so a
    // differently-labelled link survives — and "Coach Login" is better copy for
    // this league anyway, since their people are coaches and managers.
    add: [
      { label: "Fields", href: "/fields" },
      { label: "Events & Clinics", href: "/content/events-clinics" },
      // "Information" mirrors the tab his Wix site used. Adam's layout, 7/22/26.
      //
      // Coach Login lives here rather than at top level. Note it must NOT be
      // labelled "Captain": components/ui/nav-links.ts keeps a hardcoded
      // SFBL_ONLY_LABELS list (["SFBL","Player of the Week","Captain"]) that
      // strips those for any tenant whose short name is not SFBL. Tenant-added
      // links are inserted AFTER that filter runs, so this survives — but only
      // under a different label.
      {
        label: "Information",
        href: "#",
        children: [
          // /player-ads is the real board (post form + approved ads + relayed
          // contact), NOT the /content/* markdown page. That page still exists
          // and still holds the link to their Facebook group; the board renders
          // its body as a note so that community does not get orphaned.
          { label: "Player Ads", href: "/player-ads" },
          { label: "Rules", href: "/rules" },
          // Leagues page = fee schedule + season/game format + umpire fees + the
          // $200 Home Field discount. It was migrated but orphaned (no nav item),
          // so the pricing was unreachable before Fall registration. (Audit fix.)
          { label: "Leagues", href: "/content/leagues" },
          { label: "Coach Login", href: "/captain" },
        ],
      },
    ],
  },

  // No `about`: app/page.tsx only renders the homepage "Welcome" block when this
  // is set, and the header banner already carries the same sentence.

  // Pulled from the footer of every page of their old Wix site. TikTok needed a
  // new key on LeagueSocial + a glyph in SiteFooter; it renders only when set,
  // so no other tenant is affected. Their Facebook GROUP
  // (facebook.com/groups/1576420292574949) is their public "Player Ads" board
  // where coaches find players, so it is linked from page_content/player-ads
  // rather than sitting in this icon row.
  social: {
    facebook: "https://www.facebook.com/islandfastpitch",
    instagram: "https://www.instagram.com/islandfastpitch",
    youtube: "https://www.youtube.com/@Islandfastpitch",
    tiktok: "https://www.tiktok.com/@islandfastpitchli",
  },

  // Team-picker + per-team password (the SFBL model). "passwordless" here means
  // "no emailed magic link", NOT "no password": once the admin sets a team's
  // password in the Teams tab it is STRICT, and the team name stops working.
  // See app/api/public-captain-claim/route.ts.
  captain: { passwordless: true },
  // Shared admin password lives in the ISLAND_ADMIN_PASSWORD env var, never in
  // Firestore — firestore.rules makes /leagues/{id} world readable.
  admin: { passwordless: true },
};

type SeedTeam = {
  id: string; name: string; abbrev: string;
  ageGroup: string; division: string; ageOrder: number; divOrder: number;
  color: string | null; logo_url: string | null;
  w: number; l: number; t: number; record: string; overall: string;
};
type SeedGame = {
  id: string; home_team_id: string; away_team_id: string;
  home_score: number | null; away_score: number | null;
  status: string; date: string; time: string | null;
  division: string | null; field: string | null;
};

type SeedField = { name: string; address: string };

type SeedRules = {
  divisions: Array<{ key: string; label: string; sub?: string }>;
  sections: Array<Record<string, unknown>>;
  content_updated?: string;
};

const data = JSON.parse(
  readFileSync(join(__dirname, "data", "island-seed.json"), "utf8"),
) as {
  teams: SeedTeam[];
  games: SeedGame[];
  pages: Record<string, string>;
  fields: SeedField[];
  rules?: SeedRules;
};

// Partial seed. A full run WIPES teams/games/players/box_scores before
// rewriting them, which is the right behaviour for a rebuild but needless risk
// when all you are changing is one document on a live site. SEED_ONLY limits
// the run to a comma-separated list of parts.
//   SEED_ONLY=rules   -> writes site_config/rules only, touches nothing else
const ONLY = (process.env.SEED_ONLY ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const wants = (part: string) => ONLY.length === 0 || ONLY.includes(part);

async function run() {
  const target = process.env.FIRESTORE_EMULATOR_HOST ?? "PRODUCTION";
  console.log(`[seed-island] target: ${target}`);
  if (ONLY.length) console.log(`[seed-island] PARTIAL: ${ONLY.join(", ")}`);

  // Wipe stale docs so renamed teams don't linger between reseeds.
  for (const sub of wants("data") ? ["teams", "games", "players", "box_scores"] : []) {
    const stale = await db.collection(`leagues/${LEAGUE_ID}/${sub}`).get();
    if (stale.empty) continue;
    const batch = db.batch();
    stale.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    console.log(`[seed-island] cleared ${stale.size} stale ${sub}`);
  }

  if (wants("config")) {
    await db.doc(`leagues/${LEAGUE_ID}`).set(LEAGUE_CONFIG);
    console.log("[seed-island] wrote league config");
  }

  let batch = db.batch();
  let n = 0;
  const flush = async () => {
    if (n) { await batch.commit(); batch = db.batch(); n = 0; }
  };

  // SEED_ONLY=logos — merge just the logo_url onto existing team docs, no wipe.
  // Lets a logo drop go live without touching games or standings. A full data
  // reseed also carries these (logo_url is in island-seed.json), so this and a
  // full run agree. Teams with logo_url null (the 14U squads) are skipped so a
  // reseed never blanks a logo added another way.
  if (wants("logos") && !wants("data")) {
    let updated = 0;
    for (const t of data.teams) {
      if (!t.logo_url) continue;
      batch.set(
        db.doc(`leagues/${LEAGUE_ID}/teams/${t.id}`),
        { logo_url: t.logo_url },
        { merge: true },
      );
      updated++;
      if (++n >= 400) await flush();
    }
    await flush();
    console.log(`[seed-island] merged logo_url onto ${updated} teams`);
  }

  for (const t of wants("data") ? data.teams : []) {
    batch.set(db.doc(`leagues/${LEAGUE_ID}/teams/${t.id}`), {
      name: t.name,
      abbrev: t.abbrev,
      ageGroup: t.ageGroup,
      division: t.division,
      ageOrder: t.ageOrder,
      divOrder: t.divOrder,
      color: t.color ?? null,
      logo_url: t.logo_url ?? null,
      w: t.w, l: t.l, t: t.t,
      record: t.record,
      overall: t.overall,
    });
    if (++n >= 400) await flush();
  }

  for (const g of wants("data") ? data.games : []) {
    batch.set(db.doc(`leagues/${LEAGUE_ID}/games/${g.id}`), {
      home_team_id: g.home_team_id,
      away_team_id: g.away_team_id,
      home_score: g.home_score,
      away_score: g.away_score,
      status: g.status,
      date: g.date,
      time: g.time ?? null,
      division: g.division ?? null,
      field: g.field ?? null,
    });
    if (++n >= 400) await flush();
  }
  await flush();

  // /fields reads leagues/<id>/site_config/fields and, when that doc is missing,
  // falls back to a HARDCODED list of South Florida ballparks (app/fields/page.tsx:40).
  // Without this write Island's fields page would show Boca Raton and Miami.
  if (wants("fields") && data.fields?.length) {
    await db.doc(`leagues/${LEAGUE_ID}/site_config/fields`).set({
      data: data.fields,
      updated_at: new Date().toISOString(),
      updated_by: "seed",
    });
    console.log(`[seed-island] wrote ${data.fields.length} fields`);
  }

  // Structured rules drive the rich /rules view: division tabs, an at-a-glance
  // spec strip, and per-section cards. app/rules/page.tsx prefers this doc over
  // page_content/rules, and the top-level `divisions` array is what selects the
  // generic N-division renderer instead of LBDC's hardcoded two-tab path.
  //
  // page_content/rules is still seeded below, as the archival markdown copy and
  // the fallback if this doc is ever removed.
  if (wants("rules") && data.rules?.sections?.length) {
    await db.doc(`leagues/${LEAGUE_ID}/site_config/rules`).set({
      data: data.rules.sections,
      divisions: data.rules.divisions,
      content_updated: data.rules.content_updated ?? null,
      updated_at: new Date().toISOString(),
      updated_by: "seed",
    });
    console.log(
      `[seed-island] wrote structured rules — ${data.rules.sections.length} ` +
        `sections across ${data.rules.divisions.length} divisions`,
    );
  }

  for (const [key, markdown] of Object.entries(wants("pages") ? data.pages : {})) {
    await db.doc(`leagues/${LEAGUE_ID}/page_content/${key}`).set({
      title: key.charAt(0).toUpperCase() + key.slice(1),
      markdown,
      updated_at: new Date().toISOString(),
      updated_by: "seed",
    });
  }

  console.log(
    ONLY.length
      ? `[seed-island] done — partial run (${ONLY.join(", ")}), nothing else touched`
      : `[seed-island] done — ${data.teams.length} teams, ${data.games.length} games, ` +
          `${Object.keys(data.pages).length} content pages (stats off)`,
  );
}

run().then(() => process.exit(0)).catch((err) => {
  console.error("[seed-island] failed:", err);
  process.exit(1);
});
