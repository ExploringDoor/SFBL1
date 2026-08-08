// Seed LCYBL content pages into a tenant's page_content collection.
//
// The generic scripts/seed-page-content.ts writes a markdown file verbatim,
// which is wrong for these files: they carry YAML frontmatter. Left in place
// the frontmatter renders as a literal "title: …" block at the top of every
// page, and the page heading falls back to a humanised slug ("rules-8u-10u" ->
// "Rules 8u 10u") instead of the real title.
//
// So this splits the frontmatter off, stores the title on the doc where the
// /content/[pageId] route already looks for it, and writes only the body as
// markdown.
//
// Usage:
//   FIRESTORE_EMULATOR_HOST=localhost:8080 GCLOUD_PROJECT=<project> \
//     node tools/seed_pages.mjs <leagueId> <pagesDir>

import fs from "node:fs";
import path from "node:path";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const [, , leagueId, pagesDir] = process.argv;
if (!leagueId || !pagesDir) {
  console.error("usage: node seed_pages.mjs <leagueId> <pagesDir>");
  process.exit(1);
}

/** Split `---\ntitle: X\n---\n<body>` into { title, body }. Tolerates a file
 *  with no frontmatter, which simply yields a null title. */
function splitFrontmatter(raw) {
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n?/.exec(raw);
  if (!m) return { title: null, body: raw.trim() };
  const title = /^\s*title:\s*(.+?)\s*$/m.exec(m[1])?.[1] ?? null;
  return {
    // Strip surrounding quotes if the YAML used them.
    title: title ? title.replace(/^["']|["']$/g, "") : null,
    body: raw.slice(m[0].length).trim(),
  };
}

// Against the emulator no credential is used at all, and passing
// `credential: undefined` explicitly still trips firebase-admin's option
// validation — the key has to be absent from the object, not present-and-undefined.
const app = initializeApp(
  process.env.FIRESTORE_EMULATOR_HOST
    ? { projectId: process.env.GCLOUD_PROJECT || "demo" }
    : { projectId: process.env.GCLOUD_PROJECT, credential: applicationDefault() },
);
const db = getFirestore(app);

const files = fs.readdirSync(pagesDir).filter((f) => f.endsWith(".md")).sort();
if (files.length === 0) {
  console.error(`no .md files in ${pagesDir}`);
  process.exit(1);
}

const now = new Date().toISOString();
let ok = 0;
for (const file of files) {
  const slug = path.basename(file, ".md");
  const raw = fs.readFileSync(path.join(pagesDir, file), "utf8");
  const { title, body } = splitFrontmatter(raw);
  await db.doc(`leagues/${leagueId}/page_content/${slug}`).set(
    {
      markdown: body,
      ...(title ? { title } : {}),
      updated_at: now,
      updated_by_uid: "seed-script",
    },
    { merge: true },
  );
  ok += 1;
  console.log(
    `  ${slug.padEnd(16)} ${String(body.length).padStart(6)} chars  ` +
      `title=${title ?? "(none — will humanise the slug)"}`,
  );
}
console.log(`\nseeded ${ok}/${files.length} pages into leagues/${leagueId}/page_content`);
process.exit(0);
