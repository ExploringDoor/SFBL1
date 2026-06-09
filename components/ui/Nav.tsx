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
import { DEFAULT_LINKS, computeNavLinks, iconFor } from "./nav-links";
import type { NavLink } from "./nav-links";
import "./Nav.css";

// NavLink + DEFAULT_LINKS + computeNavLinks + iconFor moved to
// ./nav-links so the bottom-tab "More" sheet shares them (2026-05-18).
// Re-export the type so existing `import { NavLink } from "./Nav"`
// sites keep working.
export type { NavLink };

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

// DEFAULT_LINKS now lives in ./nav-links (shared with the bottom-tab
// "More" sheet). Imported above.

export function Nav({
  tenantShort,
  logoUrl,
  links: linksProp = DEFAULT_LINKS,
  hideLabels,
  rightSlot,
}: NavProps) {
  // Per-tenant nav customization (hide-list, "About <tenant>" relabel,
  // SFBL-only items) — shared with the bottom-tab "More" sheet via
  // computeNavLinks so the two never drift.
  const navLinks: NavLink[] = computeNavLinks(
    linksProp,
    tenantShort,
    hideLabels,
  );
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
          className={
            "le-nav-brand" +
            (logoUrl ? " has-logo" : "") +
            // SFBL brand text in Arial Rounded, bold + italic
            // (Nelson, 2026-05-18). Scoped so other tenants keep their
            // default brand font.
            (tenantShort === "SFBL" ? " le-nav-brand--rounded" : "")
          }
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
          {navLinks.map((link) => {
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
        {navLinks.map((link) => {
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

// iconFor moved to ./nav-links (shared with PwaTabBar). Imported above.
