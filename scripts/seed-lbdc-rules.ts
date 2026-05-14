// Convert LBDC's structured rules (array of { icon, section, items[] }
// from /lbdc_rules/main.data) into the HTML shape leagueplatform's
// /rules page reads from /leagues/<slug>/page_content/rules.
//
// Usage:
//   npx tsx scripts/seed-lbdc-rules.ts --league lbdc-staging

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

const args = process.argv.slice(2);
let league: string | null = null;
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

// Read the dumped lbdc_rules row.
const raw = JSON.parse(
  fs.readFileSync("data/lbdc/raw/lbdc_rules.json", "utf8"),
);
const rulesRow = raw[0];
const sections: Array<{ icon?: string; section: string; items: string[] }> =
  rulesRow?.data ?? [];

if (sections.length === 0) {
  console.log("No rules sections found in lbdc_rules.json — nothing to write.");
  process.exit(0);
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const html = sections
  .map((sec) => {
    const heading = `${sec.icon ? sec.icon + " " : ""}${sec.section}`;
    const items = (sec.items ?? [])
      .map((it) => `  <li>${esc(it)}</li>`)
      .join("\n");
    return `<h2>${esc(heading)}</h2>\n<ul>\n${items}\n</ul>`;
  })
  .join("\n\n");

(async () => {
  await db.doc(`leagues/${league}/page_content/rules`).set(
    {
      html,
      markdown: "",
      updated_at: new Date().toISOString(),
      updated_by_uid: "lbdc-migration-script",
    },
    { merge: true },
  );
  console.log(
    `[seed-rules] wrote ${html.length} chars to /leagues/${league}/page_content/rules`,
  );
  console.log(`  ${sections.length} sections converted`);
  process.exit(0);
})();
