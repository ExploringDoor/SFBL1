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
  // Stats-off tenants (e.g. youth leagues that only track scores) hide the
  // player-stats nav. Defaults to on so existing tenants are unaffected.
  showStats?: boolean;
  // Tenants that run tournaments on an external platform show a Tournaments
  // link. Defaults off so existing tenants are unaffected.
  showTournaments?: boolean;
  // Youth baseball tenants tracking Pitch Smart eligibility show a Pitch
  // Counts link. Defaults off.
  showPitchCounts?: boolean;
  // RPI power rankings link. Defaults off.
  showPowerRankings?: boolean;
  // When registration is open, show a prominent "Register" button. Defaults off.
  registrationOpen?: boolean;
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
  showStats = true,
  showTournaments = false,
  showPitchCounts = false,
  showPowerRankings = false,
  registrationOpen = false,
}: SiteHeaderProps) {
  const brand = leagueAbbrev ?? deriveAbbrev(leagueName);
  let nav = showStats ? [...NAV] : NAV.filter((item) => item.label !== "Stats");
  const extras: { label: string; href: string }[] = [];
  if (showPowerRankings) extras.push({ label: "Power Rankings", href: "/power-rankings" });
  if (showPitchCounts) extras.push({ label: "Pitch Counts", href: "/eligibility" });
  if (showTournaments) extras.push({ label: "Tournaments", href: "/tournaments" });
  if (extras.length) {
    const rulesIdx = nav.findIndex((item) => item.label === "Rules");
    nav =
      rulesIdx >= 0
        ? [...nav.slice(0, rulesIdx), ...extras, ...nav.slice(rulesIdx)]
        : [...nav, ...extras];
  }
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
          {nav.map((item) => (
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
          {registrationOpen && (
            <Link
              href="/register"
              className="hidden items-center rounded-md px-3.5 py-1.5 font-barlow text-xs font-bold uppercase tracking-wider text-white sm:inline-flex"
              style={{
                background: "var(--brand-accent, var(--brand-primary))",
                letterSpacing: "0.08em",
              }}
            >
              Register
            </Link>
          )}
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
