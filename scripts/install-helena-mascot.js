// Installs a generated mascot badge as a team logo.
//
//   node scripts/install-helena-mascot.js <teamId>=<imageUrl> [...]
//
// Pipeline, per image:
//   1. download the 2048px generation into .cache/helena-mascots/
//   2. trim the flat background the model paints around the badge — without
//      this the badge occupies ~60% of the frame and turns to mush at the
//      38-64px the score cards and standings tables render it at
//   3. pad back to a square so every team's patch lands the same optical size
//   4. circular alpha mask — the art is a round badge, and the baked white
//      corners otherwise render as a white block on the dark team hero and
//      in the ticker
//   5. write public/helena/teams/<teamId>.png at 512px
//
// The originals are kept in .cache/ so a badge can be re-cropped without
// paying to generate it again.

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const ROOT = path.resolve(__dirname, "..");
const CACHE = path.join(ROOT, ".cache/helena-mascots");
const OUT = path.join(ROOT, "public/helena/teams");
const SIZE = 512;

const MASK = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">` +
    `<circle cx="${SIZE / 2}" cy="${SIZE / 2}" r="${SIZE / 2 - 2}" fill="#fff"/></svg>`,
);

async function install(teamId, url) {
  fs.mkdirSync(CACHE, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });
  const raw = path.join(CACHE, `${teamId}.png`);
  if (!fs.existsSync(raw)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${teamId}: download ${res.status}`);
    fs.writeFileSync(raw, Buffer.from(await res.arrayBuffer()));
  }
  const trimmed = await sharp(raw).trim({ threshold: 12 }).toBuffer();
  const m = await sharp(trimmed).metadata();
  const side = Math.max(m.width, m.height);
  const squared = await sharp({
    create: { width: side, height: side, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } },
  })
    .composite([
      {
        input: trimmed,
        left: Math.round((side - m.width) / 2),
        top: Math.round((side - m.height) / 2),
      },
    ])
    .png()
    .toBuffer();
  const resized = await sharp(squared).resize(SIZE, SIZE, { fit: "fill" }).png().toBuffer();
  await sharp(resized)
    .composite([{ input: MASK, blend: "dest-in" }])
    .png()
    .toFile(path.join(OUT, `${teamId}.png`));
  console.log(`  ${teamId} installed`);
}

async function main() {
  const pairs = process.argv.slice(2).map((a) => {
    const i = a.indexOf("=");
    return [a.slice(0, i), a.slice(i + 1)];
  });
  if (!pairs.length) throw new Error("usage: install-helena-mascot.js id=url [...]");
  for (const [id, url] of pairs) await install(id, url);
  console.log(`${pairs.length} mascot(s) installed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
