"use client";

// Hides the score ticker on scroll. DVSL pattern: visible at the
// top of the page, slides out of view once the user scrolls past
// ~10px. Comes back when they scroll back to the top.
//
// Implemented as a tiny no-render client component rather than
// folding the logic into Ticker.tsx so the ticker itself can stay
// a server component (its games payload is fetched server-side
// and we don't need to hydrate the markup).
//
// CSS lives in Ticker.css — the `.scroll-hidden` class on
// #score-ticker handles the slide animation + fade.

import { useEffect } from "react";

const HIDE_THRESHOLD_PX = 10;

export function TickerScrollHide() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    let ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const ticker = document.getElementById("score-ticker");
        if (ticker) {
          const y = window.scrollY || 0;
          ticker.classList.toggle("scroll-hidden", y > HIDE_THRESHOLD_PX);
        }
        ticking = false;
      });
    }
    onScroll(); // initial state
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return null;
}
