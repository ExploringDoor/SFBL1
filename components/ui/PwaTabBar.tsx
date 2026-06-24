"use client";

// PWA bottom-nav tab bar — DVSL pattern. Only renders when the page
// is running in standalone display-mode (i.e. installed to the home
// screen). On regular browser tabs it's hidden so we don't take up
// vertical real estate that the user already has the address bar
// for.
//
// Five slots: Home, Scores, Schedule, Standings, More. The "More"
// slot opens a modal sheet built from the SAME nav source as the
// desktop nav (./nav-links), so it lists exactly what desktop's nav
// does minus the four visible tabs — identical, and impossible to
// drift. In the installed app this sheet is the ONLY nav (the top
// hamburger is hidden via body.has-tabbar), per Adam 2026-05-18.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { DEFAULT_LINKS, computeNavLinks, iconFor } from "./nav-links";
import type { NavLink } from "./nav-links";
import "./PwaTabBar.css";

interface Slot {
  id: string;
  label: string;
  icon: string;
  href?: string;
  more?: boolean;
}

const SLOTS: Slot[] = [
  { id: "home", label: "Home", icon: "🏠", href: "/" },
  { id: "scores", label: "Scores", icon: "⚾", href: "/scores" },
  { id: "schedule", label: "Schedule", icon: "📅", href: "/schedule" },
  { id: "standings", label: "Standings", icon: "🏆", href: "/standings" },
  { id: "more", label: "More", icon: "⋯", more: true },
];

// The "More" sheet is built from the SAME nav source as the desktop nav
// (computeNavLinks, below) so it stays identical to it — no more
// hand-maintained list drifting out of sync. The four SLOTS above
// (Home/Scores/Schedule/Standings) are the visible tabs; every other
// nav destination lands in this sheet. (Adam, 2026-05-18.)

export interface PwaTabBarProps {
  /** Labels to hide from the More sheet — same shape Nav uses. */
  hideLabels?: string[];
  /** Tenant short name — drives "About <abbrev>" relabel. */
  tenantShort?: string;
  /** Extra top-level links to add (per-tenant config.nav.add). */
  addLinks?: NavLink[];
}

export function PwaTabBar({
  hideLabels,
  tenantShort,
  addLinks,
}: PwaTabBarProps = {}) {
  const pathname = usePathname() ?? "/";
  const [isStandalone, setIsStandalone] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  // Build the "More" sheet from the same nav source as the desktop nav,
  // with the same per-tenant filtering, so the web-app "More" is
  // identical to desktop. The four visible tabs (Home/Scores/Schedule/
  // Standings) are excluded so they don't repeat. Remaining single
  // links collect under "Browse"; each dropdown becomes its own section
  // (SFBL, Register, More) — same grouping as the desktop nav.
  const navLinks = computeNavLinks(
    DEFAULT_LINKS,
    tenantShort ?? "",
    hideLabels,
    addLinks,
  );
  const bottomHrefs = new Set(
    SLOTS.map((s) => s.href).filter((h): h is string => !!h),
  );
  const sheetSections: { title: string; items: NavLink[] }[] = [];
  let singles: NavLink[] = [];
  for (const link of navLinks) {
    if (link.children && link.children.length > 0) {
      if (singles.length) {
        sheetSections.push({ title: "Browse", items: singles });
        singles = [];
      }
      sheetSections.push({ title: link.label, items: link.children });
    } else if (!bottomHrefs.has(link.href)) {
      singles.push(link);
    }
  }
  if (singles.length) sheetSections.push({ title: "Browse", items: singles });

  // Detect standalone PWA mode — the manifest's display:standalone
  // makes the OS launch us in a separate window without a browser
  // address bar. matchMedia is the cross-browser way to check;
  // navigator.standalone is iOS-only legacy.
  //
  // Side-effect: toggle `body.has-tabbar` so CSS can reserve bottom
  // padding for the fixed bar. Without it, the last few pixels of
  // every page sit hidden behind the bar.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(display-mode: standalone)");
    const update = () => {
      const standalone =
        mq.matches ||
        // @ts-expect-error — non-standard iOS
        window.navigator.standalone === true;
      setIsStandalone(standalone);
      document.body.classList.toggle("has-tabbar", standalone);
    };
    update();
    mq.addEventListener?.("change", update);
    return () => {
      mq.removeEventListener?.("change", update);
      document.body.classList.remove("has-tabbar");
    };
  }, []);

  // Close the More sheet whenever the route changes.
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  // Body scroll-lock while the More sheet is open — without this,
  // panning a sheet that's already at its scroll edge bubbles up
  // and scrolls the page behind it (Adam: "scrolls the website in
  // background"). Same trick as the hamburger menu in Nav.tsx.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (moreOpen) {
      document.body.classList.add("le-tabbar-sheet-open");
    } else {
      document.body.classList.remove("le-tabbar-sheet-open");
    }
    return () => {
      document.body.classList.remove("le-tabbar-sheet-open");
    };
  }, [moreOpen]);

  if (!isStandalone) return null;

  return (
    <>
      <nav id="le-tabbar" aria-label="Primary navigation">
        {SLOTS.map((s) => {
          const active = !s.more && s.href ? isActive(pathname, s.href) : false;
          if (s.more) {
            return (
              <button
                key={s.id}
                type="button"
                className={"le-tab" + (moreOpen ? " active" : "")}
                onClick={() => setMoreOpen((v) => !v)}
                aria-haspopup="dialog"
                aria-expanded={moreOpen}
              >
                <span className="le-tab-icon" aria-hidden>
                  {s.icon}
                </span>
                <span className="le-tab-label">{s.label}</span>
              </button>
            );
          }
          return (
            <Link
              key={s.id}
              href={s.href!}
              className={"le-tab" + (active ? " active" : "")}
            >
              <span className="le-tab-icon" aria-hidden>
                {s.icon}
              </span>
              <span className="le-tab-label">{s.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* More sheet — bottom-anchored modal listing secondary
          destinations. Backdrop closes on tap; nav links close on
          route change via the effect above. */}
      <div
        className={"le-tabbar-backdrop" + (moreOpen ? " open" : "")}
        onClick={() => setMoreOpen(false)}
        aria-hidden={!moreOpen}
      />
      <aside
        className={"le-tabbar-sheet" + (moreOpen ? " open" : "")}
        role="dialog"
        aria-label="More navigation"
        aria-hidden={!moreOpen}
      >
        <div className="le-tabbar-sheet-grab" />
        <div className="le-tabbar-sheet-body">
          {sheetSections.map((section) => (
            <div key={section.title} className="le-tabbar-sheet-section">
              <h3>{section.title}</h3>
              <ul>
                {section.items.map((it) => (
                  <li key={it.href}>
                    <Link href={it.href}>
                      <span className="le-tabbar-sheet-icon" aria-hidden>
                        {iconFor(it.href)}
                      </span>
                      {it.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="le-tabbar-sheet-close"
          onClick={() => setMoreOpen(false)}
        >
          Close
        </button>
      </aside>
    </>
  );
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}
