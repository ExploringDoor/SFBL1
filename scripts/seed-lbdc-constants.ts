// scripts/seed-lbdc-constants.ts — fill in the LBDC config that
// lived as hardcoded JS constants in their App.jsx rather than as
// Supabase rows. These are SOURCE values transcribed verbatim
// from ~/Desktop/Long-Beach-Men-s-Baseball/src/App.jsx (line
// numbers cited inline) — do NOT edit here by hand without
// re-syncing.
//
// Writes:
//   /leagues/<slug>/teams/<slug>     — patches color, division,
//                                       logo_url
//   /leagues/<slug>/site_config/contact            — commissioner
//   /leagues/<slug>/site_config/sponsors           — sponsor list
//   /leagues/<slug>/site_config/fields             — field
//                                                    directions
//   /leagues/<slug>/site_config/payment_categories — fee schedule
//   /leagues/<slug>/site_config/divisions          — Saturday +
//                                                    Boomers config
//
// Run after the main seed-lbdc-to-firestore.ts so it patches the
// already-written team docs rather than fighting them.
//
// Usage:
//   npm run seed:lbdc:constants -- --league lbdc-staging
//   npm run seed:lbdc:constants -- --league lbdc-staging --dry-run

import * as fs from "node:fs";
import * as path from "node:path";

