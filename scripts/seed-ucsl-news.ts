// Seed starter News posts for UCSL so /content/news (and the homepage news
// strip) isn't empty on launch. Generic, safe placeholders — the commissioner
// edits or deletes them from the admin News editor. Idempotent: fixed doc ids.
//
// Run against the emulator:
//   FIRESTORE_EMULATOR_HOST=localhost:8080 GCLOUD_PROJECT=league-platform-5f3c8 npx tsx scripts/seed-ucsl-news.ts
import { getAdminDb } from "../lib/firebase-admin";

const GREEN = "#2e8b3d";
const GOLD = "#f3c218";

const POSTS = [
  {
    id: "welcome",
    title: "Welcome to the New UCSL Website",
    body:
      "<p>Welcome to the new home of the United Coed Softball League! You can now follow scores, schedules, and standings for every division, browse team pages, and read the full league rules — all in one place.</p>" +
      "<p>Have a team ready to play? Head to Team Registration to sign up. Questions? Email us at untiedcoedsports@gmail.com.</p>",
    pinned: true,
    event_date: null,
    color: GREEN,
    order: 2,
  },
  {
    id: "registration-open",
    title: "Registration Is Open",
    body:
      "<p>Team registration is open for the upcoming season of adult 21+ coed recreational softball, across our Gold, Silver, and Bronze divisions.</p>" +
      "<p>Register your team online, and remember that every player must sign the league Waiver &amp; Release of Liability before playing. New to the league or looking for a team? Reach out and we'll help you get in the game.</p>",
    pinned: false,
    event_date: null,
    color: GOLD,
    order: 1,
  },
];

async function main() {
  const db = getAdminDb();
  const base = Date.parse("2026-09-02T12:00:00Z");
  for (const p of POSTS) {
    const created = new Date(base - p.order * 60_000).toISOString();
    await db.doc(`leagues/ucsl/news/${p.id}`).set({
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

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[news] failed:", e);
    process.exit(1);
  });
