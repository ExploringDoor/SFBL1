// Adds the new "Miami Marlins" team (35+ National) to the SFBL
// Firestore. Adam confirmed this is a brand-new team for Spring 2026,
// not a typo of Margate Marlins. Also adds the 5/17 game vs Kooper
// City Royals that the original schedule import skipped because the
// team didn't exist yet.
//
// Idempotent — re-running just merges over existing docs.

const path = require("path");
const { cert, initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const SA_PATH = path.resolve(
  process.cwd(),
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    "secrets/sfbl-acf51-service-account.json",
);
initializeApp({ credential: cert(SA_PATH), projectId: "sfbl-acf51" });
const db = getFirestore();

(async () => {
  // ── Team doc ───────────────────────────────────────────────────
  // abbrev: MIA (Miami Marlins MLB convention; "MM" already taken
  // by Margate Marlins). Color: Miami Marlins' modern blue.
  // logo_url: blank for now until Adam generates one.
  const team = {
    id: "miami-marlins",
    name: "Miami Marlins",
    abbrev: "MIA",
    division: "35+ National",
    color: "#00A3E0",
    logo_url: "",
    active: true,
    created_at: FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
  };
  await db
    .doc(`leagues/sfbl/teams/${team.id}`)
    .set(team, { merge: true });
  console.log("[ok ] team leagues/sfbl/teams/miami-marlins written");

  // ── 5/17 game ──────────────────────────────────────────────────
  const gameId =
    "g-5-17-2026-kooper-city-royals-vs-miami-marlins";
  await db.doc(`leagues/sfbl/games/${gameId}`).set(
    {
      date: "2026-05-17T09:30:00",
      away_team_id: "kooper-city-royals",
      home_team_id: "miami-marlins",
      division: "35+",
      field: "Coral Springs Sportsplex",
      status: "scheduled",
      away_score: 0,
      home_score: 0,
      created_at: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  console.log(`[ok ] game leagues/sfbl/games/${gameId} written`);
  process.exit(0);
})();
