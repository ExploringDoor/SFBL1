// Adds the 5/17 + 5/31 schedule games Adam pasted in chat. Skips two
// BYE rows (same team listed twice) and one row that referenced a
// "Miami Marlins" team not in the SFBL roster (likely a typo).
//
// Idempotent — re-running just updates existing docs in place.

const path = require("path");
const { cert, initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const PROJECT = process.env.FIREBASE_PROJECT_ID || "sfbl-acf51";
const SA_PATH = path.resolve(
  process.cwd(),
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH || "secrets/sfbl-acf51-service-account.json",
);
initializeApp({ credential: cert(SA_PATH), projectId: PROJECT });
const db = getFirestore();

const NAME_TO_ID = {
  "Kooper City Royals": "kooper-city-royals",
  "Miami Cardinals": "miami-cardinals",
  "Miami Yankees": "miami-yankees",
  "Miami Brewers": "miami-brewers",
  "Sunrise Giants": "sunrise-giants",
  "Palm Beach Pirates": "palm-beach-pirates",
  "Aventura Braves": "aventura-braves",
  "Miami Amigos": "miami-amigos",
  "South Florida Dodgers": "sf-dodgers",
  "South Florida Rays": "sf-rays",
  "Miami Red Sox": "miami-red-sox",
  "Miami Orioles": "miami-orioles",
  "Miami Buccaneers": "miami-buccaneers",
  "South Florida Astros": "sf-astros",
  Matanzas: "matanzas",
  "Delray Devil Rays": "delray-devil-rays",
  "Southern Yankees": "southern-yankees",
  "Miami JC": "miami-jc",
  "Broward Senators": "broward-senators",
  "Margate Marlins": "margate-marlins",
  "West Palm Beach Cardinals": "wpb-cardinals",
  "Miami Charros": "miami-charros",
  "Dade Nationals": "dade-nationals",
  "Boca Mets": "boca-mets",
  "South Florida Angels": "sf-angels",
  "Aventura Dodgers": "aventura-dodgers",
};

const ROWS = [
  ["Miami Cardinals", "Miami Yankees", "35+", "5/17/2026", "9:30 AM", "Flamingo Park"],
  ["Miami Brewers", "Sunrise Giants", "28+", "5/17/2026", "9:30 AM", "Floyd Hull Stadium"],
  ["Palm Beach Pirates", "Aventura Braves", "28+", "5/17/2026", "9:30 AM", "Sabal Pines Park"],
  ["Miami Amigos", "South Florida Dodgers", "35+", "5/17/2026", "9:30 AM", "Sunset Park"],
  ["South Florida Rays", "Miami Red Sox", "18+", "5/17/2026", "10:00 AM", "Pompey Park"],
  ["Miami Orioles", "Miami Buccaneers", "18+", "5/17/2026", "10:00 AM", "West Perrine Park"],
  ["South Florida Astros", "Matanzas", "35+", "5/17/2026", "12:45 PM", "Flamingo Park"],
  ["Delray Devil Rays", "Southern Yankees", "35+", "5/17/2026", "12:45 PM", "Sabal Pines Park"],
  ["Miami JC", "Broward Senators", "28+", "5/17/2026", "12:45 PM", "Sunset Park"],
  ["Margate Marlins", "West Palm Beach Cardinals", "18+", "5/17/2026", "1:15 PM", "Pompey Park"],
  ["Miami Charros", "Dade Nationals", "35+", "5/17/2026", "1:15 PM", "West Perrine Park"],
  ["Boca Mets", "South Florida Angels", "35+", "5/17/2026", "1:30 PM", "Margate Sports Complex #3"],
  ["Broward Senators", "Palm Beach Pirates", "28+", "5/31/2026", "9:30 AM", "Coral Springs Sportsplex"],
  ["Margate Marlins", "Miami Buccaneers", "18+", "5/31/2026", "9:30 AM", "Floyd Hull Stadium"],
  ["Dade Nationals", "South Florida Angels", "35+", "5/31/2026", "9:30 AM", "Margate Sports Complex #3"],
  ["Southern Yankees", "South Florida Dodgers", "35+", "5/31/2026", "9:30 AM", "Sabal Pines Park"],
  ["South Florida Astros", "Miami Amigos", "35+", "5/31/2026", "9:30 AM", "Sunset Park"],
  ["West Palm Beach Cardinals", "South Florida Rays", "18+", "5/31/2026", "10:00 AM", "Pompey Park"],
  ["Miami Cardinals", "Matanzas", "35+", "5/31/2026", "10:00 AM", "West Perrine Park"],
  ["Aventura Braves", "Miami Brewers", "28+", "5/31/2026", "12:45 PM", "Coral Springs Sportsplex"],
  ["Miami Orioles", "Miami Red Sox", "18+", "5/31/2026", "12:45 PM", "Floyd Hull Stadium"],
  ["Delray Devil Rays", "Kooper City Royals", "35+", "5/31/2026", "12:45 PM", "Sabal Pines Park"],
  ["Aventura Dodgers", "Miami JC", "28+", "5/31/2026", "12:45 PM", "Sunset Park"],
  ["Miami Yankees", "Miami Charros", "35+", "5/31/2026", "1:15 PM", "West Perrine Park"],
];

function toIso(date, time) {
  const [m, d, y] = date.split("/").map(Number);
  let [t, ap] = time.split(" ");
  let [hh, mm] = t.split(":").map(Number);
  if (ap === "PM" && hh !== 12) hh += 12;
  if (ap === "AM" && hh === 12) hh = 0;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00`;
}

(async () => {
  let added = 0;
  for (const [aw, hm, div, date, time, field] of ROWS) {
    const awayId = NAME_TO_ID[aw];
    const homeId = NAME_TO_ID[hm];
    if (!awayId || !homeId) {
      console.log("[skip] unknown:", aw, hm);
      continue;
    }
    const id = `g-${date.replace(/\//g, "-")}-${aw.toLowerCase().replace(/\s+/g, "-")}-vs-${hm.toLowerCase().replace(/\s+/g, "-")}`;
    await db.doc(`leagues/sfbl/games/${id}`).set(
      {
        date: toIso(date, time),
        away_team_id: awayId,
        home_team_id: homeId,
        division: div,
        field,
        status: "scheduled",
        away_score: 0,
        home_score: 0,
        created_at: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    added++;
  }
  console.log(`[add] ${added} May games`);
  process.exit(0);
})();
