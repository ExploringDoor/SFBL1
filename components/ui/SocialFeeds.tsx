"use client";

// Three social feed boxes at the bottom of the home page.
//
// Mike ran two social apps on the old Wix site and asked for the same here
// (via Adam, 2026-08-13).
//
// EACH NETWORK USES A DIFFERENT MECHANISM, on purpose, because what each one
// costs and requires is wildly different:
//
//   instagram — posts pulled server-side from Meta's Graph API (lib/social/meta)
//               and rendered by us. Free, live, and styled like the rest of the
//               site. Falls back to an Elfsight widget id or a single post URL
//               if no credentials are stored.
//   facebook  — the same Graph API pull. Falls back to the free Page Plugin,
//               which works with no login but forces a header we can only hide
//               by cropping the iframe.
//   tiktok    — an Elfsight widget id. TikTok publishes no profile-feed embed
//               and is not in Meta's Graph API, so this is the one network with
//               no free live option; it is what the Elfsight subscription buys.
//               Falls back to a single video URL via TikTok's own embed.
//
// `posts` WINS over `widgets` wherever both exist: a real feed beats an embed
// that goes stale, and rendering it ourselves means no third-party script and
// nothing to crop.
//
// Earlier this file said Instagram and Facebook could only be embeds because
// authorising the Graph API needs Mike's Facebook. That was true of Elfsight's
// connect flow; it is not a reason the API cannot be used. Mike authorises a
// Meta app once, Adam owns the app, and the site reads the posts from then on.
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

// Brand glyphs, inline so a network is recognisable before the word is read.
// SVG rather than emoji, per the house rule — an emoji renders as a different
// picture on every platform and none of them are the brand.
//
// currentColor throughout, so they take the label's colour and shift with it
// on hover without a second rule.
const ICONS: Record<keyof SocialWidgets, JSX.Element> = {
  instagram: (
    <>
      <rect x="2" y="2" width="20" height="20" rx="5.5" />
      <circle cx="12" cy="12" r="4.2" />
      <circle cx="17.6" cy="6.4" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  facebook: (
    <path d="M14.5 8.5V6.8c0-.8.2-1.3 1.4-1.3h1.5V2.6c-.3 0-1.2-.1-2.2-.1-2.2 0-3.7 1.3-3.7 3.8v2.2H9v3h2.5V21h3v-8.5H17l.4-3z" />
  ),
  tiktok: (
    <path d="M16.5 2.5c.3 1.9 1.4 3.4 3.2 3.9v3.1a7.1 7.1 0 0 1-3.9-1.3v5.9a5.9 5.9 0 1 1-5.9-5.9c.3 0 .6 0 .9.1v3.1a2.9 2.9 0 1 0 2 2.8V2.5z" />
  ),
};

function NetworkIcon({ network }: { network: keyof SocialWidgets }) {
  // Facebook and TikTok are solid shapes; Instagram is a line drawing, so it
  // needs the stroke and must NOT be filled.
  const outline = network === "instagram";
  return (
    <svg
      className="le-social-feeds-icon"
      viewBox="0 0 24 24"
      width="15"
      height="15"
      aria-hidden="true"
      focusable="false"
      fill={outline ? "none" : "currentColor"}
      stroke={outline ? "currentColor" : "none"}
      strokeWidth={outline ? 1.9 : 0}
    >
      {ICONS[network]}
    </svg>
  );
}

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
              <span className="le-social-feeds-name">
                <NetworkIcon network={key} />
                {LABELS[key]}
              </span>
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
              // ONE post, which is what Mike asked for ("he just wants the
              // latest post to be shown on each", via Adam 2026-08-13).
              //
              // It was two, and the second was always sliced: the card caps its
              // content at 460px, two posts run past that, and the crop landed
              // mid-photo so the box ended on a headless torso. Showing one is
              // both the fix and the brief — a second post cannot be cut off if
              // it is not rendered.
              <div className="le-post-list">
                {native[key]!.slice(0, 1).map((p) => (
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
