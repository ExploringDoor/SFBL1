// Generate ETBL's favicon / PWA icon set + OG share image from the league
// logo (public/etbl/logo.png). Mirrors the per-tenant brand scripts
// (build-ucsl-brand.js etc.).
//
// PLACEHOLDER LOGO. The league has not sent artwork yet, so when logo.png is
// missing this script first renders one — a navy disc, an orange basketball
// and an "ETBL" wordmark — from the inline SVG below. To swap in the real
// mark: drop it at public/etbl/logo.png (square, transparent background, the
// mark filling most of the canvas) and re-run. Pass --regen-placeholder to
// overwrite logo.png with the generated one again.
//
// Outputs into public/etbl/:
//   logo.png (512, only if missing)       — source for everything below
//   favicon-16.png, favicon-32.png        — browser tab
//   apple-touch-icon.png (180)            — iOS home screen
//   icon-192.png, icon-512.png            — PWA
//   icon-512-maskable.png                 — Android adaptive (safe area)
//   og.png (1200x630)                     — social / link-preview image
//
// sharp is not a dependency of this repo. Run with one of:
//   NODE_PATH=/path/to/some/node_modules node scripts/build-etbl-brand.js
//   npm i --no-save sharp && node scripts/build-etbl-brand.js

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const SLUG = "etbl";
const SRC = path.join(__dirname, "..", "public", SLUG, "logo.png");
const OUT = path.join(__dirname, "..", "public", SLUG);
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };
const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };

// Navy / burnt orange / amber — the placeholder theme in data/etbl/provision.json.
const NAVY = "#0b2545";
const ORANGE = "#c2410c";
const AMBER = "#f59e0b";

const PLACEHOLDER_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <circle cx="256" cy="256" r="250" fill="${NAVY}"/>
  <circle cx="256" cy="256" r="232" fill="none" stroke="${AMBER}" stroke-width="6"/>
  <g transform="translate(256 196)">
    <circle r="108" fill="${ORANGE}"/>
    <path d="M-108 0 H108 M0 -108 V108" stroke="${NAVY}" stroke-width="8" fill="none" stroke-linecap="round"/>
    <path d="M-76 -76 Q-8 0 -76 76 M76 -76 Q8 0 76 76" stroke="${NAVY}" stroke-width="8" fill="none" stroke-linecap="round"/>
  </g>
  <text x="256" y="428" text-anchor="middle" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-weight="900" font-size="118" fill="#ffffff" letter-spacing="6">ETBL</text>
</svg>`;

async function ensurePlaceholderLogo() {
  const regen = process.argv.includes("--regen-placeholder");
  if (fs.existsSync(SRC) && !regen) return false;
  fs.mkdirSync(OUT, { recursive: true });
  await sharp(Buffer.from(PLACEHOLDER_SVG)).png().toFile(SRC);
  console.log("  wrote logo.png 512x512 (PLACEHOLDER — replace with the real mark)");
  return true;
}

async function squareIcon(size, padFrac, file) {
  const inner = Math.round(size * (1 - padFrac * 2));
  const logo = await sharp(SRC)
    .resize(inner, inner, { fit: "contain", background: CLEAR })
    .toBuffer();
  await sharp({
    create: { width: size, height: size, channels: 4, background: WHITE },
  })
    .composite([{ input: logo, gravity: "center" }])
    .png()
    .toFile(path.join(OUT, file));
  console.log("  wrote", file, `${size}x${size}`);
}

async function ogImage() {
  const logo = await sharp(SRC)
    .resize(520, 520, { fit: "contain", background: CLEAR })
    .toBuffer();
  await sharp({
    create: { width: 1200, height: 630, channels: 4, background: WHITE },
  })
    .composite([{ input: logo, gravity: "center" }])
    .png()
    .toFile(path.join(OUT, "og.png"));
  console.log("  wrote og.png 1200x630");
}

(async () => {
  console.log(`[${SLUG}-brand] generating icons from`, SRC);
  const generated = await ensurePlaceholderLogo();
  if (!generated) console.log("  using existing logo.png");
  await squareIcon(16, 0.04, "favicon-16.png");
  await squareIcon(32, 0.04, "favicon-32.png");
  await squareIcon(180, 0.08, "apple-touch-icon.png");
  await squareIcon(192, 0.06, "icon-192.png");
  await squareIcon(512, 0.06, "icon-512.png");
  await squareIcon(512, 0.16, "icon-512-maskable.png");
  await ogImage();
  console.log(`[${SLUG}-brand] done.`);
})().catch((e) => {
  console.error(`[${SLUG}-brand] failed:`, e);
  process.exit(1);
});
