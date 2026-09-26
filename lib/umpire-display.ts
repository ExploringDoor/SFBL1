// The umpire crew as the PUBLIC pages should see it.
//
// Games store the Arbiter-synced crew under `arbiter_crew` (a SEPARATE field from
// `game.umpires`, which is the manual umpire-assignment system's opaque-id array —
// see lib/umpires). The crew written to the public game doc is name + position
// only; email is never written there. Every public surface reads the crew through
// this one helper, which also strips any stray email defensively.

export interface PublicUmpire {
  name: string;
  position?: string;
}

export function publicUmpires(raw: unknown): PublicUmpire[] {
  if (!Array.isArray(raw)) return [];
  const out: PublicUmpire[] = [];
  for (const u of raw) {
    if (!u || typeof u !== "object") continue;
    const name = String((u as Record<string, unknown>).name ?? "").trim();
    if (!name) continue;
    const pos = String((u as Record<string, unknown>).position ?? "").trim();
    out.push(pos ? { name, position: pos } : { name });
  }
  return out;
}