(function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const raw of fs.readFileSync(envPath, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    if (!process.env[m[1]!])
      process.env[m[1]!] = (m[2] ?? "")
        .trim()
        .replace(/^['"]|['"]$/g, "");
  }
})();

import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// ── extracted constants ─────────────────────────────────────────────
// Verbatim from App.jsx — sources cited inline. When LBDC updates
// any of these we re-transcribe + re-seed.

// App.jsx line 117
const TEAM_COLORS: Record<string, string> = {
  Tribe: "#002d6e",
  Dodgers: "#005a9c",
  Pirates: "#1d2d44",
  Titans: "#4a1d96",
  Brooklyn: "#b45309",
  Generals: "#374151",
  "Black Sox": "#111111",
  "Eddie Murray Mashers '56": "#1a5276",
  "Greg Maddux Magicians '66": "#6b21a8",
};

// App.jsx line 16. We re-host these under /lbdc/logos/<file> so the
// platform's public asset path stays tenant-scoped.
const TEAM_LOGOS: Record<string, string> = {
  Tribe: "/lbdc/logos/tribe.png",
  Dodgers: "/lbdc/logos/dodgers.png",
  Pirates: "/lbdc/logos/pirates.png",
  Titans: "/lbdc/logos/titans.png",
  Brooklyn: "/lbdc/logos/brooklyn.png",
  Generals: "/lbdc/logos/generals.png",
  "Black Sox": "/lbdc/logos/blacksox.png",
  "Eddie Murray Mashers '56": "/lbdc/logos/20.png",
  "Greg Maddux Magicians '66": "/lbdc/logos/21.png",
};

// App.jsx line 94 (DIV.SAT.teams, DIV.BOM.teams)
const SAT_TEAMS = [
  "Tribe",
  "Pirates",
  "Titans",
  "Brooklyn",
  "Generals",
  "Black Sox",
];
const BOM_TEAMS = [
  "Eddie Murray Mashers '56",
  "Greg Maddux Magicians '66",
];

// App.jsx line 3955
const CONTACT_INFO = {
  commissionerTitle: "League Commissioner",
  commissionerName: "Daniel Gutierrez",
  commissionerEmail: "dgutierrez22@yahoo.com",
  commissionerPhone: "(626) 722-2938",
  zelleNote: "Send to cell number above",
  venmoHandle: "@Titans-baseball",
  venmoQrUrl: "/lbdc/qr-code.png",
  designerName: "Adam — Mainline Web Design",
  designerEmail: "adam.mainlinewebdesign@gmail.com",
  designerWebsite: "https://mainline-webdesign.com/",
};

// App.jsx line 3944
const SPONSORS_DATA = [
  {
    name: "Daniel Gutierrez",
    role: "Diamond Classics Founder",
    description:
      "Thank you to Daniel Gutierrez for founding and building the Long Beach Diamond Classics into the league it is today. Your dedication to men's 50+ baseball in Southern California keeps the love of the game alive.",
    email: "dgutierrez22@yahoo.com",
    website: "",
    featured: true,
  },
  {
    name: "Adam — Mainline Design",
    role: "Website Design & Development",
    description:
      "A huge thank you to Adam for building this amazing website and bringing the Diamond Classics experience online. 🙌",
    email: "adam.mainlinewebdesign@gmail.com",
    website: "",
  },
];

// App.jsx line 3905
const FIELDS_INFO = [
  {
    name: "Clark Field",
    location: "Long Beach, CA",
    address: "4832 Clark Ave, Long Beach, CA 90808",
    mapsUrl:
      "https://maps.google.com/?q=4832+Clark+Ave,+Long+Beach,+CA+90808",
    appleMapsUrl:
      "https://maps.apple.com/?q=4832+Clark+Ave+Long+Beach+CA+90808",
    notes: [
      "Located at the St. Anthony High School Athletic Complex.",
      "Free parking available in the lot adjacent to the field.",
      "Home team uses the first base dugout.",
    ],
    color: "#002d6e",
  },
  {
    name: "Fromhold Field",
    location: "San Pedro, CA",
    address: "1600 W Paseo Del Mar, San Pedro, CA 90731",
    mapsUrl:
      "https://maps.google.com/?q=1600+W+Paseo+Del+Mar,+San+Pedro,+CA+90731",
    appleMapsUrl:
      "https://maps.apple.com/?q=1600+W+Paseo+Del+Mar+San+Pedro+CA+90731",
    notes: [
      "When exiting the 110 South at Gaffey, take 1st Street to Western, continue South to Paseo Del Mar, then right.",
      "Park on Paseo Del Mar next to the field — it's not necessary to pay for the parking lot.",
    ],
    color: "#1d4ed8",
  },
  {
    name: "St Pius X",
    location: "Downey, CA",
    address: "7851 Gardendale St, Downey, CA 90242",
    mapsUrl:
      "https://maps.google.com/?q=7851+Gardendale+St,+Downey,+CA+90242",
    appleMapsUrl:
      "https://maps.apple.com/?q=7851+Gardendale+St+Downey+CA+90242",
    notes: ["Enter and park off of Consuelo Street."],
    color: "#7c3aed",
  },
];

// App.jsx line 5548
const PAYMENT_CATEGORIES = [
  {
    id: "seasonal_ins",
    label: "Seasonal Insurance (50's)",
    amount: "$50",
    note: "Required for all 50's division players each season.",
  },
  {
    id: "annual_ins",
    label: "Annual Insurance (Boomers)",
    amount: "$25",
    note: "Required for all Boomers 60/70 division players annually.",
  },
  {
    id: "game_fee_bom",
    label: "Game Fee — Boomers",
    amount: "$20",
    note: "Per-game fee for Boomers 60/70 division players.",
  },
  {
    id: "game_fee_co",
    label: "Game Fee — Crossover",
    amount: "$10",
    note: "Per-game fee when playing a crossover game.",
  },
  {
    id: "tourn_regional",
    label: "Regional Tournament",
    amount: "$125",
    note: "Entry fee per player for regional tournament participation.",
  },
  {
    id: "tourn_national",
    label: "National Tournament",
    amount: "$175",
    note: "Entry fee per player for national tournament participation.",
  },
];

// Division metadata extracted from DIV (App.jsx line 94).
const DIVISIONS = [
  {
    id: "saturday",
    name: "Spring/Summer 2026",
    short_name: "Saturday",
    accent: "#002d6e",
    teams: SAT_TEAMS.map((name) => ({ name })),
  },
  {
    id: "boomers",
    name: "Boomers 60/70",
    short_name: "Boomers",
    accent: "#7c3aed",
    teams: BOM_TEAMS.map((name) => ({ name })),
  },
];

// Build a name → slug map for the team patcher. Mirrors the
// slugifier in transform-lbdc.ts.
function toSlug(s: string): string {
  return String(s ?? "")
    .replace(/\p{Z}/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

// ── CLI ─────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  let league: string | null = null;
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--league") league = args[++i] ?? null;
    else if (args[i] === "--dry-run") dryRun = true;
  }
  return { league, dryRun };
}
const { league, dryRun } = parseArgs();
if (!league) {
  console.error("[seed-constants] --league <slug> required.");
  process.exit(2);
}

// ── Firebase init ───────────────────────────────────────────────────
const useEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const projectId = useEmulator
  ? process.env.GCLOUD_PROJECT ||
    process.env.FIREBASE_PROJECT_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    "demo-lbdc"
  : process.env.FIREBASE_PROJECT_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error("[seed-constants] No project ID.");
  process.exit(2);
}
if (!dryRun) {
  if (useEmulator) {
    initializeApp({ projectId });
  } else {
    const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    if (!saPath) {
      console.error(
        "[seed-constants] FIREBASE_SERVICE_ACCOUNT_PATH not set.",
      );
      process.exit(2);
    }
    initializeApp({
      credential: cert(path.resolve(process.cwd(), saPath)),
      projectId,
    });
  }
}

