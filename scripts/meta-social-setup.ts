// Store and refresh the Meta (Instagram + Facebook) credentials for a league.
//
// The token lives at leagues/{id}/_private/social. That path deliberately
// matches NO rule in firestore.rules, so it falls to the default deny and a
// browser can never read it — unlike leagues/{id} itself, which is world
// readable. Only the Admin SDK, i.e. our server, can see it.
//
// ─── SETUP (once) ──────────────────────────────────────────────────────────
//
// 1. developers.facebook.com → Create App → type "Business".
//    LEAVE IT IN DEVELOPMENT MODE. App Review is only needed to read OTHER
//    people's accounts; a development-mode app can read accounts that have a
//    role on it, and Island only ever reads its own.
//
// 2. Add the "Instagram" and "Facebook Login" products.
//
// 3. App Roles → add Mike as an Administrator or Tester, and have him accept.
//    He must already be an admin of the Island Fastpitch Facebook PAGE.
//
// 4. Graph API Explorer → select the app → Generate Access Token, granting:
//       pages_show_list, pages_read_engagement, instagram_basic
//    Mike does this step, signed in as himself.
//
// 5. Exchange it for a long-lived one and read the ids, then store:
//
//    SA_PATH=… TENANT=island \
//      APP_ID=… APP_SECRET=… SHORT_TOKEN=… \
//      npx tsx scripts/meta-social-setup.ts
//
// ─── REFRESH (every ~50 days) ──────────────────────────────────────────────
//
//    SA_PATH=… TENANT=island REFRESH=1 \
//      APP_ID=… APP_SECRET=… npx tsx scripts/meta-social-setup.ts
//
// A long-lived token lasts 60 days. If the refresh stops running the feed
// goes quiet — that is the one real cost of not paying a widget provider, so
// the script prints the expiry date loudly and it is worth a calendar
// reminder until this is automated.

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync, existsSync } from "node:fs";

const GRAPH = "https://graph.facebook.com/v21.0";
const { SA_PATH, TENANT, APP_ID, APP_SECRET, SHORT_TOKEN } = process.env;
const REFRESH = process.env.REFRESH === "1";

if (!SA_PATH || !existsSync(SA_PATH)) { console.error("SA_PATH required"); process.exit(1); }
if (!TENANT) { console.error("TENANT required"); process.exit(1); }
if (!APP_ID || !APP_SECRET) { console.error("APP_ID and APP_SECRET required"); process.exit(1); }
if (!REFRESH && !SHORT_TOKEN) { console.error("SHORT_TOKEN required (or REFRESH=1)"); process.exit(1); }

const sa = JSON.parse(readFileSync(SA_PATH, "utf8")) as { project_id: string };
initializeApp({ credential: cert(SA_PATH), projectId: sa.project_id });
const db = getFirestore();
const ref = db.doc(`leagues/${TENANT}/_private/social`);

async function get<T>(path: string, params: Record<string, string>): Promise<T> {
  const res = await fetch(`${GRAPH}/${path}?${new URLSearchParams(params)}`);
  const body = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${body.slice(0, 300)}`);
  return JSON.parse(body) as T;
}

(async () => {
  const existing = ((await ref.get()).data() ?? {}) as Record<string, string>;
  const seed = REFRESH ? existing.fb_page_token || existing.ig_token : SHORT_TOKEN!;
  if (!seed) { console.error("nothing to refresh — run setup first"); process.exit(1); }

  // Short-lived → long-lived (60 days). Refreshing feeds the current
  // long-lived token back in, which Meta accepts and re-issues.
  const ll = await get<{ access_token: string; expires_in?: number }>("oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: APP_ID!,
    client_secret: APP_SECRET!,
    fb_exchange_token: seed,
  });
  const userToken = ll.access_token;
  const expires = new Date(Date.now() + (ll.expires_in ?? 5_184_000) * 1000);

  // The PAGE token is what reads page posts, and page tokens derived from a
  // long-lived user token do not expire while the user token is valid.
  const pages = await get<{ data?: { id: string; name: string; access_token: string }[] }>(
    "me/accounts",
    { access_token: userToken, fields: "id,name,access_token" },
  );
  const page = pages.data?.[0];
  if (!page) { console.error("no Facebook page on this account — is Mike an admin of the PAGE?"); process.exit(1); }

  // The Instagram business account hangs off the page.
  const linked = await get<{ instagram_business_account?: { id: string } }>(page.id, {
    fields: "instagram_business_account",
    access_token: page.access_token,
  });

  const next = {
    fb_page_id: page.id,
    fb_page_token: page.access_token,
    ig_user_id: linked.instagram_business_account?.id ?? "",
    ig_token: page.access_token, // IG media is read with the page token
    token_expires_at: expires.toISOString(),
    updated_at: new Date().toISOString(),
  };
  await ref.set(next, { merge: true });

  console.log(`page      : ${page.name} (${page.id})`);
  console.log(`instagram : ${next.ig_user_id || "NOT LINKED — connect it in Instagram settings"}`);
  console.log(`expires   : ${expires.toDateString()}`);
  console.log(`\nstored at leagues/${TENANT}/_private/social (not readable by browsers)`);
  if (!next.ig_user_id) {
    console.log("\nInstagram is not linked to that Facebook page. In the Instagram app:");
    console.log("  Settings → Account type and tools → confirm Business, then link the page.");
  }
  process.exit(0);
})().catch((e) => { console.error(e.message ?? e); process.exit(1); });
