"use client";

// Top nav — verbatim port of DVSL `<nav class="nav">`
// (~/Desktop/softball-site/index.html lines 2972–3022).
//
// Sits fixed below the ticker. Three regions: brand on the left,
// horizontal link list in the middle, action slot (profile / sign-in)
// on the right. Mobile: links collapse behind a hamburger that opens
// a fullscreen sheet.
//
// Active link is detected via usePathname — must be a Client Component
// for that hook.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import "./Nav.css";

export interface NavLink {
  label: string;
  href: string;
  /** When set, this nav item renders as a dropdown menu rather than
   *  a direct link. The `href` is ignored on desktop (the parent
   *  becomes a hover-toggle); on mobile the parent renders as a
   *  section header above the children. */
  children?: NavLink[];
}

export interface NavProps {
  /** Tenant short name shown as the brand (e.g. "DVSL", "SFBL"). */
  tenantShort: string;
  /** Optional tenant logo PNG (sits next to the short name). */
  logoUrl?: string | null;
  /** Nav link list. Defaults to LeagueEngine standard pages. */
  links?: NavLink[];
  /** Lowercased labels to hide from the rendered nav. Used for
   *  per-tenant customization (e.g. LBDC hides "news"). Matches
   *  both top-level links and More-dropdown children. */
  hideLabels?: string[];
  /** Right-hand slot — typically the ProfileButton. Falls back to a
   *  "Sign in" link when omitted. */
  rightSlot?: React.ReactNode;
}

const DEFAULT_LINKS: NavLink[] = [
  { label: "Home", href: "/" },
  { label: "Scores", href: "/scores" },
  { label: "Schedule", href: "/schedule" },
  { label: "Standings", href: "/standings" },
  { label: "Stats", href: "/players" },
  { label: "Teams", href: "/teams" },
  {
    label: "More",
    href: "#",
    children: [
      { label: "Rules", href: "/rules" },
      { label: "News", href: "/content/news" },
      { label: "Photos", href: "/photos" },
      { label: "Leaders", href: "/leaders" },
      { label: "Playoffs", href: "/playoffs" },
      { label: "Tournaments", href: "/tournaments" },
      { label: "Availability", href: "/availability" },
      { label: "History", href: "/history" },
      { label: "Fields", href: "/fields" },
      { label: "About SFBL", href: "/sfbl-info" },
      { label: "Player Registration", href: "/player-registration" },
      { label: "Team Registration", href: "/team-registration" },
      { label: "Team Waiver", href: "/team-waiver-form" },
      { label: "Umpire Evaluation", href: "/umpire-evaluation-form" },
      { label: "Pay Online", href: "/content/pay-online" },
      { label: "Sponsors", href: "/content/sponsors" },
      { label: "Store", href: "/content/store" },
      { label: "Contact", href: "/content/contact" },
    ],
  },
];

