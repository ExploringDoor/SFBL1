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

/** Elfsight ids are UUIDs; anything with a slash is a URL. */
const isElfsightId = (v: string) => /^[0-9a-f-]{20,60}$/i.test(v.trim());

export function SocialFeeds({
  widgets,
  links,
  heading = "Follow along",
}: {
  widgets?: SocialWidgets | null;
  /** The league's profile URLs, for the "Follow us" link on each box. Separate
   *  from `widgets` because a widget value is not a profile: TikTok's is an
   *  Elfsight id and Instagram's may be a single post. */
  links?: { instagram?: string; facebook?: string; tiktok?: string } | null;
  heading?: string;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [load, setLoad] = useState(false);

  const entries = (
    Object.entries(widgets ?? {}) as [keyof SocialWidgets, string][]
  ).filter(([, v]) => typeof v === "string" && v.trim().length > 0);

  const needsElfsight = entries.some(
    ([k, v]) => (k === "instagram" || k === "tiktok") && isElfsightId(v),
  );
  const needsTikTokScript = entries.some(
    ([k, v]) => k === "tiktok" && !isElfsightId(v),
  );
  const needsInstagramScript = entries.some(
    ([k, v]) => k === "instagram" && !isElfsightId(v),
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
            {!load ? (
              <div className="le-social-feeds-skeleton" aria-hidden="true" />
            ) : key === "facebook" ? (
              // Facebook's own plugin. adapt_container_width makes it fill the
              // box; a fixed pixel width would overflow on a phone.
              // scrolling="yes" on purpose. Facebook renders a timeline
              // taller than whatever height you ask for, and with scrolling
              // off the plugin simply cuts it off mid-post — which is what
              // Adam's screenshot showed. Letting the iframe scroll means the
              // box shows several posts instead of one clipped one.
              <iframe
                title="Facebook"
                src={
                  "https://www.facebook.com/plugins/page.php?href=" +
                  encodeURIComponent(value) +
                  // hide_cover=true. With the cover shown, the plugin renders
                  // an empty bordered band above the page name and then clips
                  // the name beneath it — Adam screenshotted "Island Fastpitch"
                  // sliced in half twice. Hiding the cover removes that band
                  // and the name sits properly.
                  //
                  // The card already has its own FACEBOOK header with a Follow
                  // us link, so the plugin's header is duplicated chrome; this
                  // keeps it to the smallest it offers.
                  "&tabs=timeline&width=500&height=520&small_header=true" +
                  "&adapt_container_width=true&hide_cover=true&show_facepile=false"
                }
                style={{ border: "none", width: "100%", height: 520 }}
                scrolling="yes"
                frameBorder="0"
                allow="clipboard-write; encrypted-media; picture-in-picture; web-share"
              />
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
