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
  links = DEFAULT_LINKS,
  rightSlot,
}: NavProps) {
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
  }, [pathname]);

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

      <div className={"le-mob-menu" + (mobOpen ? " open" : "")}>
        {links.flatMap((link) => {
          if (link.children && link.children.length > 0) {
            // Render the parent as a dimmed section header followed
            // by its children indented; users on touch devices don't
            // get hover, so a flat list with grouping reads cleaner
            // than a click-to-expand accordion at this scale.
            return [
              <div key={link.label + ":h"} className="le-mob-section">
                {link.label}
              </div>,
              ...link.children.map((child) => (
                <Link
                  key={child.href}
                  href={child.href}
                  className="le-mob-sub"
                  onClick={() => setMobOpen(false)}
                >
                  {child.label}
                </Link>
              )),
            ];
          }
          return [
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMobOpen(false)}
            >
              {link.label}
            </Link>,
          ];
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
