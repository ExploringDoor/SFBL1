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
      // The league's ORIGINAL website, recovered + preserved (stories,
      // Players of the Week, franchise histories, championship results,
      // season stat leaderboards). SFBL-only — it's driven by
      // public/{tenantId}/old-site-archive.json, which only SFBL has.
      { label: "Archive", href: "/archive" },
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

/** When the playoff bracket is published (site_config/playoffs.active
 *  === true), lift "Playoffs" out of whichever dropdown it lives in and
 *  promote it to a top-level nav item so fans find it during the
 *  season's highest-traffic month. When !active, returns `links`
 *  unchanged.
 *
 *  Tenant-neutral and pure (returns a new array; no mutation). Must run
 *  BEFORE computeNavLinks so the hoisted item still gets tenant
 *  hide-lists + SFBL-only filtering applied to it.
 *
 *  The promoted item lands immediately after the "/standings" top-level
 *  item; if there's no standings item, it's inserted before "More" (or
 *  appended at the end if there's no "More" either). If no "/playoffs"
 *  child exists anywhere, returns `links` unchanged.
 */
export function hoistPlayoffs(links: NavLink[], active: boolean): NavLink[] {
  if (!active) return links;

  // Find + extract the "/playoffs" child from whichever top-level item
  // holds it, rebuilding each parent without it.
  let playoffs: NavLink | null = null;
  const stripped: NavLink[] = links.map((l) => {
    if (!l.children || l.children.length === 0) return l;
    const idx = l.children.findIndex((c) => c.href === "/playoffs");
    if (idx === -1) return l;
    playoffs = l.children[idx]!;
    return { ...l, children: l.children.filter((_, i) => i !== idx) };
  });
  if (!playoffs) return links;

  // Insert after "/standings"; else before "More"; else at the end.
  const standingsIdx = stripped.findIndex((l) => l.href === "/standings");
  if (standingsIdx !== -1) {
    stripped.splice(standingsIdx + 1, 0, playoffs);
    return stripped;
  }
  const moreIdx = stripped.findIndex((l) => l.label === "More");
  if (moreIdx !== -1) {
    stripped.splice(moreIdx, 0, playoffs);
    return stripped;
  }
  stripped.push(playoffs);
  return stripped;
}

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
): NavLink[] {
  const hide = new Set((hideLabels ?? []).map((s) => s.toLowerCase()));
  function relabel(l: NavLink): NavLink {
    if (l.label === "About SFBL" && tenantShort && tenantShort !== "SFBL") {
      return { ...l, label: `About ${tenantShort}` };
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
            return { ...l, children: kept };
          }
          return relabel(l);
        })
        .filter((l): l is NavLink => l !== null)
    : linksProp.map((l) => {
        if (l.children) {
          return { ...l, children: l.children.map(relabel) };
        }
        return relabel(l);
      });
  const SFBL_ONLY_LABELS = new Set([
    "SFBL",
    "Player of the Week",
    "Captain",
    "Archive",
  ]);
  return tenantShort === "SFBL"
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
}

/** Relabel the "/captain" nav entry (top-level item or a nested child)
 *  to the tenant's manager noun — e.g. "Manager" for SFBL, "Captain"
 *  by default. Pure and config-free: the caller resolves the noun via
 *  captainNoun(config) and passes it in, so this module stays static.
 *  The href / route is never touched. Shared by Nav + PwaTabBar so the
 *  two surfaces keep the same captain label.
 *
 *  MUST run AFTER computeNavLinks — that function's SFBL-only filter
 *  matches the original "Captain" label, so relabeling first would
 *  break the filter. */
export function relabelCaptainLink(
  links: NavLink[],
  captainNounLabel: string,
): NavLink[] {
  const swap = (l: NavLink): NavLink =>
    l.href === "/captain" ? { ...l, label: captainNounLabel } : l;
  return links.map((l) => {
    const top = swap(l);
    if (top.children && top.children.length > 0) {
      return { ...top, children: top.children.map(swap) };
    }
    return top;
  });
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
    "/playoffs": "🥎",
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
    "/tournaments": "🥎",
    "/availability": "🗓️",
  };
  return ICONS[href] ?? "•";
}
