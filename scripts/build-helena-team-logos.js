// Generates a cap-patch logo for every HSA team — one 512x512 PNG per team
// into public/helena/teams/<team-id>.png, plus a contact sheet for review.
//
// Built on the same pipeline as scripts/build-jfk-team-logos.js (roundel,
// seam stitching, game-icons.net silhouette or letter monogram). Read that
// file's design history before "improving" this one — the letters-and-numbers
// versions were rejected twice.
//
// ── THE HELENA DIFFERENCE: MOST TEAMS ARE BUSINESSES ─────────────────────
// JFK's teams are mascots (Swamp Monsters, Renegades). HSA's are mostly the
// SPONSOR: Coors Light, Lehrkinds Coca-Cola, Jeannie Lake Real Estate,
// Morrison-Maierle, Pappas Insulation, Windsor Bar, Pureview Health.
//
// Those get a MONOGRAM, never invented mascot art, because:
//   1. TRADEMARK. Coors Light and Coca-Cola are live marks belonging to
//      companies that are not our client. Drawing "a Coors Light logo" for a
//      site that is being sold is the same commercial-use problem the JFK
//      script already refuses for Google Images — worse, actually, because
//      here we would be inventing a mark that competes with a real one.
//   2. IT IS WRONG FOR THE SPONSOR. A business that paid for jerseys wants
//      its NAME legible on the schedule, not a cartoon someone assigned it.
//      If a sponsor sends real artwork, drop it in and set logo_url.
//
// Icons go only to teams with a genuine mascot/joke name — Motherlode,
// Hopper Jackalopes, Bunt Force Trauma, Jesters, Trolls, Base Invaders.
//
// ── SENSITIVE NAMES ──────────────────────────────────────────────────────
// "Helena Indian Alliance" (and its abbreviation Skoden) is a real Native
// organization in Helena. It gets the neutral monogram. Every figurative
// option is a caricature and it is not our call to make — same rule the JFK
// script applies to "Indians".
//
// ── ART LICENSE ──────────────────────────────────────────────────────────
// game-icons.net, CC BY 3.0 — commercial use permitted WITH attribution.
// ATTRIBUTION BELOW MUST APPEAR ON THE SITE before launch (footer or /fields),
// exactly as the JFK build requires.
//
// Run:
//   npm install sharp --no-save && node scripts/build-helena-team-logos.js
//   (needs network on first run; SVGs cache in .cache/game-icons/)

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const ROOT = path.resolve(__dirname, "..");
const CSV = path.join(ROOT, "data/helena/teams.csv");
const OUT_DIR = path.join(ROOT, "public/helena/teams");
const CACHE = path.join(ROOT, ".cache/game-icons");
const TREE = "https://api.github.com/repos/game-icons/icons/git/trees/master?recursive=1";
const RAW = "https://raw.githubusercontent.com/game-icons/icons/master/";
const SIZE = 512;

const INK = "#12201c"; // HSA evergreen-black, matches the site chrome
const ATTRIBUTION =
  "Team icons from game-icons.net, licensed CC BY 3.0. Must be credited on the site.";

