// Generates a cap-patch badge for every Windmill team — one 512x512 PNG per team
// into public/windmill/teams/<team-id>.png, plus a contact sheet for review.
//
// Built on the same roundel pipeline as scripts/build-helena-team-logos.js, but
// MONOGRAM-ONLY (no game-icons art, so no network + no attribution needed):
// Windmill's 124 teams are "Club - Coach" youth teams, mostly with no mascot of
// their own. A clean club monogram in the team color is the right placeholder
// until a coach uploads a real logo (the captain portal has a Team Logo tab).
// Business/trademark art would be wrong here for the same reason as Helena.
//
// Run:  npm install sharp --no-save && node scripts/build-windmill-team-logos.js

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const ROOT = path.resolve(__dirname, "..");
const CSV = path.join(ROOT, "data/windmill/teams.csv");
const OUT_DIR = path.join(ROOT, "public/windmill/teams");
const SIZE = 512;
const INK = "#0a2620"; // Windmill dark evergreen, matches the site chrome

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

// Monogram from the CLUB (the part before " - Coach"), which is the team identity.
// Keeps an uppercase abbreviation whole (BD, JC), else takes initials / first letters.
function clubMonogram(name) {
  const club = String(name).split(" - ")[0].trim();
  const words = club.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w));
  if (!words.length) return club.slice(0, 2).toUpperCase() || "WF";
  if (/^[A-Z]{2,3}$/.test(words[0])) return words[0];          // BD, JC, WI …
  if (words.length === 1) return words[0].slice(0, 3);          // Clyman -> CLY
  return words.slice(0, 3).map((w) => w[0]).join("");           // Verona Wildcats -> VW
}

function isLight(hex) {
  const n = parseInt(String(hex).replace("#", ""), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45;
}

function patchSvg(color, mark) {
  const ink = isLight(color) ? INK : "#ffffff";
  const inner = `<text x="100" y="104" text-anchor="middle" dominant-baseline="central"
             font-family="Arial Black, Arial, sans-serif"
             font-size="${mark.length >= 3 ? 62 : mark.length === 2 ? 84 : 112}"
             font-weight="900" fill="${ink}" letter-spacing="-1">${xml(mark)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 200 200">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0.3" y2="1">
    <stop offset="0%" stop-color="#ffffff" stop-opacity="0.16"/>
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
  if (!fs.existsSync(CSV)) throw new Error("run scripts/scrape-windmill.ts first");
  const teams = parseCsv(fs.readFileSync(CSV, "utf8"));
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const made = [];
  for (const t of teams) {
    const color = t.color || GREENFALLBACK;
    const mark = clubMonogram(t.name);
    const out = path.join(OUT_DIR, `${t.id}.png`);
    await sharp(Buffer.from(patchSvg(color, mark))).png().toFile(out);
    made.push({ id: t.id, name: t.name, mark, out });
  }

  // Contact sheet so the whole league can be eyeballed at once.
  const cols = 10, cell = 118;
  const rows = Math.ceil(made.length / cols);
  await sharp({
    create: { width: cols * cell, height: rows * cell, channels: 4, background: { r: 244, g: 248, b: 246, alpha: 1 } },
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

  console.log(`wrote ${made.length} team badges -> ${path.relative(ROOT, OUT_DIR)}`);
  console.log(`sample: ${made.slice(0, 6).map((m) => `${m.id}=${m.mark}`).join(", ")}`);
}

const GREENFALLBACK = "#0e3d34";
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
