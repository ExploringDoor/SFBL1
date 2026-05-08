// Generates a proper Open Graph share image at 1200×630 (the
// Facebook / iMessage / Twitter preferred aspect). Composites:
//   - Navy gradient background
//   - SFBL banner centered + scaled
//
// Saved as public/og-default.png. Layout.tsx points the og:image
// meta at this when no per-page override exists. The tenant logo
// (sfbl-header.png) is 1200×669 — close to the right aspect but
// not exact, and it has its own padding. A purpose-built OG image
// reads cleaner in chat-link previews.
//
// Re-run after the source banner or brand color changes.

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const ROOT = path.resolve(__dirname, "..");
const SOURCE_BANNER = path.join(
  ROOT,
  "public/logos/sfbl/sfbl-header.png",
);
const OUT_FILE = path.join(ROOT, "public/og-default.png");
const W = 1200;
const H = 630;

async function main() {
  if (!fs.existsSync(SOURCE_BANNER)) {
    console.error(`source banner not found: ${SOURCE_BANNER}`);
    process.exit(1);
  }

  // Trim whitespace/transparent edges from the source banner.
  const trimmed = await sharp(SOURCE_BANNER)
    .ensureAlpha()
    .trim({ threshold: 10 })
    .toBuffer();

  // Resize banner to fit comfortably with breathing room. We aim for
  // the banner to fill ~80% of the canvas width, keeping aspect.
  const bannerW = Math.round(W * 0.78);
  const bannerH = Math.round(H * 0.78);
  const banner = await sharp(trimmed)
    .resize(bannerW, bannerH, {
      fit: "inside",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .toBuffer();
  const bMeta = await sharp(banner).metadata();

  // Build the navy gradient background. Sharp doesn't have a
  // gradient primitive, so we composite a 2-pixel column with the
  // gradient and stretch it. Cleaner: build via raw Pixels API. Even
  // cleaner: use SVG.
  const svg = Buffer.from(`
    <svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#0c2340"/>
          <stop offset="100%" stop-color="#04101e"/>
        </linearGradient>
      </defs>
      <rect width="${W}" height="${H}" fill="url(#g)"/>
    </svg>
  `);

  const top = Math.round((H - (bMeta.height ?? bannerH)) / 2);
  const left = Math.round((W - (bMeta.width ?? bannerW)) / 2);

  await sharp(svg)
    .composite([{ input: banner, top, left }])
    .png({ compressionLevel: 9 })
    .toFile(OUT_FILE);

  console.log(`  og-default.png  ${W}×${H}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
