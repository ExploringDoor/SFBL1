// SFBL's historical Player of the Week archive (Spring 2019 / Fall
// 2018 / Spring 2018) — 31 entries supplied by Adam 2026-05-18.
//
// Baked in as a built-in fallback, exactly like the SFBL field
// directory: it renders on deploy with NO script to run. The public
// /player-of-the-week page merges this with any Firestore entries
// the admin adds going forward — a Firestore entry with the same
// `id` overrides its baked counterpart, so the commissioner can
// still correct a historical entry from the admin tab if needed.
//
// Photos live at /sfbl/pow/<file> (committed under public/sfbl/pow).
// `id` is the lowercased photo basename — stable, and the same id
// the admin API would mint, so overrides line up.

export interface SfblPotwHistoryEntry {
  id: string;
  player_name: string;
  team_name: string;
  season: string;
  week: number;
  blurb: string;
  photo_url: string;
}

function entry(
  file: string,
  season: string,
  week: number,
  player_name: string,
  team_name: string,
  blurb: string,
): SfblPotwHistoryEntry {
  return {
    id: file.replace(/\.[a-z0-9]+$/i, "").toLowerCase(),
    player_name,
    team_name,
    season,
    week,
    blurb,
    photo_url: `/sfbl/pow/${file}`,
  };
}

