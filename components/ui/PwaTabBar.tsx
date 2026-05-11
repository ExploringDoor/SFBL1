"use client";

// PWA bottom-nav tab bar — DVSL pattern. Only renders when the page
// is running in standalone display-mode (i.e. installed to the home
// screen). On regular browser tabs it's hidden so we don't take up
// vertical real estate that the user already has the address bar
// for.
//
// Five slots: Home, Scores, Schedule, Standings, More. The "More"
// slot opens a modal sheet listing every secondary destination
// (Teams, Players, History, Fields, About, Registration forms,
// Photos, Rules). Mirrors how DVSL handles overflow without
// cramming everything into the visible bar.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
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

interface MoreItem {
  icon: string;
  label: string;
  href: string;
}

interface MoreSection {
  title: string;
  items: MoreItem[];
}

const MORE_SECTIONS: MoreSection[] = [
  {
    title: "Browse",
    items: [
      { icon: "👥", label: "Teams", href: "/teams" },
      { icon: "👤", label: "Players", href: "/players" },
      { icon: "📊", label: "Stat Leaders", href: "/leaders" },
      { icon: "📜", label: "History", href: "/history" },
      { icon: "📷", label: "Photos", href: "/photos" },
      { icon: "🥎", label: "Playoffs", href: "/playoffs" },
    ],
  },
  {
    title: "League",
    items: [
      { icon: "📍", label: "Fields", href: "/fields" },
      { icon: "📜", label: "Rules", href: "/rules" },
      { icon: "ℹ️", label: "About SFBL", href: "/sfbl-info" },
    ],
  },
  {
    title: "Sign Up",
    items: [
      { icon: "🧢", label: "Player Registration", href: "/player-registration" },
      { icon: "🏟️", label: "Team Registration", href: "/team-registration" },
      { icon: "✍️", label: "Team Waiver", href: "/team-waiver-form" },
      { icon: "👨‍⚖️", label: "Umpire Evaluation", href: "/umpire-evaluation-form" },
    ],
  },
  {
    title: "Account",
    items: [
      { icon: "🙋", label: "Profile", href: "/profile" },
    ],
  },
];

export function PwaTabBar() {
  const pathname = usePathname() ?? "/";
  const [isStandalone, setIsStandalone] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

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
          {MORE_SECTIONS.map((section) => (
            <div key={section.title} className="le-tabbar-sheet-section">
              <h3>{section.title}</h3>
              <ul>
                {section.items.map((it) => (
                  <li key={it.href}>
                    <Link href={it.href}>
                      <span className="le-tabbar-sheet-icon" aria-hidden>
                        {it.icon}
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
