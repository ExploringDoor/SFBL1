// Generates HSA's brand images from an SVG wordmark — the league has no
// logo file of its own, and every tenant needs at minimum its own share card.
//
// Why the share card matters: /og-default.png is literally SFBL's logo, so a
// tenant without theme.og_image_url texts out a South Florida Baseball League
// preview. (Adam hit exactly that sending an Island link.)
//
//   public/helena/og.png              1200×630 link preview card
//   public/helena/banner.png          1800×520 wide homepage hero
//   public/helena/logo.png             512×512 HSA wordmark (ticker tile)
//   public/helena/icon-512.png         512×512 softball, PWA install icon
//   public/helena/icon-192.png         192×192 softball
//   public/helena/apple-touch-icon.png 180×180 softball, iOS home screen
//   public/helena/favicon-{32,16}.png  browser-tab fallbacks (transparent)
//
// The tab itself uses public/helena/favicon.svg — hand-authored, not generated
// here — because an SVG `<link rel="icon">` outranks the PNGs in modern
// browsers. Keep the two in visual sync.
//
// Design: Montana evergreen ground, copper rule, chrome-white "HSA" over the
// full league name — matching theme.primary/accent in data/helena/provision.json.
// A ridge line runs along the bottom for a bit of Montana rather than a plain
// color field.
//
// Run:
//   npm install sharp --no-save && node scripts/build-helena-brand.js
//
// sharp is intentionally NOT a package.json dependency — it's only needed for
// these one-off image builds (same as build-og-image.js / build-pwa-icons.js).

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "public/helena");

const GREEN = "#124734";
const GREEN_DK = "#0b3325";
const COPPER = "#b4622d";
const GOLD = "#e0a83c";

// Mountain ridge, drawn to whatever width/height the caller needs.
const ridge = (w, h) => `
  <path d="M0 ${h} L${w * 0.13} ${h * 0.62} L${w * 0.22} ${h * 0.78}
           L${w * 0.34} ${h * 0.44} L${w * 0.48} ${h * 0.82}
           L${w * 0.58} ${h * 0.6} L${w * 0.72} ${h * 0.86}
           L${w * 0.85} ${h * 0.55} L${w} ${h * 0.9} L${w} ${h} Z"
        fill="#ffffff" fill-opacity="0.07"/>
  <path d="M0 ${h} L${w * 0.18} ${h * 0.8} L${w * 0.3} ${h * 0.88}
           L${w * 0.45} ${h * 0.7} L${w * 0.6} ${h * 0.9}
           L${w * 0.78} ${h * 0.74} L${w} ${h * 0.93} L${w} ${h} Z"
        fill="#ffffff" fill-opacity="0.05"/>`;

// Softball seams — two arcs, the same mark used in the site chrome.
const ball = (cx, cy, r, stroke) => `
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${stroke}" stroke-width="${r * 0.13}"/>
  <path d="M${cx - r * 0.72} ${cy - r * 0.62} C${cx - r * 0.2} ${cy - r * 0.2}, ${cx - r * 0.1} ${cy + r * 0.35}, ${cx - r * 0.45} ${cy + r * 0.78}"
        fill="none" stroke="${stroke}" stroke-width="${r * 0.11}" stroke-linecap="round"/>
  <path d="M${cx + r * 0.72} ${cy - r * 0.62} C${cx + r * 0.2} ${cy - r * 0.2}, ${cx + r * 0.1} ${cy + r * 0.35}, ${cx + r * 0.45} ${cy + r * 0.78}"
        fill="none" stroke="${stroke}" stroke-width="${r * 0.11}" stroke-linecap="round"/>`;

function ogSvg() {
  const W = 1200, H = 630;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${GREEN_DK}"/>
        <stop offset="60%" stop-color="${GREEN}"/>
        <stop offset="100%" stop-color="#175a41"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#g)"/>
    ${ridge(W, H)}
    ${ball(150, 315, 74, "rgba(255,255,255,0.85)")}
    <text x="272" y="292" font-family="Arial Black, Arial, sans-serif" font-size="132"
          font-weight="900" fill="#ffffff" letter-spacing="2">HSA</text>
    <text x="278" y="356" font-family="Arial, sans-serif" font-size="35"
          font-weight="700" fill="${GOLD}" letter-spacing="5">HELENA SOFTBALL ASSOCIATION</text>
    <text x="280" y="410" font-family="Arial, sans-serif" font-size="27"
          fill="rgba(255,255,255,0.72)" letter-spacing="1">Adult slowpitch · Helena, Montana</text>
    <rect x="0" y="${H - 16}" width="${W}" height="16" fill="${COPPER}"/>
  </svg>`;
}

// Softball icon used for the browser tab and the PWA/home-screen tiles.
// Mirrors public/helena/favicon.svg (the SVG the tab actually uses on modern
// browsers); these PNGs are the fallback for older browsers and app tiles.
// `ground` = null draws the ball on transparency, otherwise on brand green.
function ballIconSvg(size, ground) {
  const s = size;
  const vb = 64;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${vb} ${vb}">
    ${ground ? `<rect width="${vb}" height="${vb}" rx="${vb * 0.16}" fill="${ground}"/>` : ""}
    <circle cx="32" cy="32" r="${ground ? 24 : 29}" fill="#dfe94a"
            stroke="${ground ? "#0b3325" : GREEN}" stroke-width="${ground ? 3 : 4}"/>
    <g fill="none" stroke="#c8322a" stroke-width="${ground ? 3.4 : 4.2}" stroke-linecap="round"
       transform="${ground ? "translate(32 32) scale(0.83) translate(-32 -32)" : ""}">
      <path d="M13.5 13.5C22 21 25 30 24 40c-.6 6-3 11-6.5 15"/>
      <path d="M50.5 13.5C42 21 39 30 40 40c.6 6 3 11 6.5 15"/>
    </g>
  </svg>`;
}

