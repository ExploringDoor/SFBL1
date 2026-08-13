"use client";

// Three social feed boxes (Instagram, Facebook, TikTok), rendered by Elfsight.
//
// Mike had two social apps on the old Wix site and asked for the same thing
// here, on the standings page (via Adam, 2026-08-13).
//
// WHY LAZY, AND WHY IT MATTERS HERE. Standings is the page parents refresh on
// a Saturday between games, on cellular, in a car park. It currently loads in
// under a second and three social embeds typically add half a megabyte. So
// Elfsight's platform script is not loaded with the page: an IntersectionObserver
// injects it only once someone actually scrolls near the boxes, and it is
// injected once no matter how many widgets are on screen.
//
// WHY CONFIG-DRIVEN. The widget ids come from the tenant config, so swapping a
// feed, adding a fourth network or moving to another provider is a config edit
// rather than a deploy. With no ids configured this renders NOTHING — which is
// what ships today, before the Elfsight account exists, so the page is never
// left with three empty boxes waiting on someone's subscription.

import { useEffect, useRef, useState } from "react";

export interface SocialWidgets {
  instagram?: string;
  facebook?: string;
  tiktok?: string;
}

const LABELS: Record<keyof SocialWidgets, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
};

export function SocialFeeds({
  widgets,
  heading = "Follow along",
}: {
  widgets?: SocialWidgets | null;
  heading?: string;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [load, setLoad] = useState(false);

  const entries = (
    Object.entries(widgets ?? {}) as [keyof SocialWidgets, string][]
  ).filter(([, id]) => typeof id === "string" && id.trim().length > 0);

  useEffect(() => {
    if (!entries.length || load) return;
    const el = ref.current;
    if (!el) return;
    // No IntersectionObserver (very old browser) — just load it rather than
    // leaving empty boxes.
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
      // Start fetching slightly before they scroll into view so the boxes are
      // filling in by the time they arrive, rather than popping in late.
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [entries.length, load]);

  useEffect(() => {
    if (!load) return;
    const SRC = "https://static.elfsight.com/platform/platform.js";
    // One script for all three widgets, and never twice.
    if (document.querySelector(`script[src="${SRC}"]`)) return;
    const s = document.createElement("script");
    s.src = SRC;
    s.async = true;
    document.body.appendChild(s);
  }, [load]);

  if (!entries.length) return null;

  return (
    <section ref={ref} className="le-social-feeds" aria-label={heading}>
      <h2 className="le-social-feeds-head">{heading}</h2>
      <div className="le-social-feeds-grid">
        {entries.map(([key, id]) => (
          <div key={key} className="le-social-feeds-card">
            <div className="le-social-feeds-label">{LABELS[key]}</div>
            {load ? (
              // Elfsight's own lazy attribute stays on as a second line of
              // defence; the observer above is what stops the SCRIPT loading.
              <div
                className={`elfsight-app-${id}`}
                data-elfsight-app-lazy
              />
            ) : (
              <div className="le-social-feeds-skeleton" aria-hidden="true" />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
