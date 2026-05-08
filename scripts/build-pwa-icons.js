// Generates the PWA icon set for SFBL, mirroring the DVSL pattern:
//   /public/icons/icon-192.png            — 192×192 (home screen / browser)
//   /public/icons/icon-512.png            — 512×512 (splash, large tile)
//   /public/icons/icon-maskable-512.png   — 512×512 with 12% safe-area
//                                            padding for Android adaptive icons
//   /public/icons/apple-touch-icon.png    — 180×180 (iOS Safari)
//
// Source: public/logos/sfbl/sfbl-logo.png (vertical SFBL crest).
// Background: brand navy (#0c2340) so the icon reads cleanly on iOS
// home screens and Android launchers regardless of the device wallpaper.
//
// Run:
//   node scripts/build-pwa-icons.js
//
// Re-run after the source logo or brand color changes.

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const ROOT = path.resolve(__dirname, "..");
const SOURCE = path.join(ROOT, "public/logos/sfbl/sfbl-logo.png");
const OUT_DIR = path.join(ROOT, "public/icons");
const BG_HEX = "#0c2340"; // SFBL primary navy — matches theme.primary.
// 0% = no padding (logo fills canvas). 10% = 51px margin on each side
// of a 512 canvas. Gives the logo breathing room so it doesn't touch
// the edge.
const STANDARD_PADDING = 0.1;
// Maskable icons MUST keep the logo inside the inner 80% of the canvas
// because Android crops to a circle/squircle at runtime. 16% padding
// guarantees the safe area.
const MASKABLE_PADDING = 0.16;

async function buildOne({
  outName,
  size,
  padding,
  bg,
}) {
  // Trim transparent / matching-corner pixels from the source so the
  // logo fills the available area regardless of how much padding the
  // source PNG carries. We let sharp pick the trim color by sampling
  // the corner pixel — works whether the source is on a transparent,
  // white, or any solid background.
  const trimmed = await sharp(SOURCE)
    .ensureAlpha()
    .trim({ threshold: 10 })
    .toBuffer();

  // Inset = how far from each edge the logo sits.
  const inset = Math.round(size * padding);
  const inner = size - inset * 2;

  // Resize the trimmed logo to fit within the inner box, preserving
  // aspect ratio. `inside` fits — the result may be narrower or
  // shorter than `inner` × `inner`.
  const logoFit = await sharp(trimmed)
    .resize(inner, inner, {
      fit: "inside",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .toBuffer();
  const logoMeta = await sharp(logoFit).metadata();
  const top = Math.round((size - (logoMeta.height ?? inner)) / 2);
  const left = Math.round((size - (logoMeta.width ?? inner)) / 2);

  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: bg ?? { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: logoFit, top, left }])
    .png({ compressionLevel: 9 })
    .toFile(path.join(OUT_DIR, outName));

  console.log(
    `  ${outName.padEnd(28)} ${size}×${size} pad=${(padding * 100).toFixed(0)}% bg=${
      bg ? "#" + Object.values(bg).slice(0, 3).map((n) => n.toString(16).padStart(2, "0")).join("") : "transparent"
    }`,
  );
}

async function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error(`source not found: ${SOURCE}`);
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const navy = hexToRgb(BG_HEX);

  await buildOne({ outName: "icon-192.png", size: 192, padding: STANDARD_PADDING, bg: navy });
  await buildOne({ outName: "icon-512.png", size: 512, padding: STANDARD_PADDING, bg: navy });
  await buildOne({
    outName: "icon-maskable-512.png",
    size: 512,
    padding: MASKABLE_PADDING,
    bg: navy,
  });
  await buildOne({
    outName: "apple-touch-icon.png",
    size: 180,
    padding: STANDARD_PADDING,
    bg: navy,
  });
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`bad hex: ${hex}`);
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff, alpha: 1 };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
