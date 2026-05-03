// DVSL-style header: brand on the left, nav middle, profile right.
// Sticky under the ticker.

import Link from "next/link";
import { TeamBadge } from "./TeamBadge";
import { ProfileButton } from "./ProfileButton";

export interface SiteHeaderProps {
  tenantId: string;
  leagueName: string;
  leagueAbbrev?: string;
  logoUrl?: string | null;
}

const NAV = [
  { label: "Home", href: "/" },
  { label: "Scores", href: "/scores" },
  { label: "Schedule", href: "/schedule" },
  { label: "Standings", href: "/standings" },
  { label: "Stats", href: "/players" },
  { label: "Teams", href: "/teams" },
  { label: "Rules", href: "/rules" },
];

export function SiteHeader({
  tenantId,
  leagueName,
  leagueAbbrev,
  logoUrl,
}: SiteHeaderProps) {
  const brand = leagueAbbrev ?? deriveAbbrev(leagueName);
  return (
    <header className="site-header">
      <div className="container flex h-full w-full items-center gap-6">
        <Link href="/" className="flex items-center gap-2 flex-shrink-0">
          <TeamBadge
            teamId={tenantId}
            name={leagueName}
            initials={brand}
            logoUrl={logoUrl}
            size="md"
          />
          <span
            className="font-barlow text-xl font-black tracking-wide"
            style={{ color: "var(--brand-primary)" }}
          >
            {brand}
          </span>
        </Link>

        <nav className="hidden flex-1 items-center justify-center gap-6 md:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="font-barlow text-[11.5px] font-semibold uppercase tracking-wider text-slate-600 hover:text-slate-900"
              style={{ letterSpacing: "0.1em" }}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <ProfileButton tenantId={tenantId} />
        </div>
      </div>
    </header>
  );
}

function deriveAbbrev(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 4);
}
