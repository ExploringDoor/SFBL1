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
import { useState } from "react";
import "./Nav.css";

export interface NavLink {
  label: string;
  href: string;
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
  { label: "Rules", href: "/rules" },
];

export function Nav({
  tenantShort,
  logoUrl,
  links = DEFAULT_LINKS,
  rightSlot,
}: NavProps) {
  const pathname = usePathname();
  const [mobOpen, setMobOpen] = useState(false);

  return (
    <>
      <nav className="le-nav">
        <Link href="/" className="le-nav-brand" onClick={() => setMobOpen(false)}>
          {logoUrl && <img src={logoUrl} alt="" />}
          <span>{tenantShort}</span>
        </Link>

        <ul className="le-nav-links">
          {links.map((link) => (
            <li key={link.href} className={isActive(pathname, link.href) ? "active" : ""}>
              <Link href={link.href}>{link.label}</Link>
            </li>
          ))}
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
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            onClick={() => setMobOpen(false)}
          >
            {link.label}
          </Link>
        ))}
      </div>
    </>
  );
}

function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}
