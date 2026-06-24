"use client";

// Header photo for the current page, shown at its NATURAL size — centered, with
// white space on the sides (not cropped/stretched to a banner strip). No text
// overlay; the photo itself labels the page. The image is chosen by the first
// path segment ("/standings" -> "standings", "/" -> "home"). `images`
// (slug -> src) is built server-side from public/<tenant>/headers/ and passed
// in, so a league with no images renders nothing. Client component so the
// banner swaps correctly on in-app navigation.

import { usePathname } from "next/navigation";

export function PageBanner({
  images,
  initialSlug,
}: {
  images: Record<string, string>;
  initialSlug: string;
}) {
  // usePathname() is null during the root layout's server render, so seed the
  // slug from `initialSlug` (server-derived from the request path). On the
  // client it updates with the route so the banner swaps on in-app navigation.
  const pathname = usePathname();
  const slug = pathname ? pathname.split("/")[1] || "home" : initialSlug;
  const src = images[slug];
  if (!src) return null;

  return (
    <div style={{ width: "100%", background: "#fff", textAlign: "center" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        style={{
          display: "inline-block",
          maxWidth: "100%",
          maxHeight: "min(60vw, 420px)",
          width: "auto",
          height: "auto",
          verticalAlign: "middle",
        }}
      />
    </div>
  );
}
