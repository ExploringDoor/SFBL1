// Service worker — push handling + offline cache. ONE SW for both
// jobs: DVSL discovered (softball-site/sw.js:18-21) that two SWs
// competing at scope "/" silently invalidate push subscriptions on
// iOS PWA. So this single file handles raw `push` events, the
// notificationclick deep-link routing, AND the offline cache.
//
// We deliberately do NOT importScripts() the firebase-messaging SDK
// here. DVSL diagnostics found that on iOS PWA, FCM's SW-side SDK
// intercepts the push event and never calls onBackgroundMessage. Raw
// `push` event handling works on every platform. FCM's getToken() on
// the page side just calls pushManager.subscribe on this registration
// — it doesn't require firebase-messaging code IN this SW.
//
// Cache strategy:
//   - Firestore / Firebase API calls  → network-only (live data)
//   - HTML navigations                → network-first, fall back to
//                                        cache, then offline page
//   - Static same-origin assets       → stale-while-revalidate
//                                        (logos, manifests, icons)
//   - Cross-origin                    → stale-while-revalidate (gstatic
//                                        fonts, etc.)
//
// Cache version is bumped manually when ship-breaking SW changes go
// out (skipWaiting + clients.claim ensures next page load picks up
// the new SW without forcing a manual reload).
const CACHE_VERSION = "v1";
const STATIC_CACHE = `static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `runtime-${CACHE_VERSION}`;

// Activate immediately on update. Without these, the SW would wait
// for every tab to close before the new version takes over.
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      // Pre-cache the offline fallback page so it's available even on
      // the user's very first navigation while offline (e.g. they
      // installed the PWA, then immediately lost connectivity).
      try {
        const cache = await caches.open(RUNTIME_CACHE);
        await cache.add("/offline");
      } catch (_) {
        /* best effort — install shouldn't fail if /offline 404s in dev */
      }
      await self.skipWaiting();
    })(),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop old cache versions.
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => !k.endsWith(`-${CACHE_VERSION}`))
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

// Network-only paths — never cache. Match anything that hits Firebase
// or a Next.js API route. Live data must always reach the server.
function isNetworkOnly(url) {
  return (
    url.hostname.includes("firestore.googleapis.com") ||
    url.hostname.includes("identitytoolkit.googleapis.com") ||
    url.hostname.includes("securetoken.googleapis.com") ||
    url.hostname.includes("firebaseapp.com") ||
    url.hostname.endsWith(".firebase.com") ||
    url.pathname.startsWith("/api/")
  );
}

self.addEventListener("fetch", (event) => {
  // Only handle GETs — Firestore writes go through the SDK directly.
  if (event.request.method !== "GET") return;

  let url;
  try {
    url = new URL(event.request.url);
  } catch (_) {
    return;
  }

  if (isNetworkOnly(url)) return; // let the browser handle it

  // HTML navigations — network-first so deploys feel instant.
  if (event.request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(event.request);
          // Stash a copy for offline fallback.
          const cache = await caches.open(RUNTIME_CACHE);
          cache.put(event.request, fresh.clone()).catch(() => {});
          return fresh;
        } catch (_) {
          const cache = await caches.open(RUNTIME_CACHE);
          const cached = await cache.match(event.request);
          if (cached) return cached;
          // Three-tier fallback: dedicated /offline page first
          // (best UX, branded), then homepage, then minimal HTML.
          const offline = await cache.match("/offline");
          if (offline) return offline;
          const home = await cache.match("/");
          if (home) return home;
          return new Response(
            "<h1>You're offline</h1><p>Connect to the internet to load this page.</p>",
            {
              status: 503,
              headers: { "content-type": "text/html; charset=utf-8" },
            },
          );
        }
      })(),
    );
    return;
  }

  // Static + cross-origin assets — stale-while-revalidate.
  event.respondWith(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      const cached = await cache.match(event.request);
      const fetchPromise = fetch(event.request)
        .then((resp) => {
          // Only cache 200 OK responses (no opaque/error caching).
          if (resp && resp.status === 200) {
            cache.put(event.request, resp.clone()).catch(() => {});
          }
          return resp;
        })
        .catch(() => undefined);
      return cached || (await fetchPromise) || Response.error();
    })(),
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_) {}

  // FCM HTTP v1 nests the `data` object at payload.data; some paths
  // wrap it in FCM_MSG. Handle both.
  const d =
    (payload && payload.data) ||
    (payload && payload.FCM_MSG && payload.FCM_MSG.data) ||
    payload ||
    {};

  // Title + body live in the data block — our send-notification endpoint
  // sends data-only payloads (no `notification` block) so FCM's SW SDK
  // doesn't pre-empt this handler on iOS PWA. The `notification`-block
  // fallback is kept defensively in case some external sender forwards
  // pushes through this token.
  const n = (payload && payload.notification) || {};
  const title = n.title || d.title || "League";
  const body = n.body || d.body || "";
  const url = d.url || "/";
  const leagueId = d.leagueId || "";
  const category = d.category || "";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/logos/icon-192.png",
      badge: "/logos/icon-192.png",
      tag: leagueId ? `${leagueId}-${category || "push"}` : "le-push",
      renotify: true,
      data: { url, leagueId, category },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const rawUrl =
    (event.notification.data && event.notification.data.url) || "/";

  // Same-origin clamp. The `url` data field on a push is attacker-
  // controllable; if anyone obtains an FCM token they could craft a
  // push with url: 'https://evil/phish'. DVSL discovered this and
  // pinned the click target to same-origin (sw.js:95-100).
  let target;
  try {
    target = new URL(rawUrl, self.location.origin);
  } catch (_) {
    target = new URL("/", self.location.origin);
  }
  if (target.origin !== self.location.origin) {
    target = new URL("/", self.location.origin);
  }

  event.waitUntil(
    (async () => {
      const allClients = await clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      // Exact match (origin + path + search + hash) → just focus.
      for (const c of allClients) {
        try {
          const cu = new URL(c.url);
          if (
            cu.origin === target.origin &&
            cu.pathname === target.pathname &&
            cu.search === target.search &&
            cu.hash === target.hash
          ) {
            return c.focus();
          }
        } catch (_) {}
      }

      // Same path/search, different hash → message the open tab to
      // route client-side (no full reload).
      for (const c of allClients) {
        try {
          const cu = new URL(c.url);
          if (
            cu.origin === target.origin &&
            cu.pathname === target.pathname &&
            cu.search === target.search
          ) {
            try {
              c.postMessage({ type: "NAVIGATE", url: target.href });
            } catch (_) {}
            return c.focus();
          }
        } catch (_) {}
      }

      // No matching tab → open one.
      if (clients.openWindow) {
        return clients.openWindow(target.href);
      }
    })(),
  );
});
