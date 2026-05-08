// Division chip filter — used on /scores and /schedule. Pure server
// component, navigation via plain anchors so the filter state lives
// in the URL (`?div=...`) and survives reloads / back-forward.
//
// "All" maps to no `div` query param so the canonical URL of "show
// everything" is just `/scores` or `/schedule` (cleaner for sharing).

interface Props {
  /** All distinct divisions present in the current dataset. */
  divisions: string[];
  /** The active division, or null for "All". */
  active: string | null;
  /** The path the chips link to — e.g. "/scores" or "/schedule". */
  basePath: string;
}

export function DivisionFilter({ divisions, active, basePath }: Props) {
  const activeKey = active ?? "all";
  return (
    <div
      className="flex flex-wrap items-center gap-2 mt-6 mb-2"
      role="tablist"
      aria-label="Filter by division"
    >
      <span
        className="font-barlow"
        style={{
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--muted)",
          marginRight: 4,
        }}
      >
        Division:
      </span>
      <Chip
        label="All"
        value="all"
        isActive={activeKey === "all"}
        basePath={basePath}
      />
      {divisions.map((d) => (
        <Chip
          key={d}
          label={d}
          value={d}
          isActive={activeKey === d}
          basePath={basePath}
        />
      ))}
    </div>
  );
}

function Chip({
  label,
  value,
  isActive,
  basePath,
}: {
  label: string;
  value: string;
  isActive: boolean;
  basePath: string;
}) {
  const href =
    value === "all" ? basePath : `${basePath}?div=${encodeURIComponent(value)}`;
  return (
    <a
      href={href}
      role="tab"
      aria-selected={isActive}
      style={{
        padding: "6px 14px",
        borderRadius: 999,
        fontSize: 13,
        fontWeight: 700,
        textDecoration: "none",
        background: isActive ? "var(--brand-primary)" : "var(--card)",
        color: isActive ? "white" : "var(--text-strong)",
        border: `1px solid ${isActive ? "var(--brand-primary)" : "var(--border)"}`,
        transition: "all 0.15s ease",
      }}
    >
      {label}
    </a>
  );
}
