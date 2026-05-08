"use client";

// Hides the score ticker AND slides the nav up on scroll. DVSL
// pattern: at the top of the page both ticker and nav are visible;
// once the user scrolls past ~10px the ticker slides out and the
// nav re-anchors to the very top of the viewport (no longer offset
// by the ticker height). Coming back to the top restores both.
//
// Both effects are driven by toggling `body.ticker-hidden` — the
// ticker itself listens via `body.ticker-hidden #score-ticker { ... }`
// in Ticker.css, and the nav listens via `body.ticker-hidden .le-nav
// { top: env(safe-area-inset-top) }` in Nav.css.
//
// Implemented as a no-render client component so the markup of
// Ticker / Nav stays server-rendered.

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
        const y = window.scrollY || 0;
        const hidden = y > HIDE_THRESHOLD_PX;
        document.body.classList.toggle("ticker-hidden", hidden);
        ticking = false;
      });
    }
    onScroll(); // initial state
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      document.body.classList.remove("ticker-hidden");
    };
  }, []);
  return null;
}
