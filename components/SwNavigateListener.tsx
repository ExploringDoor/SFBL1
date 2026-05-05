"use client";

// Service-worker NAVIGATE message listener.
//
// When a user taps a push notification and the PWA is already open, our
// SW (public/firebase-messaging-sw.js) doesn't full-navigate the tab —
// it `postMessage`s `{ type: "NAVIGATE", url: "..." }` so the page can
// route client-side without losing in-page state (composer text, scroll
// position in chat, etc.).
//
// Why this is critical on App Router specifically: Next.js client-side
// routing means setting `window.location.hash` doesn't trigger Next's
// router. Without this listener, tapping a chat push while /captain is
// already open focuses the tab but leaves the URL hash unchanged AND
// the right tab never activates (DVSL v270 — same bug, worse on Next
// because hash-only changes are silently ignored).
//
// Dispatched in app/layout.tsx so EVERY page is covered by one mount.
//
// Behaviour:
//   - Same-origin clamp (the SW also clamps; defence in depth)
//   - Different pathname → `router.push(href)` (full Next nav)
//   - Same pathname, different hash → set hash AND re-fire `hashchange`
//     so `useCaptainTab` / `useProfileTab` / etc. listeners pick it up
//   - Same pathname + same hash → no-op (push tap was redundant)

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function SwNavigateListener() {
  const router = useRouter();

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    function handler(event: MessageEvent) {
      const data = event.data as { type?: string; url?: string } | null;
      if (!data || data.type !== "NAVIGATE" || typeof data.url !== "string") {
        return;
      }
      let target: URL;
      try {
        target = new URL(data.url, window.location.origin);
      } catch {
        return;
      }
      // Defence in depth — SW already clamps, but trust nothing crossing
      // process boundaries.
      if (target.origin !== window.location.origin) return;

      const samePath = target.pathname === window.location.pathname;
      const sameSearch = target.search === window.location.search;

      if (!samePath || !sameSearch) {
        // Full Next route — preserves history, replays middleware, runs
        // the destination's data fetches.
        router.push(target.pathname + target.search + target.hash);
        return;
      }

      // Same path + search; only the hash differs (or nothing differs).
      if (target.hash !== window.location.hash) {
        // Setting `hash` automatically fires `hashchange` per the HTML
        // spec, so listeners (useCaptainTab, useProfileTab, anything
        // hash-driven) see it and re-render. We don't need to dispatch
        // manually unless setting to the SAME hash; in that case the
        // browser doesn't re-fire and we synthesize one as a kick.
        window.location.hash = target.hash;
      } else {
        // No diff at all — push tap was on the page they're already on.
        // Synthesize a hashchange anyway so any tab that wants to scroll-
        // to-top / mark-read can listen and respond.
        window.dispatchEvent(
          new HashChangeEvent("hashchange", {
            oldURL: window.location.href,
            newURL: window.location.href,
          }),
        );
      }
    }

    navigator.serviceWorker.addEventListener("message", handler);
    return () =>
      navigator.serviceWorker.removeEventListener("message", handler);
  }, [router]);

  return null;
}
