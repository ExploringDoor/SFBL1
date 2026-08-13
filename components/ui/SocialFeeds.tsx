"use client";

// Three social feed boxes at the bottom of the home page.
//
// Mike ran two social apps on the old Wix site and asked for the same here
// (via Adam, 2026-08-13).
//
// EACH NETWORK USES A DIFFERENT MECHANISM, on purpose, because what each one
// costs and requires is wildly different:
//
//   instagram — an Elfsight widget id (paid live feed) OR a single POST URL
//               rendered with Instagram's free official embed. Instagram
//               killed Basic Display in Dec 2024, and the Graph API route
//               needs the Business account authorised THROUGH its linked
//               Facebook page — the same thing Adam cannot do, since the
//               Facebook is Mike's. So free means one hand-picked post.
//   facebook  — the PAGE URL, rendered with Facebook's own free Page Plugin.
//               No provider, no fee, and critically no account connection:
//               Elfsight's Facebook widget wanted Adam to link Mike's personal
//               Facebook, which he cannot do. The plugin only needs a public
//               page.
//   tiktok    — either an Elfsight widget id (live feed, paid) or a single
//               VIDEO URL rendered with TikTok's free official embed. TikTok
//               publishes no profile-feed embed at all, so free means one
//               hand-picked video.
//
// The type of each value decides the mechanism, so switching TikTok from a
// paid live feed to a free pinned video is a config edit, not a deploy.
//
// LAZY, because of where it sits. Nothing here loads with the page: an
// IntersectionObserver pulls the scripts in only once someone scrolls near the
// boxes. A parent who opens the site to check one score never pays for them —
// which also means they never spend an Elfsight view.

import { useEffect, useRef, useState } from "react";
import { SocialPostCard } from "@/components/ui/SocialPostCard";
import type { SocialPost } from "@/lib/social/meta";

export interface SocialWidgets {
  /** Elfsight widget id, OR a single instagram.com post URL. */
  instagram?: string;
  /** Public Facebook page URL, e.g. https://www.facebook.com/islandfastpitch */
  facebook?: string;
  /** Elfsight widget id, OR a single tiktok.com video URL. */
  tiktok?: string;
}

const LABELS: Record<keyof SocialWidgets, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
};

// How tall Facebook's own header is, and how tall we want the visible box.
// The header is cropped off the top (see the Facebook branch below), so the
// iframe is rendered FB_HEADER_H taller than the window that shows it.
//
// 115 is measured, not chosen: at 64 the page name still showed, cut in half,
// sitting just below the cut. Facebook publishes no height for this and the
// plugin markup carries no fixed value to read, so the number came from
// screenshots. Slightly over-cropping is the safe direction — it eats
// whitespace above the first post, where under-cropping leaves a severed
// line of text that looks like a broken page.
//
// If Facebook ever changes that header, this is the one number to move.
const FB_HEADER_H = 115;
const FB_BOX_H = 460;

/** Elfsight ids are UUIDs; anything with a slash is a URL. */
const isElfsightId = (v: string) => /^[0-9a-f-]{20,60}$/i.test(v.trim());