export function Nav({
  tenantShort,
  logoUrl,
  links: linksProp = DEFAULT_LINKS,
  hideLabels,
  rightSlot,
}: NavProps) {
  // Apply per-tenant hide-list. Filters at both levels: top-level
  // items, and children inside any dropdown. A dropdown with all
  // children hidden drops itself.
  const hide = new Set((hideLabels ?? []).map((s) => s.toLowerCase()));
  const links: NavLink[] = hide.size
    ? linksProp
        .map((l) => {
          if (hide.has(l.label.toLowerCase())) return null;
          if (l.children && l.children.length > 0) {
            const kept = l.children.filter(
              (c) => !hide.has(c.label.toLowerCase()),
            );
            if (kept.length === 0) return null;
            return { ...l, children: kept };
          }
          return l;
        })
        .filter((l): l is NavLink => l !== null)
    : linksProp;
  const pathname = usePathname();
  const [mobOpen, setMobOpen] = useState(false);
  // Track which dropdown (by label) is open. JS-controlled rather than
  // pure CSS :hover so that clicking a child link can close the menu
  // before/during navigation — :hover persists while the cursor sits
  // over the area, which used to leave the menu hanging open on the
  // next page.
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  // Any route change closes whatever dropdown was open. Belt-and-
  // suspenders alongside the click handler: handles keyboard nav,
  // middle-click, and any case where focus state isn't where we
  // expect it.
  useEffect(() => {
    setOpenDropdown(null);
    setMobOpen(false);
  }, [pathname]);

  // Scroll-lock the body when the mobile menu is open. Without this
  // the page behind the menu stays scrollable — pulling the menu
  // along on touch and breaking the modal feel. Restore on close.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (mobOpen) {
      document.body.classList.add("le-mob-menu-open");
    } else {
      document.body.classList.remove("le-mob-menu-open");
    }
    return () => {
      document.body.classList.remove("le-mob-menu-open");
    };
  }, [mobOpen]);

  return (
    <>
      <nav className="le-nav">
        {/* When the tenant has a logo, show the logo alone — the
         *  banner already contains the league wordmark, so doubling
         *  it with the tenantShort text looks redundant. Falls back
         *  to text-only branding when no logo is configured. */}
        <Link
          href="/"
          className={"le-nav-brand" + (logoUrl ? " has-logo" : "")}
          onClick={() => setMobOpen(false)}
          aria-label={tenantShort}
        >
          {logoUrl ? (
            <img src={logoUrl} alt={tenantShort} />
          ) : (
            <span>{tenantShort}</span>
          )}
        </Link>

        <ul className="le-nav-links">
          {links.map((link) => {
            if (link.children && link.children.length > 0) {
              const childActive = link.children.some((c) =>
                isActive(pathname, c.href),
              );
              const isOpen = openDropdown === link.label;
              return (
                <li
                  key={link.label}
                  className={
                    "le-nav-dropdown" +
                    (childActive ? " active" : "") +
                    (isOpen ? " open" : "")
                  }
                  onMouseEnter={() => setOpenDropdown(link.label)}
                  onMouseLeave={() => setOpenDropdown(null)}
                  onFocus={() => setOpenDropdown(link.label)}
                  onBlur={(e) => {
                    // Only close if focus is leaving the entire dropdown,
                    // not just bouncing between trigger and child link.
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                      setOpenDropdown(null);
                    }
                  }}
                >
                  <button
                    type="button"
                    className="le-nav-dropdown-trigger"
                    aria-haspopup="menu"
                    aria-expanded={isOpen}
                    onClick={() =>
                      setOpenDropdown((cur) =>
                        cur === link.label ? null : link.label,
                      )
                    }
                  >
                    {link.label}
                  </button>
                  <ul className="le-nav-dropdown-menu">
                    {link.children.map((child) => (
                      <li
                        key={child.href}
                        className={
                          isActive(pathname, child.href) ? "active" : ""
                        }
                      >
                        <Link
                          href={child.href}
                          onClick={() => setOpenDropdown(null)}
                        >
                          {child.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            }
            return (
              <li
                key={link.href}
                className={isActive(pathname, link.href) ? "active" : ""}
              >
                <Link href={link.href}>{link.label}</Link>
              </li>
            );
          })}
        </ul>

        <div className="le-nav-right">
          {rightSlot}
          <button
            type="button"
            aria-label="Toggle menu"
            aria-expanded={mobOpen}
            className={"le-hamburger" + (mobOpen ? " open" : "")}
            onClick={() => setMobOpen((v) => !v)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
      </nav>

      {/* Backdrop sits between the page content and the menu sheet
          when open. Tap-to-close, plus a subtle dim. */}
      <div
        className={"le-mob-backdrop" + (mobOpen ? " open" : "")}
        onClick={() => setMobOpen(false)}
        aria-hidden={!mobOpen}
      />

      <div className={"le-mob-menu" + (mobOpen ? " open" : "")}>
        {/* Top-level links render as a 2-column grid of icon+label
            cards (DVSL pattern). Sub-pages (children of "More") get
            their own grid below a section header. The flat 26px
            uppercase line list it replaced was harder to scan and
            felt out of proportion to phone screens. */}
        {links.map((link) => {
          if (link.children && link.children.length > 0) {
            return (
              <section key={link.label} className="le-mob-section-block">
                <div className="le-mob-section">{link.label}</div>
                <div className="le-mob-grid">
                  {link.children.map((child) => (
                    <Link
                      key={child.href}
                      href={child.href}
                      className="le-mob-tile"
                      onClick={() => setMobOpen(false)}
                    >
                      <span className="le-mob-tile-icon" aria-hidden>
                        {iconFor(child.href)}
                      </span>
                      <span className="le-mob-tile-label">
                        {child.label}
                      </span>
                    </Link>
                  ))}
                </div>
              </section>
            );
          }
          // Top-level link with no children — render as a single
          // tile inside its own 1-card row so spacing matches the
          // sectioned grids above.
          return (
            <div
              key={link.href}
              className="le-mob-grid le-mob-grid-top"
            >
              <Link
                href={link.href}
                className="le-mob-tile"
                onClick={() => setMobOpen(false)}
              >
                <span className="le-mob-tile-icon" aria-hidden>
                  {iconFor(link.href)}
                </span>
                <span className="le-mob-tile-label">{link.label}</span>
              </Link>
            </div>
          );
        })}
      </div>
    </>
  );
}

function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

// Pick a recognizable emoji icon for each known route. Mirrors the
// PwaTabBar More sheet so the two menus feel like one design system.
// Anything unmapped falls back to a neutral dot — better than a
// missing icon shifting the layout.
function iconFor(href: string): string {
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
    "/playoffs": "🥎",
    "/history": "📚",
    "/fields": "📍",
    "/sfbl-info": "ℹ️",
    "/player-registration": "🧢",
    "/team-registration": "🏟️",
    "/team-waiver-form": "✍️",
    "/umpire-evaluation-form": "👨‍⚖️",
    "/content/pay-online": "💳",
    "/content/sponsors": "🤝",
    "/content/store": "🛒",
    "/content/contact": "✉️",
    "/profile": "🙋",
  };
  return ICONS[href] ?? "•";
}
