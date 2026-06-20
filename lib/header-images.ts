import fs from "node:fs";
import path from "node:path";

const EXTS = ["jpg", "jpeg", "png", "webp", "svg"];

// Map of page-slug -> public src for a tenant's header banner images, read from
// public/<tenant>/headers/<slug>.<ext>. Empty when the tenant has none (so the
// PageBanner renders nothing for leagues like SFBL). Server-only (uses fs).
export function headerImagesFor(tenant: string | null): Record<string, string> {
  if (!tenant || !/^[a-z0-9_-]+$/.test(tenant)) return {};
  const dir = path.join(process.cwd(), "public", tenant, "headers");
  let files: string[];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return {};
  }
  const map: Record<string, string> = {};
  for (const f of files) {
    const ext = path.extname(f).slice(1).toLowerCase();
    if (!EXTS.includes(ext)) continue;
    const slug = path.basename(f, path.extname(f));
    map[slug] ??= `/${tenant}/headers/${f}`;
  }
  return map;
}