// ── main ────────────────────────────────────────────────────────────
async function main() {
  const db = dryRun ? null : getFirestore();

  console.log(
    `\n[seed-constants] target /leagues/${league}/  mode: ${dryRun ? "DRY" : "WRITE"}\n`,
  );

  // 1. Patch team docs. Skip any team that's not actually in the
  // current Saturday or Boomers divisions — earlier versions of
  // this script created phantom rows for "Dodgers" etc. that had
  // logos defined in App.jsx but aren't on the active roster.
  const ACTIVE_TEAMS = new Set([...SAT_TEAMS, ...BOM_TEAMS]);
  let teamUpdates = 0;
  for (const teamName of Object.keys(TEAM_COLORS)) {
    if (!ACTIVE_TEAMS.has(teamName)) continue;
    const slug = toSlug(teamName);
    const patch: Record<string, unknown> = {
      color: TEAM_COLORS[teamName] ?? null,
      logo_url: TEAM_LOGOS[teamName] ?? null,
      division: SAT_TEAMS.includes(teamName)
        ? "saturday"
        : BOM_TEAMS.includes(teamName)
          ? "boomers"
          : null,
    };
    if (!dryRun && db) {
      await db
        .doc(`leagues/${league}/teams/${slug}`)
        .set(patch, { merge: true });
    }
    teamUpdates++;
    console.log(
      `  team ${slug.padEnd(36)} color=${patch.color}  div=${patch.division}  logo=${patch.logo_url}`,
    );
  }

  // 2. site_config singletons.
  const singletons: [string, unknown][] = [
    ["contact", CONTACT_INFO],
    ["sponsors", { data: SPONSORS_DATA }],
    ["fields", { data: FIELDS_INFO }],
    ["payment_categories", { data: PAYMENT_CATEGORIES }],
    ["divisions", { data: DIVISIONS }],
  ];
  let configWrites = 0;
  for (const [key, payload] of singletons) {
    if (!dryRun && db) {
      await db
        .doc(`leagues/${league}/site_config/${key}`)
        .set(payload as Record<string, unknown>, { merge: true });
    }
    configWrites++;
    console.log(`  site_config/${key} written`);
  }

  console.log(
    `\n[seed-constants] ${dryRun ? "DRY" : "Wrote"} ${teamUpdates} team patch(es), ${configWrites} singleton(s).`,
  );
}

main().catch((err) => {
  console.error("[seed-constants] Fatal:", err);
  process.exit(1);
});
