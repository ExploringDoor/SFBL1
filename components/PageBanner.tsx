// Full-width header photo for a page. No text overlay — the photo itself
// labels the page (per Adam: "it says it in the pic"). Drop an image at
//   public/coybl/headers/<page>.{jpg,jpeg,png,webp,svg}
// and it appears as that page's banner; with no file, nothing renders (the
// page keeps its normal text header). Server component — checks the file on
// disk so a missing image degrades cleanly instead of showing a broken img.

import fs from "node:fs";
import path from "node:path";

const HEADER_DIR = "coybl/headers"; // under /public
const EXTS = ["jpg", "jpeg", "png", "webp", "svg"];

export function PageBanner({ page }: { page: string }) {
  let src: string | null = null;
  for (const ext of EXTS) {
    const rel = `${HEADER_DIR}/${page}.${ext}`;
    if (fs.existsSync(path.join(process.cwd(), "public", rel))) {
      src = `/${rel}`;
      break;
    }
  }
  if (!src) return null;

  return (
    <div style={{ width: "100%", lineHeight: 0, background: "var(--brand-primary)" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        style={{
          width: "100%",
          height: "clamp(150px, 24vw, 300px)",
          objectFit: "cover",
          display: "block",
        }}
      />
    </div>
  );
}
