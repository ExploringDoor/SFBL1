// Public field-status board — shows fields that are NOT playable right now
// (rained out / wet), so players can check their field before heading out.
// Renders nothing when every field is open, so it only ever appears on a
// problem day. Data comes from /leagues/{id}/site_config/field_status,
// set by the admin Field Status tab. Server-rendered (no client JS).

export type FieldState = "open" | "caution" | "closed";

export interface FieldStatusItem {
  name: string;
  state: FieldState;
  note?: string;
  at?: string;
}

const META: Record<
  Exclude<FieldState, "open">,
  { label: string; bg: string; border: string; fg: string }
> = {
  closed: {
    label: "Closed / Rained out",
    bg: "rgba(220,38,38,0.08)",
    border: "#dc2626",
    fg: "#b91c1c",
  },
  caution: {
    label: "Wet / Playable — use caution",
    bg: "rgba(217,119,6,0.10)",
    border: "#d97706",
    fg: "#b45309",
  },
};

function asOf(items: FieldStatusItem[]): string {
  const latest = items
    .map((i) => i.at ?? "")
    .filter(Boolean)
    .sort()
    .pop();
  if (!latest) return "";
  const d = new Date(latest);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function FieldStatusBoard({ items }: { items: FieldStatusItem[] }) {
  // Only surface fields that aren't open — a clean board that appears only
  // when something's actually wrong.
  const flagged = items.filter((i) => i.state !== "open");
  if (flagged.length === 0) return null;

  const updated = asOf(flagged);

  return (
    <section
      aria-label="Field status"
      style={{
        border: "1px solid var(--border, rgba(0,0,0,0.12))",
        borderRadius: 12,
        padding: "14px 16px",
        marginBottom: 24,
        background: "var(--surface, #fff)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 10,
        }}
      >
        <h2
          className="font-barlow"
          style={{
            fontSize: 14,
            fontWeight: 800,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--text-strong)",
            margin: 0,
          }}
        >
          ⚠ Field Status
        </h2>
        {updated && (
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            as of {updated}
          </span>
        )}
      </div>

      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
        {flagged.map((f) => {
          const m = META[f.state as Exclude<FieldState, "open">];
          return (
            <li
              key={f.name}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
                background: m.bg,
                borderLeft: `4px solid ${m.border}`,
                borderRadius: 8,
                padding: "8px 12px",
              }}
            >
              <span
                className="font-oswald"
                style={{
                  fontWeight: 700,
                  fontSize: 15,
                  textTransform: "uppercase",
                  color: "var(--text-strong)",
                }}
              >
                {f.name}
              </span>
              <span
                className="font-barlow"
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: m.fg,
                }}
              >
                {m.label}
              </span>
              {f.note && (
                <span style={{ fontSize: 13, color: "var(--muted)" }}>
                  — {f.note}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
