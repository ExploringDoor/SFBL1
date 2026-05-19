// One-time seed: SFBL's historical Player of the Week archive
// (Spring 2019 / Fall 2018 / Spring 2018) — 31 entries supplied by
// Adam 2026-05-18. Photos already committed to public/sfbl/pow/.
//
// Writes /leagues/<league>/player_of_week/<id> with a DETERMINISTIC
// id (the photo basename) so a re-run updates in place instead of
// duplicating, and preserves created_at on existing docs. Uses the
// Admin SDK directly (bypasses rules) — same pattern as the
// scripts/migrations/patch-lbdc-*.ts one-shots.
//
// Usage:
//   npx tsx scripts/seed-sfbl-player-of-week.ts --league sfbl
//   npx tsx scripts/seed-sfbl-player-of-week.ts --league sfbl --dry-run

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

let league = "sfbl";
let dryRun = false;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--league") league = args[++i] ?? "sfbl";
  else if (args[i] === "--dry-run") dryRun = true;
}

interface SeedEntry {
  file: string; // basename in public/sfbl/pow/ (also the doc id stem)
  season: string;
  week: number;
  player_name: string;
  team_name: string;
  blurb: string;
}

const ENTRIES: SeedEntry[] = [
  // ── Spring 2019 ──────────────────────────────────────────────
  {
    file: "S19-POW-01-beach-bums-staff.png",
    season: "Spring 2019",
    week: 1,
    player_name: "Beach Bums Pitching Staff",
    team_name: "South Florida Beach Bums",
    blurb:
      "Brian Steyer, Mason McLaren, Sal Grilli, and Angel Morales combined to throw a no-hitter against the Dade Cardinals on Opening Day.",
  },
  {
    file: "S19-POW-02-danier-rodriguez.jpg",
    season: "Spring 2019",
    week: 2,
    player_name: "Danier Rodriguez",
    team_name: "Miami Red Sox",
    blurb:
      "Went 4-for-4 with 5 RBI in the Red Sox opener — hitting a 3-run homer, RBI double, and RBI single. Had homered in each of his last five games.",
  },
  {
    file: "S19-POW-03-justin-jordan.png",
    season: "Spring 2019",
    week: 3,
    player_name: "Justin Jordan",
    team_name: "Delray Nationals",
    blurb:
      "Did it all in one game — hit a grand slam at the plate while striking out 8 on the mound and picking up the win. A complete baseball clinic.",
  },
  {
    file: "S19-POW-04-phillip-castillo.png",
    season: "Spring 2019",
    week: 4,
    player_name: "Phillip Castillo",
    team_name: "Broward Mariners",
    blurb:
      'Hit two monster home runs against the South Florida Cubs, earning the nickname "Cubs Killer" — one of the league\'s best power hitters.',
  },
  {
    file: "S19-POW-05-eric-harper.png",
    season: "Spring 2019",
    week: 5,
    player_name: "Eric Harper",
    team_name: "Coral Springs Royals",
    blurb:
      "Went a perfect 6-for-6 with two monster doubles and 4 RBI to lead the Royals to a 12-6 win over the Boca Mets.",
  },
  {
    file: "S19-POW-06-everett-miller.png",
    season: "Spring 2019",
    week: 6,
    player_name: "Everett Miller",
    team_name: "South Florida Beach Bums",
    blurb:
      "Made an emergency start despite a massive ankle bruise, pitched a complete game with 15 strikeouts, only 2 walks, and added an RBI base hit for good measure.",
  },
  {
    file: "S19-POW-07-eduardo-llovero.png",
    season: "Spring 2019",
    week: 7,
    player_name: "Eduardo Llovero",
    team_name: "Delray Nationals",
    blurb:
      "Turned in a Superman performance, going 4-5 with two doubles, a triple, and 4 RBI against the Weston Leones.",
  },
  {
    file: "S19-POW-09-gus-castillo.png",
    season: "Spring 2019",
    week: 9,
    player_name: "Gus Castillo",
    team_name: "Miami Amigos",
    blurb:
      "Just back from labrum surgery, put on a rare 5-tool performance — went 4-4 with 3 doubles, 3 stolen bases, and 2 diving plays at second base.",
  },
  {
    file: "S19-POW-10-bryan-ocana-andy-perez.png",
    season: "Spring 2019",
    week: 10,
    player_name: "Bryan Ocaña & Andy Perez",
    team_name: "Miami Amigos",
    blurb:
      "Threw a combined no-hitter against the feisty Kendall Metz on November 10, 2019 at Florida Memorial University Baseball Park — a historic feat.",
  },
  {
    file: "S19-POW-11-tony-doc-blanco.png",
    season: "Spring 2019",
    week: 11,
    player_name: 'Tony "Doc" Blanco',
    team_name: "Miami Cardinals",
    blurb:
      "Pitched a complete game BIG TIME GEM to lead his team to a Masters Division Semi-Finals win over the defending champions Dade Nationals, 14-9.",
  },
  {
    file: "S19-POW-12-rodney-riera.png",
    season: "Spring 2019",
    week: 12,
    player_name: "Rodney Riera",
    team_name: "FLOMO Crusaders",
    blurb:
      "Threw a complete game in the championship game against the Miami Amigos, winning 6-1 while striking out an impressive 12 batters. A clutch performance when it counted most.",
  },

  // ── Fall 2018 ────────────────────────────────────────────────
  {
    file: "F18-POW-01-adrian-roznowski.jpg",
    season: "Fall 2018",
    week: 1,
    player_name: "Adrian Roznowski",
    team_name: "South Florida Rays",
    blurb:
      "Had a perfect Opening Day — went 4-for-4 with two monster doubles and 2 RBI to set the tone for the South Florida Rays.",
  },
  {
    file: "F18-POW-02-damian-gonzalez.jpg",
    season: "Fall 2018",
    week: 2,
    player_name: "Damian Gonzalez",
    team_name: "Broward White Sox",
    blurb:
      "Pitched 7 innings of unbelievable baseball, striking out 16 batters. At one point struck out the side three innings in a row. A human lawn mower.",
  },
  {
    file: "F18-POW-03-chaz-lemoine.gif",
    season: "Fall 2018",
    week: 3,
    player_name: "Chaz Lemoine",
    team_name: "South Florida Sting Rays",
    blurb:
      "In his 52nd season with the league, pitched a complete game to lead his team to a tough 3-2 win over the Miami Red Sox. One of the all-time winningest pitchers in league history.",
  },
  {
    file: "F18-POW-04-josh-rivera.jpg",
    season: "Fall 2018",
    week: 4,
    player_name: "Josh Rivera",
    team_name: "South Florida Cubs",
    blurb:
      "At 48 years old, hurled a perfect game through 6 innings before being lifted in a blowout 12-2 win over the Delray Braves.",
  },
  {
    file: "F18-POW-05-bruce-michelson.jpg",
    season: "Fall 2018",
    week: 5,
    player_name: "Bruce Michelson",
    team_name: "Boca Mets",
    blurb:
      "At age 64, delivered a clutch ninth-inning base hit and scored the game-winning run on a passed ball — a wild play at the plate covered in dust. The league's ageless wonder.",
  },
  {
    file: "F18-POW-06-danny-jordan.jpg",
    season: "Fall 2018",
    week: 6,
    player_name: "Danny Jordan",
    team_name: "Miami Amigos",
    blurb:
      "Had a perfect day going 4-for-4 with 2 doubles, a 2-run homer, and a grand slam — raking in 8 RBI in a single game.",
  },
  {
    file: "F18-POW-07-andrew-smiley.jpg",
    season: "Fall 2018",
    week: 7,
    player_name: "Andrew Smiley",
    team_name: "Kendall Metz",
    blurb:
      "Earned his second Player of the Week award — pitched a complete game three-hit shutout against the Miami Thunder while striking out 9 batters. Utter domination.",
  },
  {
    file: "F18-POW-08-luis-capriles.jpg",
    season: "Fall 2018",
    week: 8,
    player_name: "Luis Capriles",
    team_name: "Valma Senators",
    blurb:
      "Pitched a no-hitter against the Miami Cardinals. One word: NASTY. He loves his zeros.",
  },
  {
    file: "F18-POW-09-rody-mederos.jpg",
    season: "Fall 2018",
    week: 9,
    player_name: "Rody Mederos",
    team_name: "FLOMO Crusaders",
    blurb:
      "Put on a magic show, throwing a no-hitter against the Miami Red Sox. A former Baseball Beast Award recipient continuing his domination.",
  },
  {
    file: "F18-POW-10-mike-clark.jpg",
    season: "Fall 2018",
    week: 10,
    player_name: "Mike Clark",
    team_name: "Broward Mariners",
    blurb:
      "Went 2-for-2 with a 2-run homer and a grand slam, plus 2 walks — a one-man scoring machine with 6 RBI on the day.",
  },
  {
    file: "F18-POW-11-joe-iacobucci.jpg",
    season: "Fall 2018",
    week: 11,
    player_name: "Joe Iacobucci",
    team_name: "Boca Red Sox",
    blurb:
      "Put in a perfect day at the plate going 4-for-4 with two doubles, a home run, and 3 RBI. Just routine work for Joe.",
  },
  {
    file: "F18-POW-12-charles-sano.jpg",
    season: "Fall 2018",
    week: 12,
    player_name: "Charles Sano",
    team_name: "South Florida Beach Bums",
    blurb:
      "Pitched 11 innings for a complete game win AND went 3-for-4 at the plate, including the go-ahead RBI in the 9th to beat the FLOMO Crusaders 3-2.",
  },
  {
    file: "F18-POW-13-tj-gammage.png",
    season: "Fall 2018",
    week: 13,
    player_name: "TJ Gammage",
    team_name: "Delray Braves",
    blurb:
      "Hit THREE home runs in a single game, raking in 7 RBI off those three bombs to lead his club over the Boca Mets. A very rare feat.",
  },

  // ── Spring 2018 ──────────────────────────────────────────────
  {
    file: "S18-POW-06-jorge-carpio.jpg",
    season: "Spring 2018",
    week: 6,
    player_name: "Jorge Carpio",
    team_name: "Dade Red Sox",
    blurb:
      "Had a perfect day at the plate going 3-for-3 with 3 RBI, helping the Dade Red Sox make waves in the league.",
  },
  {
    file: "S18-POW-07-josh-franco.jpg",
    season: "Spring 2018",
    week: 7,
    player_name: "Josh Franco",
    team_name: "Broward Mariners",
    blurb:
      "Hit TWO home runs in a power performance, going 2-for-3 with 3 RBI on the two dingers. The Sultan of Swat riding the Mariners to the playoffs.",
  },
  {
    file: "S18-POW-08-big-papi-delgado.jpg",
    season: "Spring 2018",
    week: 8,
    player_name: 'John "Big Papi" Delgado',
    team_name: "Miami Cardinals",
    blurb:
      "A repeat Player of the Week, going 4-for-4 with a double performance to power the Miami Cardinals. Don't mess with the big man.",
  },
  {
    file: "S18-POW-09-makeel-rodgers.jpg",
    season: "Spring 2018",
    week: 9,
    player_name: "Makeel Rodgers",
    team_name: "Aventura Dodgers",
    blurb:
      "Hit a walk-off line drive to propel his Dodgers team to a tough win over the Miami Baystars when the game was on the line.",
  },
  {
    file: "S18-POW-10-daniel-jordan.jpg",
    season: "Spring 2018",
    week: 10,
    player_name: "Daniel Jordan",
    team_name: "Miami Hurricanes",
    blurb:
      "Had a monster day collecting 4 RBI while smashing a two-run home run to help power the Hurricanes into the playoffs.",
  },
  {
    file: "S18-POW-11-gustavo-castillo.jpg",
    season: "Spring 2018",
    week: 11,
    player_name: "Gustavo Castillo",
    team_name: "Miami Hurricanes",
    blurb:
      "Went 3-for-4 with THREE DOUBLES and 3 RBI in a big game to lead his Hurricanes team into the playoffs.",
  },
  {
    file: "S18-POW-12-lander-suarez.jpg",
    season: "Spring 2018",
    week: 12,
    player_name: "Lander Suarez",
    team_name: "Weston Leones",
    blurb:
      "Hit a clutch walk-off solo home run in the bottom of the 9th to lead the Leones to a 7-6 win over the Broward Mariners in the Open Division Semifinals.",
  },
];

