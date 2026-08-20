// Build Windmill's 2026 season archive for the /history page — a pure file transform
// (the /history page is file-based, never touches Firestore). Reads the completed
// 2026 season from the static site and emits the three archive files the page reads.
//
//   data/windmill/historical-standings.json  -> Standings tab (the core archive)
//   data/windmill/season-games-2026.json      -> Scores tab (per-season played games)
//   data/windmill/history-meta.json           -> "Est. 1997" heritage line
//
// Champions are deliberately NOT filed: the source has no End-of-Year Tournament
// RESULTS (its tournament block is a 2027 template with no scores), so /history
// auto-shows regular-season DIVISION WINNERS — honest, nothing fabricated. When Ken
// supplies real tournament results, add data/windmill/champions.json + playoffs/2026.json.
//
// W-L-T is RECOMPUTED from scores (never the stored teamIndex w/l/t — the platform
// has been bitten by stale stored records). 8U Machine is excluded (no score kept).
//
// Run:  node scripts/build-windmill-history.js

const fs = require("fs");
const path = require("path");

const SRC = path.resolve(__dirname, "../../windmill-site/data/games-2026.json");
const OUT = path.resolve(__dirname, "../data/windmill");
const SEASON = "Summer 2026";
const EXCLUDE_DIV = "U8 Mach"; // blind-draw, no score kept

const MON = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
function toISODate(dateStr, ts) {
  const m = /^[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})$/.exec(String(dateStr || "").trim());
  if (m && MON[m[1]]) return `${m[3]}-${MON[m[1]]}-${m[2].padStart(2, "0")}`;
  return new Date(ts * 1000).toISOString().slice(0, 10);
}
function to24h(timeStr) {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(timeStr || "").trim());
  if (!m) return timeStr;
  let h = parseInt(m[1], 10);
  const ap = m[3].toUpperCase();
  if (ap === "PM" && h !== 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

// Division display order (ex 8U Machine), youngest to high school.
const DIV_ORDER = ["U8 Live", "U10", "U10 USA", "U12", "U14", "uHigh"];
const divRank = (d) => { const i = DIV_ORDER.indexOf(d); return i === -1 ? 99 : i; };

const data = JSON.parse(fs.readFileSync(SRC, "utf8"));
const games = data.games;

// Only scored games from scoring divisions count toward the archive.
const scored = games.filter(
  (g) => g.division !== EXCLUDE_DIV && g.home_score != null && g.away_score != null && g.played,
);

// --- recompute W-L-T from scores, grouped by division ---
const byDiv = {};
for (const g of scored) {
  const rec = (byDiv[g.division] = byDiv[g.division] || {});
  const H = (rec[g.home] = rec[g.home] || { w: 0, l: 0, t: 0 });
  const A = (rec[g.away] = rec[g.away] || { w: 0, l: 0, t: 0 });
  if (g.home_score > g.away_score) { H.w++; A.l++; }
  else if (g.home_score < g.away_score) { H.l++; A.w++; }
  else { H.t++; A.t++; }
}

const standings = Object.keys(byDiv)
  .sort((a, b) => divRank(a) - divRank(b) || a.localeCompare(b))
  .map((division) => {
    const rows = Object.entries(byDiv[division])
      .map(([team, r]) => {
        const g = r.w + r.l + r.t;
        return { team, w: r.w, l: r.l, t: r.t, g, pct: g ? Number(((r.w + r.t / 2) / g).toFixed(3)) : 0, p: r.w * 2 + r.t };
      })
      .sort((a, b) => b.pct - a.pct || b.w - a.w || a.l - b.l);
    return { season: SEASON, game_type: "season", division, standings: rows };
  });

// --- archived games for the Scores tab ---
const archGames = scored.map((g) => ({
  date: toISODate(g.date, g.ts),
  time: to24h(g.time),
  division: g.division,
  ageGroup: g.division,
  home: g.home,
  away: g.away,
  home_score: g.home_score,
  away_score: g.away_score,
  orientation_known: true,
  status: "final",
  field: g.location,
}));

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "historical-standings.json"), JSON.stringify(standings, null, 2) + "\n");
fs.writeFileSync(path.join(OUT, "season-games-2026.json"), JSON.stringify(archGames, null, 2) + "\n");
fs.writeFileSync(path.join(OUT, "history-meta.json"), JSON.stringify({ established: 1997 }, null, 2) + "\n");

const totalTeams = standings.reduce((n, b) => n + b.standings.length, 0);
console.log(`historical-standings.json: ${standings.length} divisions, ${totalTeams} teams`);
console.log(`  divisions: ${standings.map((b) => `${b.division}(${b.standings.length})`).join(", ")}`);
console.log(`season-games-2026.json: ${archGames.length} scored games`);
console.log(`history-meta.json: est. 1997 | champions left unfiled -> shows division winners`);
