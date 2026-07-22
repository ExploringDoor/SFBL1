"use client";

// Header photo for the current page. Two modes:
//
//   default   shown at its NATURAL size, centered, with white space on the
//             sides (COYBL — photographic art that should not be cropped).
//   fullBleed edge-to-edge, scaled to the full width with NOTHING cropped
//             (Island Fastpitch — logo artwork on a solid black field, where the
//             natural-size mode left visible white gutters at the sides).
//
// Natural mode uses width:auto under a max-height, which CANNOT be edge-to-edge
// at every viewport: the image only fills the screen when its aspect ratio
// happens to exceed viewportWidth / maxHeight. fullBleed drops the height cap
// entirely — width:100% + height:auto — so the image simply scales up to fit.
//
// Deliberately NOT object-fit: cover. Cover fills the box by cropping, which ate
// the top and bottom of the artwork.
//
// object-fit: contain under a max-height instead. The source banners are not the
// same shape (5.4:1 down to 3.25:1), so at full width they rendered wildly
// different heights — Teams was 469px against Home's 283px. contain caps the
// height without cropping anything; the leftover space appears at the SIDES, and
// because this artwork sits on a solid black field against a black container,
// those bars are invisible. Uniform height, nothing lost.
//
// No text overlay; the photo itself labels the page. The image is chosen by the first
// path segment ("/standings" -> "standings", "/" -> "home"). `images`
// (slug -> src) is built server-side from public/<tenant>/headers/ and passed
// in, so a league with no images renders nothing. Client component so the
// banner swaps correctly on in-app navigation.

import { usePathname } from "next/navigation";

export function PageBanner({
  images,
  initialSlug,
  fullBleed = false,
}: {
  images: Record<string, string>;
  initialSlug: string;
  /** Edge-to-edge strip instead of natural size. Off by default so existing
   *  tenants are unchanged. */
  fullBleed?: boolean;
}) {
  // usePathname() is null during the root layout's server render, so seed the
  // slug from `initialSlug` (server-derived from the request path). On the
  // client it updates with the route so the banner swaps on in-app navigation.
  const pathname = usePathname();
  const slug = pathname ? pathname.split("/")[1] || "home" : initialSlug;
  const src = images[slug];
  if (!src) return null;

  if (fullBleed) {
    return (
      <div
        style={{
          width: "100%",
          // Matches the artwork's own background so any letterboxing at extreme
          // aspect ratios blends instead of showing a white band.
          background: "#000",
          lineHeight: 0,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt=""
          style={{
            display: "block",
            width: "100%",
            // 21vw is the real driver. The floor is deliberately LOW: at 390px
            // wide the 5.4:1 home banner is only 72px tall, so a 150px floor
            // would have padded phones with 39px of dead black above and below.
            height: "clamp(84px, 21vw, 330px)",
            objectFit: "contain",
          }}
        />
      </div>
    );
  }

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