export const SFBL_POTW_HISTORY: SfblPotwHistoryEntry[] = [
  // ── Spring 2019 ──────────────────────────────────────────────
  entry(
    "S19-POW-01-beach-bums-staff.png",
    "Spring 2019",
    1,
    "Beach Bums Pitching Staff",
    "South Florida Beach Bums",
    "Brian Steyer, Mason McLaren, Sal Grilli, and Angel Morales combined to throw a no-hitter against the Dade Cardinals on Opening Day.",
  ),
  entry(
    "S19-POW-02-danier-rodriguez.jpg",
    "Spring 2019",
    2,
    "Danier Rodriguez",
    "Miami Red Sox",
    "Went 4-for-4 with 5 RBI in the Red Sox opener — hitting a 3-run homer, RBI double, and RBI single. Had homered in each of his last five games.",
  ),
  entry(
    "S19-POW-03-justin-jordan.png",
    "Spring 2019",
    3,
    "Justin Jordan",
    "Delray Nationals",
    "Did it all in one game — hit a grand slam at the plate while striking out 8 on the mound and picking up the win. A complete baseball clinic.",
  ),
  entry(
    "S19-POW-04-phillip-castillo.png",
    "Spring 2019",
    4,
    "Phillip Castillo",
    "Broward Mariners",
    'Hit two monster home runs against the South Florida Cubs, earning the nickname "Cubs Killer" — one of the league\'s best power hitters.',
  ),
  entry(
    "S19-POW-05-eric-harper.png",
    "Spring 2019",
    5,
    "Eric Harper",
    "Coral Springs Royals",
    "Went a perfect 6-for-6 with two monster doubles and 4 RBI to lead the Royals to a 12-6 win over the Boca Mets.",
  ),
  entry(
    "S19-POW-06-everett-miller.png",
    "Spring 2019",
    6,
    "Everett Miller",
    "South Florida Beach Bums",
    "Made an emergency start despite a massive ankle bruise, pitched a complete game with 15 strikeouts, only 2 walks, and added an RBI base hit for good measure.",
  ),
  entry(
    "S19-POW-07-eduardo-llovero.png",
    "Spring 2019",
    7,
    "Eduardo Llovero",
    "Delray Nationals",
    "Turned in a Superman performance, going 4-5 with two doubles, a triple, and 4 RBI against the Weston Leones.",
  ),
  entry(
    "S19-POW-09-gus-castillo.png",
    "Spring 2019",
    9,
    "Gus Castillo",
    "Miami Amigos",
    "Just back from labrum surgery, put on a rare 5-tool performance — went 4-4 with 3 doubles, 3 stolen bases, and 2 diving plays at second base.",
  ),
  entry(
    "S19-POW-10-bryan-ocana-andy-perez.png",
    "Spring 2019",
    10,
    "Bryan Ocaña & Andy Perez",
    "Miami Amigos",
    "Threw a combined no-hitter against the feisty Kendall Metz on November 10, 2019 at Florida Memorial University Baseball Park — a historic feat.",
  ),
  entry(
    "S19-POW-11-tony-doc-blanco.png",
    "Spring 2019",
    11,
    'Tony "Doc" Blanco',
    "Miami Cardinals",
    "Pitched a complete game BIG TIME GEM to lead his team to a Masters Division Semi-Finals win over the defending champions Dade Nationals, 14-9.",
  ),
  entry(
    "S19-POW-12-rodney-riera.png",
    "Spring 2019",
    12,
    "Rodney Riera",
    "FLOMO Crusaders",
    "Threw a complete game in the championship game against the Miami Amigos, winning 6-1 while striking out an impressive 12 batters. A clutch performance when it counted most.",
  ),

  // ── Fall 2018 ────────────────────────────────────────────────
  entry(
    "F18-POW-01-adrian-roznowski.jpg",
    "Fall 2018",
    1,
    "Adrian Roznowski",
    "South Florida Rays",
    "Had a perfect Opening Day — went 4-for-4 with two monster doubles and 2 RBI to set the tone for the South Florida Rays.",
  ),
  entry(
    "F18-POW-02-damian-gonzalez.jpg",
    "Fall 2018",
    2,
    "Damian Gonzalez",
    "Broward White Sox",
    "Pitched 7 innings of unbelievable baseball, striking out 16 batters. At one point struck out the side three innings in a row. A human lawn mower.",
  ),
  entry(
    "F18-POW-03-chaz-lemoine.gif",
    "Fall 2018",
    3,
    "Chaz Lemoine",
    "South Florida Sting Rays",
    "In his 52nd season with the league, pitched a complete game to lead his team to a tough 3-2 win over the Miami Red Sox. One of the all-time winningest pitchers in league history.",
  ),
  entry(
    "F18-POW-04-josh-rivera.jpg",
    "Fall 2018",
    4,
    "Josh Rivera",
    "South Florida Cubs",
    "At 48 years old, hurled a perfect game through 6 innings before being lifted in a blowout 12-2 win over the Delray Braves.",
  ),
  entry(
    "F18-POW-05-bruce-michelson.jpg",
    "Fall 2018",
    5,
    "Bruce Michelson",
    "Boca Mets",
    "At age 64, delivered a clutch ninth-inning base hit and scored the game-winning run on a passed ball — a wild play at the plate covered in dust. The league's ageless wonder.",
  ),
  entry(
    "F18-POW-06-danny-jordan.jpg",
    "Fall 2018",
    6,
    "Danny Jordan",
    "Miami Amigos",
    "Had a perfect day going 4-for-4 with 2 doubles, a 2-run homer, and a grand slam — raking in 8 RBI in a single game.",
  ),
  entry(
    "F18-POW-07-andrew-smiley.jpg",
    "Fall 2018",
    7,
    "Andrew Smiley",
    "Kendall Metz",
    "Earned his second Player of the Week award — pitched a complete game three-hit shutout against the Miami Thunder while striking out 9 batters. Utter domination.",
  ),
  entry(
    "F18-POW-08-luis-capriles.jpg",
    "Fall 2018",
    8,
    "Luis Capriles",
    "Valma Senators",
    "Pitched a no-hitter against the Miami Cardinals. One word: NASTY. He loves his zeros.",
  ),
  entry(
    "F18-POW-09-rody-mederos.jpg",
    "Fall 2018",
    9,
    "Rody Mederos",
    "FLOMO Crusaders",
    "Put on a magic show, throwing a no-hitter against the Miami Red Sox. A former Baseball Beast Award recipient continuing his domination.",
  ),
  entry(
    "F18-POW-10-mike-clark.jpg",
    "Fall 2018",
    10,
    "Mike Clark",
    "Broward Mariners",
    "Went 2-for-2 with a 2-run homer and a grand slam, plus 2 walks — a one-man scoring machine with 6 RBI on the day.",
  ),
  entry(
    "F18-POW-11-joe-iacobucci.jpg",
    "Fall 2018",
    11,
    "Joe Iacobucci",
    "Boca Red Sox",
    "Put in a perfect day at the plate going 4-for-4 with two doubles, a home run, and 3 RBI. Just routine work for Joe.",
  ),
  entry(
    "F18-POW-12-charles-sano.jpg",
    "Fall 2018",
    12,
    "Charles Sano",
    "South Florida Beach Bums",
    "Pitched 11 innings for a complete game win AND went 3-for-4 at the plate, including the go-ahead RBI in the 9th to beat the FLOMO Crusaders 3-2.",
  ),
  entry(
    "F18-POW-13-tj-gammage.png",
    "Fall 2018",
    13,
    "TJ Gammage",
    "Delray Braves",
    "Hit THREE home runs in a single game, raking in 7 RBI off those three bombs to lead his club over the Boca Mets. A very rare feat.",
  ),

  // ── Spring 2018 ──────────────────────────────────────────────
  entry(
    "S18-POW-06-jorge-carpio.jpg",
    "Spring 2018",
    6,
    "Jorge Carpio",
    "Dade Red Sox",
    "Had a perfect day at the plate going 3-for-3 with 3 RBI, helping the Dade Red Sox make waves in the league.",
  ),
  entry(
    "S18-POW-07-josh-franco.jpg",
    "Spring 2018",
    7,
    "Josh Franco",
    "Broward Mariners",
    "Hit TWO home runs in a power performance, going 2-for-3 with 3 RBI on the two dingers. The Sultan of Swat riding the Mariners to the playoffs.",
  ),
  entry(
    "S18-POW-08-big-papi-delgado.jpg",
    "Spring 2018",
    8,
    'John "Big Papi" Delgado',
    "Miami Cardinals",
    "A repeat Player of the Week, going 4-for-4 with a double performance to power the Miami Cardinals. Don't mess with the big man.",
  ),
  entry(
    "S18-POW-09-makeel-rodgers.jpg",
    "Spring 2018",
    9,
    "Makeel Rodgers",
    "Aventura Dodgers",
    "Hit a walk-off line drive to propel his Dodgers team to a tough win over the Miami Baystars when the game was on the line.",
  ),
  entry(
    "S18-POW-10-daniel-jordan.jpg",
    "Spring 2018",
    10,
    "Daniel Jordan",
    "Miami Hurricanes",
    "Had a monster day collecting 4 RBI while smashing a two-run home run to help power the Hurricanes into the playoffs.",
  ),
  entry(
    "S18-POW-11-gustavo-castillo.jpg",
    "Spring 2018",
    11,
    "Gustavo Castillo",
    "Miami Hurricanes",
    "Went 3-for-4 with THREE DOUBLES and 3 RBI in a big game to lead his Hurricanes team into the playoffs.",
  ),
  entry(
    "S18-POW-12-lander-suarez.jpg",
    "Spring 2018",
    12,
    "Lander Suarez",
    "Weston Leones",
    "Hit a clutch walk-off solo home run in the bottom of the 9th to lead the Leones to a 7-6 win over the Broward Mariners in the Open Division Semifinals.",
  ),
];
