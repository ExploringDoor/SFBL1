// The umpire crew as the PUBLIC pages should see it.
//
// Games store `umpires` as [{ name, email?, position? }] when synced from
// Arbiter's "Games with Official info" report (see app/api/admin-arbiter). The
// email is for the league's own records and admin blasts — it must never reach a
// public page, so every public surface reads the crew through this one helper,
// which keeps name + position only.

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