export function SocialFeeds({
  widgets,
  links,
  posts,
  heading = "Follow along",
}: {
  widgets?: SocialWidgets | null;
  /** Posts already fetched server-side from Meta's Graph API. When a network
   *  has these, they WIN over any embed or widget: they render in the site's
   *  own styling, cost no third-party script, and cannot go stale the way a
   *  hand-picked embed does. */
  posts?: { instagram?: SocialPost[]; facebook?: SocialPost[] } | null;
  /** The league's profile URLs, for the "Follow us" link on each box. Separate
   *  from `widgets` because a widget value is not a profile: TikTok's is an
   *  Elfsight id and Instagram's may be a single post. */
  links?: { instagram?: string; facebook?: string; tiktok?: string } | null;
  heading?: string;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [load, setLoad] = useState(false);

  const native: Partial<Record<keyof SocialWidgets, SocialPost[]>> = {
    instagram: posts?.instagram?.length ? posts.instagram : undefined,
    facebook: posts?.facebook?.length ? posts.facebook : undefined,
  };

  // A box appears if we have real posts for it OR an embed configured. Order
  // is fixed rather than derived from object keys, so the row does not
  // reshuffle when a network is added or a fetch comes back empty.
  const ORDER: (keyof SocialWidgets)[] = ["instagram", "facebook", "tiktok"];
  const entries = ORDER.filter(
    (k) => native[k]?.length || (widgets?.[k] ?? "").trim().length > 0,
  ).map((k) => [k, (widgets?.[k] ?? "").trim()] as [keyof SocialWidgets, string]);

  const needsElfsight = entries.some(
    ([k, v]) => !native[k] && (k === "instagram" || k === "tiktok") && isElfsightId(v),
  );
  const needsTikTokScript = entries.some(
    ([k, v]) => !native[k] && k === "tiktok" && v && !isElfsightId(v),
  );
  const needsInstagramScript = entries.some(
    ([k, v]) => !native[k] && k === "instagram" && v && !isElfsightId(v),
  );

  useEffect(() => {
    if (!entries.length || load) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setLoad(true);
      return;
    }
    const io = new IntersectionObserver(
      (obs) => {
        if (obs.some((o) => o.isIntersecting)) {
          setLoad(true);
          io.disconnect();
        }
      },
      // Early enough that the boxes are filling in on arrival rather than
      // popping in once you get there.
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [entries.length, load]);

  useEffect(() => {
    if (!load) return;
    const add = (src: string) => {
      if (document.querySelector(`script[src="${src}"]`)) return;
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      document.body.appendChild(s);
    };
    // Elfsight's CURRENT cdn. Their older docs say
    // static.elfsight.com/platform/platform.js; the embed code they hand you
    // today is this one, and the mismatch just leaves the box empty.
    if (needsElfsight) add("https://elfsightcdn.com/platform.js");
    if (needsTikTokScript) add("https://www.tiktok.com/embed.js");
    if (needsInstagramScript) add("https://www.instagram.com/embed.js");
  }, [load, needsElfsight, needsTikTokScript, needsInstagramScript]);

  if (!entries.length) return null;

  return (
    <section ref={ref} className="le-social-feeds" aria-label={heading}>
      <h2 className="le-social-feeds-head">{heading}</h2>
      <div className="le-social-feeds-grid">
        {entries.map(([key, value]) => (
          <div key={key} className="le-social-feeds-card">
            <div className="le-social-feeds-label">
              <span>{LABELS[key]}</span>
              {links?.[key] && (
                <a
                  className="le-social-feeds-follow"
                  href={links[key]}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Follow us
                </a>
              )}
            </div>
            {native[key]?.length ? (
              // Real posts, rendered by us. No script, no iframe, no lazy gate
              // — these are just images and text, so they cost almost nothing
              // and are visible immediately.
              <div className="le-post-list">
                {native[key]!.slice(0, 2).map((p) => (
                  <SocialPostCard key={p.id} post={p} />
                ))}
              </div>
            ) : !load ? (
              <div className="le-social-feeds-skeleton" aria-hidden="true" />
            ) : key === "facebook" ? (
              // Facebook's own plugin. adapt_container_width makes it fill the
              // box; a fixed pixel width would overflow on a phone.
              // Facebook's header, cropped away.
              //
              // The plugin has no "no header" option, and with it on, the page
              // name renders cut in half — Adam screenshotted it three times,
              // through small_header and hide_cover, and it never came right.
              // So the iframe is pulled up inside a clipping window by exactly
              // the header's height and made that much taller to compensate.
              //
              // scrolling="no" is required for this: if the frame scrolled,
              // the header would scroll away and the crop would start eating
              // the posts instead. A fixed window means the crop always lands
              // in the same place.
              //
              // The card already says FACEBOOK and carries a Follow us link,
              // so nothing is lost — that header was duplicated chrome.
              <div
                className="le-social-feeds-fb"
                style={{
                  position: "relative",
                  height: FB_BOX_H,
                  overflow: "hidden",
                }}
              >
                <iframe
                  title="Facebook"
                  src={
                    "https://www.facebook.com/plugins/page.php?href=" +
                    encodeURIComponent(value) +
                    `&tabs=timeline&width=500&height=${FB_BOX_H + FB_HEADER_H}` +
                    "&small_header=true&adapt_container_width=true" +
                    "&hide_cover=true&show_facepile=false"
                  }
                  style={{
                    position: "absolute",
                    top: -FB_HEADER_H,
                    left: 0,
                    border: "none",
                    width: "100%",
                    height: FB_BOX_H + FB_HEADER_H,
                  }}
                  scrolling="no"
                  frameBorder="0"
                  allow="clipboard-write; encrypted-media; picture-in-picture; web-share"
                />
              </div>
            ) : key === "instagram" && !isElfsightId(value) ? (
              // Free single-post embed. Instagram's script turns this into
              // the real post. Light-background by design and Instagram gives
              // no dark option, so the card keeps its own dark frame around it.
              <blockquote
                className="instagram-media"
                data-instgrm-permalink={value}
                data-instgrm-version="14"
                style={{ margin: 0, width: "100%", minWidth: 0, background: "#fff" }}
              />
            ) : key === "tiktok" && !isElfsightId(value) ? (
              // Free single-video embed. TikTok's script turns this blockquote
              // into a player.
              <blockquote
                className="tiktok-embed"
                cite={value}
                data-video-id={value.split("/video/")[1]?.split(/[?#]/)[0] ?? ""}
                style={{ maxWidth: "100%", minWidth: 0, margin: 0 }}
              >
                <section />
              </blockquote>
            ) : (
              <div className={`elfsight-app-${value}`} data-elfsight-app-lazy />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
