// The structured rules document: one place that decides what a valid section is.
//
// /rules renders site_config/rules and SILENTLY DROPS anything malformed. That
// is the right behaviour for a public page, and a trap for an editor: a save
// could look successful and quietly delete a section. So the admin save path
// normalises through here first, counts what it had to drop, and tells the
// person who pressed Save.
//
// Extracted from app/api/admin-rules/route.ts so it can be tested without
// Firebase. See components/admin/RulesManager.tsx for the editor and
// components/RulesRichView.tsx for the renderer these shapes must satisfy.

export interface SpecPair {
  label: string;
  value: string;
}

export interface RulesDocSection {
  section: string;
  icon?: string;
  divisions?: string[];
  kind?: "specs";
  items?: string[];
  specs?: SpecPair[];
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * Normalise one section into exactly what the renderer reads.
 *
 * Returns null when the section cannot render at all, which is the signal the
 * caller needs in order to report a dropped section rather than lose it.
 */
export function cleanSection(raw: unknown): RulesDocSection | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const title = str(r.section);
  // No heading, no card. The renderer keys its anchors off the title.
  if (!title) return null;

  const out: RulesDocSection = { section: title };
  const icon = str(r.icon);
  if (icon) out.icon = icon;

  // An empty divisions array and an absent one both mean "show on every tab".
  // Store the absent form so the document says what it means.
  const divisions = Array.isArray(r.divisions)
    ? r.divisions.map(str).filter(Boolean)
    : [];
  if (divisions.length) out.divisions = divisions;

  if (r.kind === "specs") {
    const specs = (Array.isArray(r.specs) ? r.specs : [])
      .map((p) => {
        const o = (p ?? {}) as Record<string, unknown>;
        return { label: str(o.label), value: str(o.value) };
      })
      // Both halves required: a tile with a blank side is a label pointing at
      // nothing, which reads as a mistake on a public page.
      .filter((p) => p.label && p.value);
    if (!specs.length) return null;
    out.kind = "specs";
    out.specs = specs;
    return out;
  }

  const items = (Array.isArray(r.items) ? r.items : []).map(str).filter(Boolean);
  if (!items.length) return null;
  out.items = items;
  return out;
}

/** Clean a whole document, reporting how many sections could not render. */
export function cleanSections(raw: unknown): {
  sections: RulesDocSection[];
  dropped: number;
} {
  const list = Array.isArray(raw) ? raw : [];
  const sections: RulesDocSection[] = [];
  let dropped = 0;
  for (const r of list) {
    const s = cleanSection(r);
    if (s) sections.push(s);
    else dropped++;
  }
  return { sections, dropped };
}

/** Division tabs, keeping only entries the renderer can draw. */
export function cleanDivisions(
  raw: unknown,
): { key: string; label: string; sub?: string }[] {
  return (Array.isArray(raw) ? raw : [])
    .map((d) => {
      const o = (d ?? {}) as Record<string, unknown>;
      const key = str(o.key);
      const label = str(o.label);
      if (!key || !label) return null;
      const sub = str(o.sub);
      return sub ? { key, label, sub } : { key, label };
    })
    .filter((d): d is { key: string; label: string; sub?: string } => d !== null);
}

// ── the editor's form shape ──────────────────────────────────────────────
// RulesManager holds bullets as one blob of text, one rule per line, because
// eleven separate inputs for Conduct And Ejections is not an editor anyone
// wants. These two functions are that translation, and they live here rather
// than in the component so the round trip can be tested against the real
// document: the worst bug this feature could have is Mike opening the tab,
// pressing Save without typing anything, and losing a section.

export interface DraftSection {
  section: string;
  icon: string;
  divisions: string[];
  kind: "rules" | "specs";
  /** Bullets, one per line. Empty for a specs section. */
  text: string;
  specs: SpecPair[];
}

/** Stored section → the form. */
export function toDraft(raw: unknown): DraftSection {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    section: typeof r.section === "string" ? r.section : "",
    icon: typeof r.icon === "string" ? r.icon : "book",
    divisions: Array.isArray(r.divisions)
      ? r.divisions.filter((d): d is string => typeof d === "string")
      : [],
    kind: r.kind === "specs" ? "specs" : "rules",
    text: Array.isArray(r.items)
      ? (r.items as unknown[]).filter((i) => typeof i === "string").join("\n")
      : "",
    specs: Array.isArray(r.specs)
      ? (r.specs as unknown[]).map((p) => {
          const o = (p ?? {}) as Record<string, unknown>;
          return {
            label: typeof o.label === "string" ? o.label : "",
            value: typeof o.value === "string" ? o.value : "",
          };
        })
      : [],
  };
}

/** The form → a section for the server to clean and store. */
export function fromDraft(d: DraftSection): Record<string, unknown> {
  const base = { section: d.section.trim(), icon: d.icon, divisions: d.divisions };
  if (d.kind === "specs") return { ...base, kind: "specs", specs: d.specs };
  return {
    ...base,
    // Blank lines are how a pasted block arrives. They are spacing, not rules.
    items: d.text.split("\n").map((l) => l.trim()).filter(Boolean),
  };
}
