// Drives the full /rules editor flow end-to-end against the running
// emulator. Creates admin user → mints ID token via custom-token
// exchange → POSTs to /api/page-content → confirms /rules renders
// the new content.

import { initializeApp, deleteApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const PROJECT_ID = "league-platform-5f3c8";
const AUTH_HOST = "localhost:9099";
const FIRESTORE_HOST = "localhost:8080";

process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST;
process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_HOST;

const app = initializeApp({ projectId: PROJECT_ID }, "verify-rules");
const auth = getAuth(app);

const SAMPLE_RULES = `# South Florida Baseball — Rules

## Rosters
- Minimum 13 players, maximum 25 players.
- Three regular season games required for postseason eligibility.
- No ex-pros (AAA within 2 years, MLB within 3 years).

## Equipment
The SFBL is a **WOOD BAT ONLY** league. Certain wood-composite bats may
be permitted with league approval.

## Game Rules
- All games are 9 innings.
- 10 run rule applies after 7 innings.
- 15 run rule applies after 6 innings.
- No new inning may start after 3 hours (regular season).

## Pitchers
A pitcher who has been removed may re-enter as a pitcher only after 3
outs have been recorded. Each pitcher may re-enter once per game.

## Postseason Tiebreakers
1. Head-to-head competition
2. Net runs in head-to-head games
3. Net runs in all regular-season games
4. Coin flip
`;

async function run() {
  // Clean up any prior run.
  try {
    const existing = await auth.getUserByEmail("rules-test@verify.local");
    await auth.deleteUser(existing.uid);
  } catch {}

  // 1. Create admin user.
  const user = await auth.createUser({ email: "rules-test@verify.local" });
  await auth.setCustomUserClaims(user.uid, { leagues: { sfbl: "admin" } });
  console.log(`[1] Created admin user uid=${user.uid}`);

  // 2. Mint custom token, exchange for ID token via Auth Emulator REST.
  const customToken = await auth.createCustomToken(user.uid);
  const exchange = await fetch(
    `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  );
  if (!exchange.ok) throw new Error(`token exchange failed: ${exchange.status} ${await exchange.text()}`);
  const { idToken } = (await exchange.json()) as { idToken: string };
  console.log(`[2] Got ID token (len=${idToken.length})`);

  // 3. POST to /api/page-content as that admin.
  const save = await fetch("http://sfbl.localhost:3000/api/page-content", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Host: "sfbl.localhost:3000",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      leagueId: "sfbl",
      pageId: "rules",
      markdown: SAMPLE_RULES,
    }),
  });
  console.log(`[3] /api/page-content → ${save.status}`);
  if (!save.ok) {
    console.error("response:", await save.text());
    throw new Error("save failed");
  }
  const saveBody = await save.json();
  console.log(`    body: ${JSON.stringify(saveBody)}`);

  // 4. Re-fetch /rules and confirm it renders new content.
  const view = await fetch("http://sfbl.localhost:3000/rules", {
    headers: { Host: "sfbl.localhost:3000" },
  });
  const html = await view.text();
  const hits = [
    "WOOD BAT ONLY",
    "Postseason Tiebreakers",
    "Head-to-head competition",
    "Coin flip",
  ].filter((s) => html.includes(s));
  console.log(`[4] /rules contains ${hits.length}/4 expected strings: ${hits.join(", ")}`);

  // 5. Confirm scripted content NOT present (sanitization).
  const dangerous = '<script>alert(1)</script>';
  const saveBad = await fetch("http://sfbl.localhost:3000/api/page-content", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Host: "sfbl.localhost:3000",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      leagueId: "sfbl",
      pageId: "rules",
      markdown: SAMPLE_RULES + "\n\n" + dangerous,
    }),
  });
  console.log(`[5a] save with <script> → ${saveBad.status}`);
  const view2 = await fetch("http://sfbl.localhost:3000/rules", {
    headers: { Host: "sfbl.localhost:3000" },
  });
  const html2 = await view2.text();
  const scriptStripped = !html2.includes("<script>alert(1)</script>");
  console.log(`[5b] script tag stripped from rendered output: ${scriptStripped}`);

  // 6. Restore the clean version (without dangerous tag).
  await fetch("http://sfbl.localhost:3000/api/page-content", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Host: "sfbl.localhost:3000",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      leagueId: "sfbl",
      pageId: "rules",
      markdown: SAMPLE_RULES,
    }),
  });

  await deleteApp(app);
  console.log("\n✅ Done");
}

run().catch((err) => {
  console.error("VERIFY FAILED:", err);
  process.exit(1);
});
