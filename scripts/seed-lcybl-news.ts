// Seed a few starter News & Events posts for LCYBL so the /content/news page
// (and the homepage strip) isn't empty on launch. These are generic, safe
// placeholders — the league edits or deletes them from the admin News editor.
// Idempotent: fixed doc ids, so re-running overwrites rather than duplicates.
//
// Run against the emulator:
//   FIRESTORE_EMULATOR_HOST=localhost:8080 GCLOUD_PROJECT=league-platform-5f3c8 npx tsx scripts/seed-lcybl-news.ts
// Or against live:
//   FIREBASE_PROJECT_ID=lcybl-live FIREBASE_SERVICE_ACCOUNT_PATH=... npx tsx scripts/seed-lcybl-news.ts
import { getAdminDb } from "../lib/firebase-admin";

const NAVY = "#14213d";
const GOLD = "#9a8c3f";

const POSTS = [
  {
    id: "welcome",
    title: "Welcome to the New LCYBL Website",
    body:
      "<p>We are excited to launch the new home of Lancaster County Youth Baseball. You can now follow scores, schedules, and standings for every division, browse team pages, and look back through our full playoff and champion history going all the way to 2009.</p>" +
      "<p>Every league document, form, and rule sheet lives on the League Documents page. Explore the site, and let a board member know if you spot anything that needs fixing.</p>",
    pinned: true,
    event_date: null,
    color: NAVY,
    order: 3,
  },
  {
    id: "fall-ball",
    title: "Fall Ball Is On the Way",
    body:
      "<p>Fall Ball returns for another season. No rosters are required and both bat standards are allowed. Watch this page and the League Documents section for the Fall Ball meeting details and the information sheet.</p>",
    pinned: false,
    event_date: null,
    color: NAVY,
    order: 2,
  },
  {
    id: "2026-champions",
    title: "Congratulations to Our 2026 Champions",
    body:
      "<p>The 2026 season is in the books, a record year with 185 teams across the county. Congratulations to every section champion and runner up. Visit the History page to relive the brackets, final scores, and championship team photos.</p>",
    pinned: false,
    event_date: null,
    color: GOLD,
    order: 1,
  },
];

async function main() {
  const db = getAdminDb();
  // Spread created_at a few minutes apart (descending by `order`) so the sort
  // is stable without relying on wall-clock precision.
  const base = Date.parse("2026-08-08T12:00:00Z");
  for (const p of POSTS) {
    const created = new Date(base - p.order * 60_000).toISOString();
    await db.doc(`leagues/lcybl/news/${p.id}`).set({
      id: p.id,
      title: p.title,
      body: p.body,
      pinned: p.pinned,
      event_date: p.event_date,
      color: p.color,
      created_at: created,
      updated_at: created,
    });
    console.log(`[news] wrote ${p.id}${p.pinned ? " (pinned)" : ""}`);
  }
  console.log(`[news] done — ${POSTS.length} posts`);
}

main().then(() => process.exit(0));
