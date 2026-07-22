// Shared nav source of truth — used by BOTH the desktop/mobile top nav
// (components/ui/Nav.tsx) and the installed-app bottom tab bar's "More"
// sheet (components/ui/PwaTabBar.tsx). They used to keep separate hand-
// maintained lists, which drifted (the bottom "More" was missing News,
// POTW, Tournaments, Pay Online, Admin, …). Driving both from this one
// module keeps the web-app "More" identical to the desktop nav. (Adam,
// 2026-05-18.)

export interface NavLink {
  label: string;
  href: string;
  /** When set, this nav item renders as a dropdown menu rather than
   *  a direct link. The `href` is ignored on desktop (the parent
   *  becomes a hover-toggle); on mobile the parent renders as a
   *  section header above the children. */
  children?: NavLink[];
}

export const DEFAULT_LINKS: NavLink[] = [
  { label: "Home", href: "/" },
  // League-info dropdown — between Home and Scores (Nelson, 2026-05-18).
  // Labeled "SFBL" for the SFBL tenant; the Nav relabel() swaps it to
  // the tenant short ("LBDC" etc.) for others. Groups the three
  // league-identity pages out of the catch-all "More" list.
  {
    label: "SFBL",
    href: "#",
    children: [
      { label: "Info", href: "/sfbl-info" },
      { label: "Rules", href: "/rules" },
      { label: "Fields", href: "/fields" },
    ],
  },
  { label: "Scores", href: "/scores" },
  { label: "Schedule", href: "/schedule" },
  { label: "Standings", href: "/standings" },
  { label: "Stats", href: "/players" },
  { label: "Teams", href: "/teams" },
  // Dedicated Register dropdown so signing up isn't buried in "More"
  // (Adam, 2026-05-18). Generic — nav.hide still controls which
  // children show per tenant (LBDC hides Team Registration).
  {
    label: "Register",
    href: "#",
    children: [
      { label: "Player Registration", href: "/player-registration" },
      { label: "Team Registration", href: "/team-registration" },
      { label: "Team Waiver", href: "/team-waiver-form" },
    ],
  },
  {
    label: "More",
    href: "#",
    children: [
      { label: "News", href: "/content/news" },
      { label: "Photos", href: "/photos" },
      { label: "Team Stats", href: "/leaders" },
      { label: "Player of the Week", href: "/player-of-the-week" },
      { label: "Playoffs", href: "/playoffs" },
      { label: "Tournaments", href: "/tournaments" },
      { label: "Availability", href: "/availability" },
      { label: "History", href: "/history" },
      { label: "Umpire Evaluation", href: "/umpire-evaluation-form" },
      { label: "Pay Online", href: "/pay-online" },
      { label: "Sponsors", href: "/content/sponsors" },
      { label: "Store", href: "/content/store" },
      { label: "Contact", href: "/content/contact" },
      // Captain portal entry — SFBL-only (filtered out for other
      // tenants below). SFBL dropped the top-right Captain/Player
      // chooser, so this is how managers reach their login (Adam,
      // 2026-06). /captain shows the team-password gate.
      { label: "Captain", href: "/captain" },
      // Admin moved here from the header pill (Adam, 2026-05-18) — it
      // just opens the admin password gate, so it's a discreet entry
      // point rather than a prominent button.
      { label: "Admin", href: "/admin" },
    ],
  },
];

/** Apply per-tenant nav customization to a link list:
 *   • hide-list (case-insensitive label match, top-level + children)
 *   • legacy "About SFBL" → "About <tenantShort>" relabel
 *   • SFBL-only items ("SFBL" league-info dropdown + "Player of the
 *     Week") drop entirely for non-SFBL tenants.
 * Pure function so the top nav and the bottom-tab "More" stay in sync.
 */
export function computeNavLinks(
  linksProp: NavLink[],
  tenantShort: string,
  hideLabels?: string[],
  addLinks?: NavLink[],
): NavLink[] {
  const hide = new Set((hideLabels ?? []).map((s) => s.toLowerCase()));
  function relabel(l: NavLink): NavLink {
    if (l.label === "About SFBL" && tenantShort && tenantShort !== "SFBL") {
      return { ...l, label: `About ${tenantShort}` };
    }
    // The league-identity dropdown (Info / Rules / Fields) is labelled "SFBL"
    // in DEFAULT_LINKS. It MUST be renamed for other tenants, because
    // SFBL_ONLY_LABELS below deletes anything still called "SFBL" — which was
    // silently taking Rules and Fields down with it for every non-SFBL tenant.
    if (l.label === "SFBL" && tenantShort && tenantShort !== "SFBL") {
      return { ...l, label: tenantShort };
    }
    return l;
  }
  const links: NavLink[] = hide.size
    ? linksProp
        .map((l) => {
          if (hide.has(l.label.toLowerCase())) return null;
          if (l.children && l.children.length > 0) {
            const kept = l.children
              .filter((c) => !hide.has(c.label.toLowerCase()))
              .map(relabel);
            if (kept.length === 0) return null;
            // relabel the PARENT too, not just its children.
            return relabel({ ...l, children: kept });
          }
          return relabel(l);
        })
        .filter((l): l is NavLink => l !== null)
    : linksProp.map((l) => {
        if (l.children) {
          return relabel({ ...l, children: l.children.map(relabel) });
        }
        return relabel(l);
      });
  const SFBL_ONLY_LABELS = new Set(["SFBL", "Player of the Week", "Captain"]);
  const result =
    tenantShort === "SFBL"
      ? links
      : links
          .filter((l) => !SFBL_ONLY_LABELS.has(l.label))
          .map((l) =>
            l.children
              ? {
                  ...l,
                  children: l.children.filter(
                    (c) => !SFBL_ONLY_LABELS.has(c.label),
                  ),
                }
              : l,
          )
          .filter((l) => !l.children || l.children.length > 0);

  // Tenant-added links (config.nav.add) — insert before the first
  // dropdown (Register/More) so they read as primary nav items.
  if (addLinks && addLinks.length) {
    const idx = result.findIndex((l) => l.children && l.children.length > 0);
    const at = idx === -1 ? result.length : idx;
    return [...result.slice(0, at), ...addLinks, ...result.slice(at)];
  }
  return result;
}

/** Emoji icon for a nav destination — used by the mobile menu tiles
 *  and the bottom-tab "More" sheet. */
export function iconFor(href: string): string {
  const ICONS: Record<string, string> = {
    "/": "🏠",
    "/scores": "⚾",
    "/schedule": "📅",
    "/standings": "🏆",
    "/players": "📊",
    "/teams": "👥",
    "/rules": "📜",
    "/content/news": "📰",
    "/photos": "📷",
    "/leaders": "🥇",
    "/player-of-the-week": "🌟",
    "/playoffs": "⚾",
    "/history": "📚",
    "/fields": "📍",
    "/sfbl-info": "ℹ️",
    "/player-registration": "🧢",
    "/team-registration": "🏟️",
    "/team-waiver-form": "✍️",
    "/umpire-evaluation-form": "👨‍⚖️",
    "/pay-online": "💳",
    "/content/pay-online": "💳",
    "/content/sponsors": "🤝",
    "/content/store": "🛒",
    "/content/contact": "✉️",
    "/profile": "🙋",
    "/captain": "⚾",
    "/admin": "◉",
    "/tournaments": "🏆",
    "/availability": "🗓️",
    "/eligibility": "🛡️",
    "/power-rankings": "📈",
  };
  return ICONS[href] ?? "•";
}
