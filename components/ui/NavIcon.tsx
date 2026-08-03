// SVG icons for nav destinations — replaces the emoji map that iconFor() used
// to return. House style is SVG icons, never emoji: emoji render differently on
// every platform (and at different weights/sizes), which made the mobile menu
// tiles and the installed-app "More" sheet look inconsistent.
//
// Keyed by href so it drops straight into the places that called iconFor().
// Anything unknown falls back to a neutral dot, matching the old "•".
//
// 24x24 stroke icons, currentColor, so they inherit the tile's colour and any
// hover state without extra CSS.

const PATHS: Record<string, string> = {
  "/": "M3 11.5 12 4l9 7.5M5.5 10v9.5h13V10M9.5 19.5v-6h5v6",
  "/scores": "M12 2a10 10 0 100 20 10 10 0 000-20zM4.5 7.5c2.6.6 4.6 2.6 5.2 5.2M19.5 7.5c-2.6.6-4.6 2.6-5.2 5.2M7.5 19.5c.6-2.6 2.6-4.6 5.2-5.2",
  "/schedule": "M4 8h16M8 3v4M16 3v4M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z",
  "/standings": "M7 4h10v5a5 5 0 01-10 0V4zM7 6H4v2a3 3 0 003 3M17 6h3v2a3 3 0 01-3 3M10 19h4M12 14v5M9 21h6",
  "/players": "M4 20V10M10 20V4M16 20v-7M22 20H2",
  "/teams": "M8 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM2 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M17 11.5a3 3 0 100-6 3 3 0 000 6zM16 14.6c2.9-.4 6 1.4 6 5.4",
  "/rules": "M6 3h9l4 4v14a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1zM14 3v5h5M9 13h6M9 17h4",
  "/content/news": "M4 5a2 2 0 012-2h9v18H6a2 2 0 01-2-2V5zM15 8h3a2 2 0 012 2v9a2 2 0 01-2 2M8 7h4M8 11h4M8 15h4",
  "/photos": "M4 7h3l1.5-2h7L17 7h3a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V8a1 1 0 011-1zM12 16.5a4 4 0 100-8 4 4 0 000 8z",
  "/leaders": "M12 3l2.7 5.7 6.3.8-4.6 4.3 1.2 6.2L12 17l-5.6 3 1.2-6.2L3 9.5l6.3-.8L12 3z",
  "/player-of-the-week": "M12 3l2.7 5.7 6.3.8-4.6 4.3 1.2 6.2L12 17l-5.6 3 1.2-6.2L3 9.5l6.3-.8L12 3z",
  "/playoffs": "M6 4v6a6 6 0 0012 0V4M4 20h16M9 20v-3h6v3",
  "/history": "M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2V5zM19 17H6M9 7h7",
  "/fields": "M12 21s7-5.5 7-11a7 7 0 10-14 0c0 5.5 7 11 7 11zM12 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z",
  "/sfbl-info": "M12 22a10 10 0 100-20 10 10 0 000 20zM12 10v7M12 7.2v.2",
  "/player-registration": "M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5",
  "/team-registration": "M4 10c0-3.3 3.6-6 8-6s8 2.7 8 6M3 10h18v3a9 9 0 01-18 0v-3zM12 19v3M8 22h8",
  "/team-waiver-form": "M6 3h8l4 4v14H6V3zM14 3v5h4M8 17l3-1 7-7-2-2-7 7-1 3z",
  "/umpire-evaluation-form": "M12 4v16M6 8l-3 6h6l-3-6zM18 8l-3 6h6l-3-6zM5 20h14M9 4h6",
  "/pay-online": "M3 8a1 1 0 011-1h16a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V8zM3 11h18M7 15h3",
  "/content/pay-online": "M3 8a1 1 0 011-1h16a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V8zM3 11h18M7 15h3",
  "/content/sponsors": "M8 13l-3-3a3 3 0 014-4l3 3 3-3a3 3 0 014 4l-3 3M5 15l4 4M15 19l4-4M9 19h6",
  "/content/store": "M5 7h14l-1 12H6L5 7zM9 7V5a3 3 0 016 0v2",
  "/content/contact": "M3 6a1 1 0 011-1h16a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V6zM3.5 6.5l8.5 7 8.5-7",
  "/profile": "M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5",
  "/captain": "M12 3l7 3v6c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9V6l7-3zM9.5 12l2 2 3.5-4",
  "/admin": "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-2.7 1.1V21a2 2 0 11-4 0v-.1A1.6 1.6 0 007.5 19.4l-.1.1a2 2 0 11-2.8-2.8l.1-.1A1.6 1.6 0 003 15H3a2 2 0 010-4h.1A1.6 1.6 0 004.6 8.5l-.1-.1a2 2 0 112.8-2.8l.1.1A1.6 1.6 0 0010 4.6V3a2 2 0 014 0v.1a1.6 1.6 0 002.7 1.1l.1-.1a2 2 0 112.8 2.8l-.1.1A1.6 1.6 0 0021 10h.1a2 2 0 010 4H21a1.6 1.6 0 00-1.6 1z",
  "/tournaments": "M7 4h10v5a5 5 0 01-10 0V4zM7 6H4v2a3 3 0 003 3M17 6h3v2a3 3 0 01-3 3M10 19h4M12 14v5M9 21h6",
  "/availability": "M4 8h16M8 3v4M16 3v4M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1zM9.5 14.5l1.8 1.8 3.5-3.5",
  "/eligibility": "M12 3l8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6l8-3zM9 12l2 2 4-4",
  "/power-rankings": "M3 17l5-5 3.5 3.5L20 7M20 7h-5M20 7v5",
  // Island's Leagues page. Without an entry it drew the neutral circle, which
  // is fine buried in a dropdown but not for a pinned shortcut.
  "/content/leagues": "M4 6h16M4 12h16M4 18h9M18 15v6M15 18h6",
};

/** Neutral fallback (replaces the old "•"). */
const FALLBACK = "M12 16a4 4 0 100-8 4 4 0 000 8z";

export function NavIcon({ href, size = 22 }: { href: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      style={{ display: "block" }}
    >
      <path d={PATHS[href] ?? FALLBACK} />
    </svg>
  );
}
