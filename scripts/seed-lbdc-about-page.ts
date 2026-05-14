// Seed a default About-LBDC page so the /sfbl-info route renders
// real LBDC content (instead of the SFBL fallback prose) until the
// commissioner edits it via admin → Pages.
//
// Writes /leagues/<slug>/page_content/sfbl-info with markdown +
// pre-baked HTML. The content mirrors what the original LBDC site
// has on its About page — Saturday + Boomers divisions, league
// history, commissioner contact, get-started CTAs.
//
// Usage:
//   npx tsx scripts/seed-lbdc-about-page.ts --league lbdc-staging

import * as fs from "node:fs";
import * as path from "node:path";
(function loadEnvLocal() {
  const p = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return;
  for (const raw of fs.readFileSync(p, "utf8").split("\n")) {
    const m = raw.trim().match(/^([A-Z0-9_]+)=(.+)/);
    if (m && !process.env[m[1]!])
      process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
})();

import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { markdownToHtml } from "@/lib/markdown";

let league: string | null = null;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--league") league = args[++i] ?? null;
}
if (!league) {
  console.error("Usage: --league <slug>");
  process.exit(2);
}

initializeApp({
  credential: cert(
    path.resolve(process.cwd(), process.env.FIREBASE_SERVICE_ACCOUNT_PATH!),
  ),
  projectId: process.env.FIREBASE_PROJECT_ID,
});
const db = getFirestore();

const LBDC_ABOUT_MD = `## The League

Long Beach Diamond Classic is Southern California's premier
50+ baseball organization. We run two divisions:

- **Saturday Division (50+)** — competitive 9-inning baseball on
  Saturday mornings at St Pius X (Downey) and Clark Field (Long
  Beach). Seven teams play a Spring/Summer regular season plus
  Fall/Winter.
- **Boomers 60/70 Division** — relaxed 7-inning games on
  weekday mornings for players 60 and up. Open to crossover 50+
  players for a $10 per-game fee.

## Seasons

We play a Spring/Summer season (April → August) and a Fall/Winter
season. Each team plays 15+ regular-season games. We also send
teams to NABA national tournaments throughout the year — Vegas
World Series, Memorial Day, 4th of July, MLK, and the Great Park
tournament in Orange County.

## Membership & Cost

- **Seasonal Insurance (50's):** $50 per season
- **Annual Insurance (Boomers):** $25 per year
- **Game fee — Boomers:** $20 per game
- **Crossover game fee (50's playing Boomers):** $10 per game
- **Regional Tournament entry:** $125 per player
- **National Tournament entry:** $175 per player

See the [Pay Online](/pay-online) page for payment methods.

## Get Involved

- [Player Sign Up](/player-registration) — join a team or get put
  on the pool list
- [Tournaments](/tournaments) — upcoming regional + national
  events
- [Availability](/availability) — RSVP to upcoming games
- [Fields](/fields) — directions to all the parks we play at
`;

(async () => {
  const html = markdownToHtml(LBDC_ABOUT_MD);
  const ref = db.doc(`leagues/${league}/page_content/sfbl-info`);
  // Don't clobber a hand-edited admin doc — only write if blank.
  const existing = await ref.get();
  if (
    existing.exists &&
    (existing.data()?.markdown || existing.data()?.html)
  ) {
    console.log(
      `[seed-about] /leagues/${league}/page_content/sfbl-info already has content — skipping`,
    );
    process.exit(0);
  }
  await ref.set(
    {
      title: "About",
      markdown: LBDC_ABOUT_MD,
      html,
      updated_at: new Date().toISOString(),
      updated_by_uid: "lbdc-about-seed",
    },
    { merge: true },
  );
  console.log(`[seed-about] wrote /leagues/${league}/page_content/sfbl-info`);
  process.exit(0);
})();
