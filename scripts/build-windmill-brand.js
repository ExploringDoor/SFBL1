// Generates Windmill Fastpitch's brand images from an SVG wordmark — the league
// has no logo file of its own, and every tenant needs at minimum its own share
// card (/og-default.png is SFBL's logo, so a tenant without theme.og_image_url
// texts out a South Florida Baseball League preview).
//
//   public/windmill/og.png              1200×630 link preview card
//   public/windmill/banner.png          1800×520 wide homepage hero
//   public/windmill/logo.png             512×512 WFS wordmark (ticker tile)
//   public/windmill/icon-512.png         512×512 softball, PWA install icon
//   public/windmill/icon-192.png         192×192 softball
//   public/windmill/apple-touch-icon.png 180×180 softball, iOS home screen
//   public/windmill/favicon-{32,16}.png  browser-tab fallbacks (transparent)
//   public/windmill/icon-512-maskable.png Android adaptive icon
//
// The tab itself uses public/windmill/favicon.svg — hand-authored, not generated
// here. Keep the two in visual sync.
//
// Design: evergreen ground, harvest-gold rule, chrome-white "WFS" over the full
// league name — matching theme.primary/accent in data/windmill/provision.json.
// A faint 4-sail windmill sits behind the wordmark (Windmill Fastpitch, Wisconsin
// farm country), the softball seam mark is kept for the chrome/app icons.
//
// Run:  npm install sharp --no-save && node scripts/build-windmill-brand.js
// sharp is intentionally NOT a package.json dependency (one-off image build).

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "public/windmill");

const GREEN = "#0e3d34";
const GREEN_DK = "#0a2e27";
const GOLD = "#c58a1a";
const GOLD_BRIGHT = "#e8a33d";

// A 4-sail windmill (classic mill "X"), drawn faint as a background watermark.
const windmill = (cx, cy, r, op) => {
  const sail = `
    <rect x="${cx - 3}" y="${cy - r}" width="6" height="${r}" fill="#ffffff" fill-opacity="${op}"/>
    <rect x="${cx - 18}" y="${cy - r * 0.96}" width="36" height="${r * 0.36}" fill="none"
          stroke="#ffffff" stroke-opacity="${op}" stroke-width="3.5"/>
    <line x1="${cx}" y1="${cy - r * 0.96}" x2="${cx}" y2="${cy - r * 0.6}" stroke="#ffffff" stroke-opacity="${op}" stroke-width="2.5"/>`;
  return `
    <g transform="rotate(45 ${cx} ${cy})">${sail}</g>
    <g transform="rotate(135 ${cx} ${cy})">${sail}</g>
    <g transform="rotate(225 ${cx} ${cy})">${sail}</g>
    <g transform="rotate(315 ${cx} ${cy})">${sail}</g>
    <circle cx="${cx}" cy="${cy}" r="${r * 0.06}" fill="#ffffff" fill-opacity="${op}"/>`;
};

// Softball seams — the same mark used in the site chrome.
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
        <stop offset="100%" stop-color="#155b4d"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#g)"/>
    ${windmill(980, 300, 250, 0.09)}
    ${ball(150, 315, 74, "rgba(255,255,255,0.85)")}
    <text x="272" y="292" font-family="Arial Black, Arial, sans-serif" font-size="132"
          font-weight="900" fill="#ffffff" letter-spacing="2">WFS</text>
    <text x="278" y="356" font-family="Arial, sans-serif" font-size="34"
          font-weight="700" fill="${GOLD_BRIGHT}" letter-spacing="4">WINDMILL FASTPITCH SOFTBALL</text>
    <text x="280" y="410" font-family="Arial, sans-serif" font-size="27"
          fill="rgba(255,255,255,0.72)" letter-spacing="1">Youth girls fastpitch · Lake Mills, Wisconsin</text>
    <rect x="0" y="${H - 16}" width="${W}" height="16" fill="${GOLD}"/>
  </svg>`;
}

// Softball icon for the browser tab and PWA/home-screen tiles.
function ballIconSvg(size, ground) {
  const vb = 64;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${vb} ${vb}">
    ${ground ? `<rect width="${vb}" height="${vb}" rx="${vb * 0.16}" fill="${ground}"/>` : ""}
    <circle cx="32" cy="32" r="${ground ? 24 : 29}" fill="#fbf1dc"
            stroke="${ground ? "#0a2e27" : GREEN}" stroke-width="${ground ? 3 : 4}"/>
    <g fill="none" stroke="${GOLD}" stroke-width="${ground ? 3.4 : 4.2}" stroke-linecap="round"
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
    <circle cx="32" cy="32" r="19" fill="#fbf1dc" stroke="#0a2e27" stroke-width="2.6"/>
    <g fill="none" stroke="${GOLD}" stroke-width="2.7" stroke-linecap="round"
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
    ${windmill(s * 0.5, s * 0.42, s * 0.34, 0.1)}
    ${ball(s / 2, s * 0.33, s * 0.15, "rgba(255,255,255,0.6)")}
    <text x="${s / 2}" y="${s * 0.72}" text-anchor="middle"
          font-family="Arial Black, Arial, sans-serif" font-size="${s * 0.3}"
          font-weight="900" fill="#ffffff" letter-spacing="${s * 0.01}">WFS</text>
    <rect x="0" y="${s - Math.max(3, s * 0.03)}" width="${s}" height="${Math.max(3, s * 0.03)}" fill="${GOLD}"/>
  </svg>`;
}

function bannerSvg() {
  const W = 1800, H = 520;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs>
      <linearGradient id="b" x1="0" y1="0" x2="1" y2="0.6">
        <stop offset="0%" stop-color="${GREEN_DK}"/>
        <stop offset="55%" stop-color="${GREEN}"/>
        <stop offset="100%" stop-color="#155b4d"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#b)"/>
    ${windmill(1480, 250, 235, 0.08)}
    ${ball(W * 0.5 - 330, H * 0.47, 60, "rgba(255,255,255,0.8)")}
    <text x="${W * 0.5 - 245}" y="${H * 0.52}" font-family="Arial Black, Arial, sans-serif"
          font-size="118" font-weight="900" fill="#ffffff" letter-spacing="2">WFS</text>
    <text x="${W * 0.5 - 240}" y="${H * 0.52 + 52}" font-family="Arial, sans-serif" font-size="30"
          font-weight="700" fill="${GOLD_BRIGHT}" letter-spacing="6">WINDMILL FASTPITCH SOFTBALL</text>
    <rect x="0" y="${H - 12}" width="${W}" height="12" fill="${GOLD}"/>
  </svg>`;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const jobs = [
    ["og.png", ogSvg()],
    ["banner.png", bannerSvg()],
    ["logo.png", markSvg(512)],
    ["icon-512.png", ballIconSvg(512, GREEN)],
    ["icon-192.png", ballIconSvg(192, GREEN)],
    ["apple-touch-icon.png", ballIconSvg(180, GREEN)],
    ["favicon-32.png", ballIconSvg(32, null)],
    ["favicon-16.png", ballIconSvg(16, null)],
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
