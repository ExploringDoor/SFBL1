"use client";

// Desktop input polish for the ticker:
//
//   1. Mouse-wheel → horizontal scroll. Without this, mouse users
//      can't pan the ticker because wheels only emit deltaY.
//   2. Click-vs-drag hysteresis. The ticker is a horizontal scroller
//      with clickable game tiles inside it. Letting the user grab
//      and drag the bar conflicts with the click handler — without
//      a movement threshold, every drag also fires a navigation.
//
// Implemented as a no-render enhancer (separate from the server-
// rendered Ticker) so the ticker keeps its zero-JS cost on first
// paint. We hook handlers in useEffect once mounted.

import { useEffect } from "react";

const DRAG_THRESHOLD_PX = 5;

export function TickerInputEnhancer() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sc = document.querySelector<HTMLElement>(".st-scroll");
    if (!sc) return;

    // ── Mouse-wheel → horizontal scroll ──────────────────────────
    function onWheel(e: WheelEvent) {
      // Only convert vertical-dominant wheels. Horizontal wheel
      // (Mac trackpad two-finger pan) is left untouched so it
      // scrolls the ticker as expected without us doubling it up.
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      if (sc!.scrollWidth <= sc!.clientWidth) return; // nothing to scroll
      e.preventDefault();
      sc!.scrollLeft += e.deltaY;
    }

    // ── Click-vs-drag hysteresis ──────────────────────────────────
    let downX = 0;
    let dragging = false;
    let suppressClick = false;

    function onDown(e: MouseEvent) {
      downX = e.clientX;
      dragging = false;
    }
    function onMove(e: MouseEvent) {
      if (!e.buttons) return; // mouse not held down
      if (!dragging && Math.abs(e.clientX - downX) > DRAG_THRESHOLD_PX) {
        dragging = true;
        suppressClick = true;
      }
      if (dragging) {
        sc!.scrollLeft -= e.movementX;
      }
    }
    function onClick(e: MouseEvent) {
      if (!suppressClick) return;
      e.stopPropagation();
      e.preventDefault();
      suppressClick = false;
    }

    sc.addEventListener("wheel", onWheel, { passive: false });
    sc.addEventListener("mousedown", onDown);
    sc.addEventListener("mousemove", onMove);
    // Capture phase so we beat the inner <Link> click handler.
    sc.addEventListener("click", onClick, true);

    return () => {
      sc.removeEventListener("wheel", onWheel);
      sc.removeEventListener("mousedown", onDown);
      sc.removeEventListener("mousemove", onMove);
      sc.removeEventListener("click", onClick, true);
    };
  }, []);

  return null;
}
