// Shared Player-of-the-Week ordering. Used by BOTH the public page
// (server) and the admin manager (client) so the two never drift on
// what "newest" means (audit H6 lesson — one source of truth).
//
// Ordering intent:
//   • A dated weekly pick (award_date set) is "current" and sorts to
//     the top, newest date first. This is the going-forward path —
//     the commissioner adds this week's player with today's date.
//   • Historical entries carry season + week instead of a date and
//     sort by season recency, then week high→low. The public page
//     groups the archive by `season`.

export interface PotwSortable {
  season?: string | null;
  week?: number | null;
  award_date?: string | null;
  created_at?: string | null;
}

// "Spring 2019" → 20191, "Fall 2018" → 20183, "Summer 2020" → 20202.
// Higher = more recent. Unknown/blank season → 0 (sorts last).
export function seasonRank(season: string | null | undefined): number {
  if (!season) return 0;
  const m = /(\d{4})/.exec(season);
  const year = m ? Number(m[1]) : 0;
  const s = season.toLowerCase();
  const part =
    s.includes("fall") || s.includes("autumn")
      ? 3
      : s.includes("summer")
        ? 2
        : 1; // spring / winter / default
  return year * 10 + part;
}

// Newest-first comparator. award_date wins when present (modern
// weekly picks); otherwise season rank desc, then week desc, then
// created_at desc as a stable tiebreak.
export function comparePotwDesc(a: PotwSortable, b: PotwSortable): number {
  const ad = a.award_date ?? "";
  const bd = b.award_date ?? "";
  if (ad && bd && ad !== bd) return bd.localeCompare(ad);
  if (ad && !bd) return -1;
  if (!ad && bd) return 1;
  const ar = seasonRank(a.season);
  const br = seasonRank(b.season);
  if (ar !== br) return br - ar;
  const aw = a.week ?? 0;
  const bw = b.week ?? 0;
  if (aw !== bw) return bw - aw;
  return (b.created_at ?? "").localeCompare(a.created_at ?? "");
}
