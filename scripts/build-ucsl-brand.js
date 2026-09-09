// Generate UCSL's favicon / PWA icon set + OG share image from the
// league logo (public/ucsl/logo.png — the round green/gold badge, on a
// transparent background). Mirrors the per-tenant brand scripts
// (build-windmill-brand.js etc.). White background so the badge reads
// cleanly in a browser tab, on an iOS/Android home-screen tile, and in a
// link-preview card.
//
// Outputs into public/ucsl/:
//   favicon-16.png, favicon-32.png        — browser tab
//   apple-touch-icon.png (180)            — iOS home screen
//   icon-192.png, icon-512.png            — PWA
//   icon-512-maskable.png                 — Android adaptive (safe area)
//   og.png (1200x630)                     — social / link-preview image
//
// Run: node scripts/build-ucsl-brand.js  (re-run if the logo changes)

const path = require("path");
const sharp = require("sharp");

const SRC = path.join(__dirname, "..", "public", "ucsl", "logo.png");
const OUT = path.join(__dirname, "..", "public", "ucsl");
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };
const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };

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
  console.log("[ucsl-brand] generating icons from", SRC);
  await squareIcon(16, 0.04, "favicon-16.png");
  await squareIcon(32, 0.04, "favicon-32.png");
  await squareIcon(180, 0.08, "apple-touch-icon.png");
  await squareIcon(192, 0.06, "icon-192.png");
  await squareIcon(512, 0.06, "icon-512.png");
  await squareIcon(512, 0.16, "icon-512-maskable.png");
  await ogImage();
  console.log("[ucsl-brand] done.");
})().catch((e) => {
  console.error("[ucsl-brand] failed:", e);
  process.exit(1);
});
