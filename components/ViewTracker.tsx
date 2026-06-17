"use client";

// Lightweight site-visit counter (Adam, 2026-06). Fires once per
// browser session on a public page → /api/track-view bumps a Firestore
// counter the admin Health tab reads. Deliberately simple (the platform
// has no analytics): counts a "visit" per session, not raw page views,
// and skips admin/captain so it's fan traffic only. Bots that don't run
// JS never trigger it, which filters out most crawlers.

import { useEffect } from "react";
import { usePathname } from "next/navigation";

// Module-level so SPA navigations within one page-load don't re-count.
let firedThisLoad = false;

export function ViewTracker() {
  const pathname = usePathname();
  useEffect(() => {
    if (firedThisLoad) return;
    if (
      !pathname ||
      pathname.startsWith("/admin") ||
      pathname.startsWith("/captain") ||
      pathname.startsWith("/_platform")
    ) {
      return;
    }
    // Once per browser session (survives full reloads within the tab).
    let already = false;
    try {
      already = sessionStorage.getItem("le_visit_counted") === "1";
    } catch {
      /* private mode / storage blocked */
    }
    if (already) {
      firedThisLoad = true;
      return;
    }
    firedThisLoad = true;
    try {
      sessionStorage.setItem("le_visit_counted", "1");
    } catch {
      /* ignore */
    }
    fetch("/api/track-view", { method: "POST", keepalive: true }).catch(
      () => {},
    );
  }, [pathname]);
  return null;
}