function maskableSvg(size) {
  const vb = 64;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${vb} ${vb}">
    <rect width="${vb}" height="${vb}" fill="${GREEN}"/>
    <circle cx="32" cy="32" r="19" fill="#dfe94a" stroke="#0b3325" stroke-width="2.6"/>
    <g fill="none" stroke="#c8322a" stroke-width="2.7" stroke-linecap="round"
       transform="translate(32 32) scale(0.655) translate(-32 -32)">
      <path d="M13.5 13.5C22 21 25 30 24 40c-.6 6-3 11-6.5 15"/>
      <path d="M50.5 13.5C42 21 39 30 40 40c.6 6 3 11 6.5 15"/>
    </g>
  </svg>`;
}

function markSvg(size) {
  const s = size;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
    <rect width="${s}" height="${s}" fill="${GREEN}"/>
    ${ridge(s, s)}
    ${ball(s / 2, s * 0.33, s * 0.15, "rgba(255,255,255,0.55)")}
    <text x="${s / 2}" y="${s * 0.72}" text-anchor="middle"
          font-family="Arial Black, Arial, sans-serif" font-size="${s * 0.3}"
          font-weight="900" fill="#ffffff" letter-spacing="${s * 0.01}">HSA</text>
    <rect x="0" y="${s - Math.max(3, s * 0.03)}" width="${s}" height="${Math.max(3, s * 0.03)}" fill="${COPPER}"/>
  </svg>`;
}

// Wide homepage hero. theme.banner_url falls back to logo_url when unset,
// which puts the 512-square mark in a full-bleed hero slot — set this so the
// hero gets a banner shaped like a banner.
function bannerSvg() {
  const W = 1800, H = 520;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs>
      <linearGradient id="b" x1="0" y1="0" x2="1" y2="0.6">
        <stop offset="0%" stop-color="${GREEN_DK}"/>
        <stop offset="55%" stop-color="${GREEN}"/>
        <stop offset="100%" stop-color="#175a41"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#b)"/>
    ${ridge(W, H)}
    ${ball(W * 0.5 - 330, H * 0.47, 60, "rgba(255,255,255,0.8)")}
    <text x="${W * 0.5 - 245}" y="${H * 0.52}" font-family="Arial Black, Arial, sans-serif"
          font-size="118" font-weight="900" fill="#ffffff" letter-spacing="2">HSA</text>
    <text x="${W * 0.5 - 240}" y="${H * 0.52 + 52}" font-family="Arial, sans-serif" font-size="30"
          font-weight="700" fill="${GOLD}" letter-spacing="6">HELENA SOFTBALL ASSOCIATION</text>
    <rect x="0" y="${H - 12}" width="${W}" height="12" fill="${COPPER}"/>
  </svg>`;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const jobs = [
    ["og.png", ogSvg()],
    ["banner.png", bannerSvg()],
    // Ticker tile / PWA large icon keeps the HSA wordmark; the tab and
    // home-screen icons are the softball (Adam, 2026-07-30 — "put a softball
    // as the logo in the chrome you see next to other sites").
    ["logo.png", markSvg(512)],
    ["icon-512.png", ballIconSvg(512, GREEN)],
    ["icon-192.png", ballIconSvg(192, GREEN)],
    ["apple-touch-icon.png", ballIconSvg(180, GREEN)],
    ["favicon-32.png", ballIconSvg(32, null)],
    ["favicon-16.png", ballIconSvg(16, null)],
    // Android adaptive icon: the OS crops to a circle/squircle, so the ball
    // has to sit inside the inner 80% safe area with brand green bleeding to
    // the edges.
    ["icon-512-maskable.png", maskableSvg(512)],
  ];
  for (const [name, svg] of jobs) {
    const out = path.join(OUT_DIR, name);
    await sharp(Buffer.from(svg)).png().toFile(out);
    const { size } = fs.statSync(out);
    console.log(`wrote ${path.relative(ROOT, out)} (${Math.round(size / 1024)} KB)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