// team id -> game-icons icon name. Only teams whose name actually depicts
// something. Anything absent falls back to the monogram, which is the right
// answer for every business-sponsored team (see header).
const ICONS = {
  // Coed White
  mothlod: "mine-wagon",          // Motherlode — Helena is a gold-rush town
  baseinvd: "alien-fire",         // Base Invaders
  lordofding: "crown",            // Lord of the Dings
  hitbrains: "brain",             // Hit for Brains
  alcoball: "beer-stein",         // Alcoballics
  gotwings: "wingfoot",           // Got Wings
  scaredhit: "ghost",             // Scared Hitless
  cepscor: "octopus",             // Cephalo Scorins (cephalopod)
  echochrch: "church",            // Echo Church
  // Coed Blue
  hopperjk: "kangaroo",           // Hopper Jackalopes
  bipbears: "polar-bear",         // Bi Polar Bears
  jesters: "jester-hat",          // Jesters Bar
  freefight: "flying-flag",       // Freedom Fighters (the skeleton-necromancer
                                  // icon read as horror, not liberty)
  bohelena: "baseball-bat",       // Batts Outta Helena
  misfits: "domino-mask",         // Missfits
  pitslap: "hand",                // Pitch Slapped
  onehitw: "musical-notes",       // One Hit Wonders
  tballers: "baseball-glove",     // T-Ballers
  unstpball: "cannon-ball",       // Unstoppa-balls
  hitsgiggle: "happy-skull",      // Hitts & Giggles
  // Coed Red
  jackwag: "old-wagon",           // Jack Wagons
  mimpact: "explosion-rays",      // Major Impact
  thedroll: "diamond-hard",       // The Diamond Rollers
  // Men's
  smokbnt: "cigar",               // Smoking Bunts
  hitmen: "target-arrows",        // Hitmen — a gun is not going on a
                                  // community rec-league jersey patch
  buntforce: "brain-freeze",      // Bunt Force Trauma
  trolls: "troll",                // Trolls
  brdgbomb: "bridge",             // Bridge Bombers
  hlclub: "lion",                 // Helena Lions Club
  regulatr: "sheriff-badge",      // Regulators
  bashbros: "hammer-drop",        // Bash Bros
  topgun: "jet-fighter",          // Top Gun Auto (name is aviation, not a mark)
  echoch: "church",
  // Women's
  batinten: "bat",                // Bat Intentions
  dwballs: "cricket-bat",         // Dolls w/ Balls
  "1hitw": "musical-notes",       // One-Hit Wonders
};

// Teams that must NEVER get figurative art (see SENSITIVE NAMES).
const MONOGRAM_ONLY = new Set(["skoden"]);

function parseCsv(text) {
  const lines = text.trim().split("\n");
  const head = split(lines[0]);
  return lines.slice(1).map((l) => {
    const c = split(l);
    const row = {};
    head.forEach((h, i) => (row[h] = c[i] ?? ""));
    return row;
  });
  function split(line) {
    const out = [];
    let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ",") { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  }
}

const xml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

const STOP = new Set(["OF", "THE", "AND", "A", "AN", "FOR", "TO", "BY", "CO", "W"]);
function letterMark(name) {
  const clean = name.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const words = clean.split(" ").filter((w) => w && !STOP.has(w));
  if (!words.length) return clean.slice(0, 2);
  if (clean.replace(/ /g, "").length <= 3) return clean.replace(/ /g, "");
  if (words.length === 1) return words[0].slice(0, 2);
  return words.slice(0, 3).map((w) => w[0]).join("");
}

function isLight(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45;
}

/** game-icons SVGs are a black background rect + a white icon path. Strip the
 *  background and recolour the glyph so it can sit on the team colour. */
function glyphPaths(svg, fill) {
  const paths = [...svg.matchAll(/<path\b[^>]*\bd="([^"]+)"[^>]*>/g)].map((m) => m[0]);
  const body = paths.filter((p) => !/d="M0 0h512v512H0z"/.test(p));
  return body
    .map((p) => p.replace(/\sfill="[^"]*"/g, "").replace("<path", `<path fill="${fill}"`))
    .join("");
}

async function fetchIcon(indexByName, name) {
  const rel = indexByName.get(name);
  if (!rel) return null;
  const file = path.join(CACHE, name + ".svg");
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return fs.readFileSync(file, "utf8");
  const res = await fetch(RAW + rel);
  if (!res.ok) return null;
  const svg = await res.text();
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(file, svg);
  return svg;
}

function glyphOnlySvg(glyph, ink) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">${glyphPaths(glyph, ink)}</svg>`;
}

function patchSvg({ color, mark }) {
  const ink = isLight(color) ? INK : "#ffffff";
  const inner = `<text x="100" y="100" text-anchor="middle" dominant-baseline="central"
             font-family="Arial Black, Arial, sans-serif"
             font-size="${mark.length >= 3 ? 62 : mark.length === 2 ? 84 : 112}"
             font-weight="900" fill="${ink}" letter-spacing="-1">${xml(mark)}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 200 200">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0.3" y2="1">
    <stop offset="0%" stop-color="#ffffff" stop-opacity="0.15"/>
    <stop offset="55%" stop-color="#ffffff" stop-opacity="0"/>
  </linearGradient></defs>
  <circle cx="100" cy="100" r="96" fill="${INK}"/>
  <circle cx="100" cy="100" r="90" fill="#ffffff"/>
  <circle cx="100" cy="100" r="84" fill="${color}"/>
  <circle cx="100" cy="100" r="84" fill="url(#g)"/>
  <g fill="none" stroke="${ink}" stroke-opacity="0.22" stroke-width="3.2" stroke-linecap="round">
    <path d="M31 47 C57 72, 57 128, 31 153"/>
    <path d="M169 47 C143 72, 143 128, 169 153"/>
  </g>
  ${inner}
</svg>`;
}