function docId(file: string): string {
  return file.replace(/\.[a-z0-9]+$/i, "").toLowerCase();
}

async function main() {
  console.log(
    `\n[seed-sfbl-potw] target /leagues/${league}/player_of_week  ` +
      `mode: ${dryRun ? "DRY" : "WRITE"}  entries: ${ENTRIES.length}\n`,
  );

  // Sanity: every referenced photo must exist in public/sfbl/pow/.
  const powDir = path.resolve(process.cwd(), "public/sfbl/pow");
  const missing = ENTRIES.filter(
    (e) => !fs.existsSync(path.join(powDir, e.file)),
  );
  if (missing.length) {
    console.error(
      `[seed-sfbl-potw] MISSING ${missing.length} photo(s) in public/sfbl/pow:`,
    );
    for (const m of missing) console.error(`  - ${m.file}`);
    process.exit(1);
  }

  if (dryRun) {
    for (const e of ENTRIES) {
      console.log(
        `  ${e.season} Wk${String(e.week).padStart(2, "0")}  ` +
          `${e.player_name} (${e.team_name})  /sfbl/pow/${e.file}`,
      );
    }
    console.log(`\n[seed-sfbl-potw] DRY — no writes.`);
    return;
  }

  const sa = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!sa) {
    console.error(
      "[seed-sfbl-potw] FIREBASE_SERVICE_ACCOUNT_PATH not set.",
    );
    process.exit(2);
  }
  initializeApp({
    credential: cert(path.resolve(process.cwd(), sa)),
    projectId: process.env.FIREBASE_PROJECT_ID,
  });
  const db = getFirestore();
  const now = new Date().toISOString();

  let wrote = 0;
  for (const e of ENTRIES) {
    const id = docId(e.file);
    const ref = db.doc(`leagues/${league}/player_of_week/${id}`);
    const existing = await ref.get();
    await ref.set(
      {
        id,
        player_name: e.player_name,
        team_name: e.team_name,
        season: e.season,
        week: e.week,
        week_label: "",
        award_date: null,
        stat_line: "",
        blurb: e.blurb,
        photo_url: `/sfbl/pow/${e.file}`,
        created_at: existing.exists
          ? (existing.data()?.created_at ?? now)
          : now,
        updated_at: now,
        updated_by_uid: "seed:sfbl-potw",
      },
      { merge: true },
    );
    wrote++;
    console.log(
      `  ${existing.exists ? "upd" : "new"}  ${id}  ${e.player_name}`,
    );
  }

  console.log(
    `\n[seed-sfbl-potw] Wrote ${wrote}/${ENTRIES.length} entries to ` +
      `/leagues/${league}/player_of_week.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed-sfbl-potw] Fatal:", err);
  process.exit(1);
});
