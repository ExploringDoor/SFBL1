// Team identity visualization — shows the team's logo if uploaded, otherwise
// falls back to a colored circle with the team's initials. Adopted as the
// canonical way to render team identity across standings/scores/schedule.

import Image from "next/image";

export interface TeamBadgeProps {
  teamId: string;
  name: string;
  initials?: string;       // explicit initials (e.g. "TBJ"); falls back to name acronym
  color?: string;          // hex color for the badge background; falls back to neutral
  logoUrl?: string | null; // optional uploaded logo URL
  /** "xl" for team-page hero (168px). "card" for /teams grid (112px). */
  size?: "sm" | "md" | "lg" | "card" | "xl";
}

const SIZE_CLASSES = {
  sm: "h-6 w-6 text-[9px]",
  md: "h-9 w-9 text-xs",
  lg: "h-12 w-12 text-sm",
  card: "h-[112px] w-[112px] text-lg",
  xl: "h-[168px] w-[168px] text-3xl",
} as const;

export function TeamBadge({
  teamId,
  name,
  initials,
  color,
  logoUrl,
  size = "md",
}: TeamBadgeProps) {
  if (logoUrl) {
    const px =
      size === "sm"
        ? 24
        : size === "md"
          ? 36
          : size === "lg"
            ? 48
            : size === "card"
              ? 112
              : 168;
    return (
      <span
        className={`inline-flex flex-shrink-0 items-center justify-center ${SIZE_CLASSES[size]}`}
        title={name}
      >
        <Image
          src={logoUrl}
          alt={name}
          width={px}
          height={px}
          className="h-full w-full object-contain"
        />
      </span>
    );
  }

  const text = (initials ?? deriveInitials(name)).slice(0, 3).toUpperCase();
  const bg = color ?? hashColor(teamId);
  const fg = readableForeground(bg);

  return (
    <span
      className={`inline-flex items-center justify-center rounded-md font-bold ring-1 ring-black/5 flex-shrink-0 ${SIZE_CLASSES[size]}`}
      style={{ backgroundColor: bg, color: fg }}
      title={name}
    >
      {text}
    </span>
  );
}

function deriveInitials(name: string): string {
  // "Tampa Sluggers" → "TS", "Beth Sholom Mens Club" → "BSM", "Or Ami" → "OA"
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();
}

function hashColor(seed: string): string {
  // Stable color from team id so it's the same every render.
  // Pull from a curated palette — soft, distinguishable, not eye-stabbing.
  const palette = [
    "#1e3a8a", // navy
    "#7c2d12", // dark red
    "#14532d", // forest
    "#581c87", // purple
    "#0f766e", // teal
    "#9a3412", // burnt orange
    "#365314", // olive
    "#86198f", // magenta
    "#1e293b", // slate
    "#92400e", // amber
  ];
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return palette[h % palette.length]!;
}

function readableForeground(bg: string): string {
  // Returns black or white based on perceived luminance of the bg color.
  const m = bg.match(/^#([0-9a-f]{6})$/i);
  if (!m) return "#fff";
  const n = parseInt(m[1]!, 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  // sRGB → relative luminance approximation
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "#0f172a" : "#ffffff";
}