async function main() {
  if (!fs.existsSync(CSV)) throw new Error("run scripts/scrape-helena.ts first");
  const teams = parseCsv(fs.readFileSync(CSV, "utf8"));
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(CACHE, { recursive: true });

  // Index every icon name -> repo path once (cached on disk).
  const indexFile = path.join(CACHE, "_index.json");
  let indexByName;
  if (fs.existsSync(indexFile)) {
    indexByName = new Map(Object.entries(JSON.parse(fs.readFileSync(indexFile, "utf8"))));
  } else {
    const res = await fetch(TREE, { headers: { "User-Agent": "helena-logo-build" } });
    if (!res.ok) throw new Error(`game-icons index: ${res.status}`);
    const tree = await res.json();
    const obj = {};
    for (const n of tree.tree ?? []) {
      const m = /^([^/]+\/[^/]+\/([a-z0-9-]+)\.svg)$/.exec(n.path ?? "");
      if (m && !obj[m[2]]) obj[m[2]] = m[1];
    }
    fs.writeFileSync(indexFile, JSON.stringify(obj));
    indexByName = new Map(Object.entries(obj));
  }

  const made = [], missing = [], monogrammed = [];
  for (const t of teams) {
    const id = t.id, name = t.name, color = t.color || "#124734";
    let glyph = null;
    const want = MONOGRAM_ONLY.has(id) ? null : ICONS[id];
    if (want) {
      glyph = await fetchIcon(indexByName, want);
      if (!glyph) missing.push(`${id} (${want})`);
    }
    const mark = letterMark(name);
    if (!glyph) monogrammed.push(name);
    const out = path.join(OUT_DIR, `${id}.png`);
    const base = sharp(Buffer.from(patchSvg({ color, mark: glyph ? "" : mark })));
    if (glyph) {
      // Trim the glyph's own transparent margins before placing it, so every
      // icon lands the same optical size no matter how its art is drawn.
      const ink = isLight(color) ? INK : "#ffffff";
      const art = await sharp(Buffer.from(glyphOnlySvg(glyph, ink)))
        .trim()
        .resize(300, 300, { fit: "inside", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .toBuffer();
      const meta = await sharp(art).metadata();
      await base
        .composite([
          {
            input: art,
            left: Math.round((SIZE - (meta.width ?? 300)) / 2),
            top: Math.round((SIZE - (meta.height ?? 300)) / 2),
          },
        ])
        .png()
        .toFile(out);
    } else {
      await base.png().toFile(out);
    }
    made.push({ id, name, out });
  }

  // Contact sheet so the whole league can be eyeballed at once.
  const cols = 8, cell = 128;
  const rows = Math.ceil(made.length / cols);
  await sharp({
    create: {
      width: cols * cell, height: rows * cell,
      channels: 4, background: { r: 246, g: 247, b: 244, alpha: 1 },
    },
  })
    .composite(
      await Promise.all(
        made.map(async (m, i) => ({
          input: await sharp(m.out).resize(cell - 12, cell - 12).toBuffer(),
          left: (i % cols) * cell + 6,
          top: Math.floor(i / cols) * cell + 6,
        })),
      ),
    )
    .png()
    .toFile(path.join(OUT_DIR, "_contact-sheet.png"));

  console.log(`wrote ${made.length} team patches -> ${path.relative(ROOT, OUT_DIR)}`);
  console.log(`  icon art: ${made.length - monogrammed.length}, monogram: ${monogrammed.length}`);
  if (missing.length) console.log(`  icon name not found (fell back to monogram): ${missing.join(", ")}`);
  console.log(`\n${ATTRIBUTION}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
