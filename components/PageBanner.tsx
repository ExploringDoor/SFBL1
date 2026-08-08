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

import { bannerSlugFor } from "@/lib/header-images";

// LCYBL strip banners ALL render the same way home does — full-bleed width,
// NATURAL height (width:100% + height:auto), showing the whole banner across
// (Adam, 2026-08-07: "I want the banner to go fully across just like the main
// homepage has"). Every banner JPG is pre-cropped to its ribbon + wordmark
// (the empty field below is trimmed), so the natural heights land near home's.
// No object-fit:cover and NO max-height clip — the JPG's bottom edge IS the
// bottom of the wordmark, so any clip would cut the word off (Adam: "standings
// also cut off"). Height just follows the art at every width.

export function PageBanner({
  images,
  imagesSmall,
  initialSlug,
  fullBleed = false,
  strip = false,
  leagueName = "",
  tenantId,
}: {
  images: Record<string, string>;
  /** Phone-sized variants keyed by the same slug. When a slug is present here
   *  the banner emits a srcset so a 375px screen fetches the 1000px file
   *  instead of the 2000px one. Optional: a tenant without variants renders
   *  exactly as before. */
  imagesSmall?: Record<string, string>;
  initialSlug: string;
  /** Used to build a real alt. The banner art carries the page + league
   *  identity, so alt="" would hide the page's own heading from a screen
   *  reader on full-bleed tenants where the art replaces the <h1>. */
  leagueName?: string;
  /** Edge-to-edge strip instead of natural size. Off by default so existing
   *  tenants are unchanged. */
  fullBleed?: boolean;
  /** Slim, super-wide fixed-ratio band (LCYBL). All the banners are one
   *  aspect ratio (STRIP_RATIO), so the box height tracks the exact-fit height
   *  and object-fit:cover shows the whole image with no side letterboxing. On
   *  very wide screens the height caps and the crop is top/bottom only — the
   *  baked title sits centred vertically, so it never clips. */
  strip?: boolean;
  /** Tenant id — only used to scope per-tenant banner suppression rules. */
  tenantId?: string;
}) {
  // usePathname() is null during the root layout's server render, so seed the
  // slug from `initialSlug` (server-derived from the request path). On the
  // client it updates with the route so the banner swaps on in-app navigation.
  const pathname = usePathname();
  const slug = pathname ? bannerSlugFor(pathname) : initialSlug;
  // LCYBL: an individual team page (/teams/<id>) has its own team hero, so the
  // generic "TEAMS" strip on top is redundant — Adam wants the team page ONLY.
  // The grid page (/teams) keeps its banner. Scoped to lcybl so other tenants
  // are unchanged.
  const parts = (pathname ?? "").split("/").filter(Boolean);
  if (tenantId === "lcybl" && parts[0] === "teams" && parts.length > 1) {
    return null;
  }
  const src = images[slug];
  if (!src) return null;
  const small = imagesSmall?.[slug];
  // Both banners are full-bleed, so the rendered width is always the viewport.
  const srcSet = small ? `${small} 1000w, ${src} 2000w` : undefined;
  const sizes = small ? "100vw" : undefined;

  // COYBL: every page header spans the full screen width.
  //
  // Adam, 2026-08-08. The banners are 375px at natural size and were rendered
  // at that size, so they filled a narrow phone but left ~197px of white on
  // EACH side at 768px — a tablet, or a phone in landscape. Anything wider
  // than ~563px had gutters.
  //
  // NOT flags.banner_full_bleed: that path caps height at clamp(84px,21vw,330px)
  // with object-fit:contain over black, which letterboxes. Right for Island,
  // whose banners range 5.4:1 to 3.25:1. COYBL's are all exactly 2.50:1, so
  // width:100% + height:auto gives identical heights on every page with
  // nothing cropped and no bars — which is what Adam approved on the homepage
  // before asking for it everywhere.
  if (tenantId === "coybl") {
    return (
      <div style={{ width: "100%", lineHeight: 0 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          srcSet={srcSet}
          sizes="100vw"
          alt={bannerAlt(slug, leagueName)}
          style={{ display: "block", width: "100%", height: "auto" }}
        />
      </div>
    );
  }

  if (strip) {
    // Every page (home + interior) renders the same: full-bleed width, natural
    // height, whole banner across — no cover-crop, no max-height clip.
    return (
      <div
        style={{
          width: "100%",
          background: "#0b1b3a",
          lineHeight: 0,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          srcSet={srcSet}
          sizes={sizes}
          alt={bannerAlt(slug, leagueName)}
          style={{ display: "block", width: "100%", height: "auto" }}
        />
      </div>
    );
  }

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
          srcSet={srcSet}
          sizes={sizes}
          // The banner art carries the page + league identity (it IS the page
          // heading for full-bleed tenants), so it needs a real alt, not "".
          alt={bannerAlt(slug, leagueName)}
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
        srcSet={srcSet}
        sizes={sizes}
        alt={bannerAlt(slug, leagueName)}
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

/** "Island Fastpitch" on home, "Standings — Island Fastpitch" elsewhere. */
function bannerAlt(slug: string, leagueName: string): string {
  const league = leagueName.trim();
  if (slug === "home" || !slug) return league;
  const page = slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return league ? `${page}, ${league}` : page;
}
