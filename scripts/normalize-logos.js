// Normalize all SFBL team logos to 512×512 PNG with transparent
// padding. Pulls from `public/logos/sfbl/new/` (the freshly-generated
// ones from ChatGPT) for teams Adam picked, falling back to the
// existing logo otherwise. Output overwrites public/logos/sfbl/{slug}.png.

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const ROOT = "/Users/AdamMiller/Desktop/league-platform/.claude/worktrees/awesome-brahmagupta-6b27b6";
const NEW_DIR = "/Users/AdamMiller/Desktop/sfbl/public/logos/new";
const OUT_DIR = path.join(ROOT, "public/logos/sfbl");

// File-number → team-slug mapping. 45 (Broward Yankees) excluded
// because its header reads "AVENTURD YANKEES" (typo); we keep the
// existing broward-yankees.png until Adam regens.
const NEW_LOGOS = {
  44: "aventura-braves",
  // 45: SKIP — typo
  46: "margate-marlins",
  47: "palm-beach-pirates",
  48: "sunrise-giants",
  49: "sf-rays",
  50: "wpb-cardinals",
  51: "miami-cardinals",
  52: "sf-astros",
  53: "sf-angels",
  54: "dade-nationals",
  55: "delray-devil-rays",
  56: "broward-senators",
  57: "miami-jc",
  58: "aventura-dodgers",
  59: "miami-amigos",
  60: "southern-yankees",
  61: "matanzas",
  62: "boca-mets",
  63: "miami-brewers",
};

// Every team slug we want a normalized logo for. Pulls from
// teams.csv to stay accurate without hardcoding.
const TEAMS_CSV = path.join(ROOT, "data/sfbl/teams.csv");
const teamSlugs = fs
  .readFileSync(TEAMS_CSV, "utf8")
  .split("\n")
  .slice(1)
  .map((l) => l.split(",")[0])
  .filter(Boolean);

const TARGET = 512;
const PAD = 16; // breathing room inside the canvas
const FIT = TARGET - PAD * 2;

async function processOne(slug, source) {
  const buf = fs.readFileSync(source);
  const meta = await sharp(buf).metadata();
  // Trim any built-in white background from generator outputs so the
  // logo sits flush. ChatGPT-generated PNGs sometimes ship with a
  // solid white BG instead of transparency. `trim()` removes flat
  // borders matching the corner pixel.
  const trimmed = await sharp(buf)
    .ensureAlpha()
    .trim({ background: { r: 255, g: 255, b: 255 }, threshold: 10 })
    .png()
    .toBuffer()
    .catch(() => buf);

  // Resize to fit within FIT × FIT preserving aspect ratio.
  const resized = await sharp(trimmed)
    .resize(FIT, FIT, {
      fit: "inside",
      withoutEnlargement: false,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  // Extend onto a TARGET × TARGET transparent canvas.
  const rmeta = await sharp(resized).metadata();
  const top = Math.floor((TARGET - rmeta.height) / 2);
  const bottom = TARGET - rmeta.height - top;
  const left = Math.floor((TARGET - rmeta.width) / 2);
  const right = TARGET - rmeta.width - left;
  await sharp(resized)
    .extend({
      top,
      bottom,
      left,
      right,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ compressionLevel: 9 })
    .toFile(path.join(OUT_DIR, `${slug}.png`));

  return {
    slug,
    sourceShape: `${meta.width}×${meta.height}`,
    finalShape: `${TARGET}×${TARGET}`,
    source: path.basename(source),
  };
}

async function main() {
  // Build slug → source-path map, preferring new logos.
  const numberToSlug = NEW_LOGOS;
  const slugToNew = {};
  for (const [num, slug] of Object.entries(numberToSlug)) {
    const file = path.join(NEW_DIR, `${num}.png`);
    if (fs.existsSync(file)) slugToNew[slug] = file;
  }

  const results = [];
  for (const slug of teamSlugs) {
    const newFile = slugToNew[slug];
    const existing = path.join(OUT_DIR, `${slug}.png`);
    const source = newFile ?? (fs.existsSync(existing) ? existing : null);
    if (!source) {
      console.log(`  ${slug.padEnd(24)} ✗ no source — skipped`);
      continue;
    }
    const r = await processOne(slug, source);
    const tag = newFile ? "NEW" : "(rescaled existing)";
    console.log(
      `  ${r.slug.padEnd(24)} ${r.sourceShape.padStart(9)} → ${r.finalShape}  ${tag}`,
    );
    results.push(r);
  }
  console.log(`\nProcessed ${results.length} logos.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
