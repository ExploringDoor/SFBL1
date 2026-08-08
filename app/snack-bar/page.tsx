// Public snack-bar volunteer board.
//
// Server-renders the shift list, then hands it to a small client component for
// the sign-up interaction. Shifts are world-readable; the contact details a
// volunteer enters are not (see lib/volunteer-shifts + /api/snack-bar).

import { headers } from "next/headers";
import { getAdminDb } from "@/lib/firebase-admin";
import type { PublicClaim, Shift } from "@/lib/volunteer-shifts";
import { SnackBarBoard } from "./SnackBarBoard";
import "./snack-bar.css";

export const dynamic = "force-dynamic";

async function loadShifts(tenantId: string): Promise<Shift[]> {
  try {
    const db = getAdminDb();
    const snap = await db
      .collection(`leagues/${tenantId}/snackbar_shifts`)
      .get();
    const out: Shift[] = [];
    snap.forEach((d) => {
      const t = d.data() as Record<string, unknown>;
      const date = String(t.date ?? "");
      if (!date) return;
      out.push({
        id: d.id,
        date,
        start: String(t.start ?? ""),
        end: t.end ? String(t.end) : undefined,
        location: t.location ? String(t.location) : undefined,
        slots: Number(t.slots) || 1,
        claims: Array.isArray(t.claims) ? (t.claims as PublicClaim[]) : [],
        note: t.note ? String(t.note) : undefined,
      });
    });
    out.sort(
      (a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start),
    );
    return out;
  } catch {
    return [];
  }
}

export default async function SnackBarPage() {
  const h = headers();
  const tenantId = h.get("x-tenant-id") ?? "";
  const shifts = await loadShifts(tenantId);

  // Past shifts are noise on a sign-up board. Compared as strings because both
  // sides are ISO dates, which avoids a timezone shifting "today" off the list.
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = shifts.filter((s) => s.date >= today);

  return (
    <main className="container py-10 le-sb-page">
      <header className="le-history-hd">
        <p className="le-history-eyebrow">Volunteer</p>
        <h1 className="le-history-title">Snack Bar</h1>
        <p className="le-history-sub">
          The snack bar runs on volunteers, and the money it takes goes straight
          back into the league. Pick a shift that suits you — you only need to
          leave a name and a way to reach you.
        </p>
      </header>

      {upcoming.length === 0 ? (
        <p className="le-sb-empty">
          No shifts are posted right now. Check back once the season schedule is
          up.
        </p>
      ) : (
        <SnackBarBoard tenantId={tenantId} shifts={upcoming} />
      )}
    </main>
  );
}
