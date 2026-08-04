// Cached reads of the two collections every public page needs.
//
// Why: /, /standings, /scores, /schedule and /teams each pulled the ENTIRE
// teams and games collections from Firestore on every single request, with no
// cache. For COYBL that is ~200 team docs plus ~1,000 game docs per page view,
// and it grows every season. Two coaches loading the schedule at the same
// moment paid for it twice.
//
// These wrappers keep the reads but let Next serve them from its data cache
// for a short window, so a burst of visitors costs one read set instead of one
// per visitor. Pages stay dynamically rendered; nothing about auth, tenancy or
// personalisation changes.
//
// The return value deliberately mimics a Firestore QuerySnapshot (`.docs`,
// each with `.id` and `.data()`, plus `.empty` / `.size`) so call sites swap
// one line and keep their existing mapping code. The cached payload itself is
// plain data — functions cannot be cached, so the accessors are rebuilt around
// the cached rows on the way out.
//
// TTL: 45 seconds. Long enough to absorb a burst, short enough that a score a
// coach just posted shows up while they are still looking at the page.
//
// CROSS-TENANT SAFETY: the tenant id is part of the cache key AND the tag.
// Getting that wrong would serve one league's teams to another, so it is in
// both places rather than relying on argument serialisation.

import { unstable_cache } from "next/cache";
import { getAdminDb } from "@/lib/firebase-admin";

export const LEAGUE_CACHE_TTL = 45;

type Row = { id: string; data: Record<string, unknown> };

export interface SnapshotLike {
  docs: { id: string; data: () => Record<string, unknown> }[];
  empty: boolean;
  size: number;
}

function toSnapshot(rows: Row[]): SnapshotLike {
  return {
    docs: rows.map((r) => ({ id: r.id, data: () => r.data })),
    empty: rows.length === 0,
    size: rows.length,
  };
}

function cachedCollection(
  tenantId: string,
  collection: "teams" | "games",
): () => Promise<Row[]> {
  return unstable_cache(
    async () => {
      const snap = await getAdminDb()
        .collection(`leagues/${tenantId}/${collection}`)
        .get();
      return snap.docs.map((d) => ({
        id: d.id,
        data: d.data() as Record<string, unknown>,
      }));
    },
    [`league-${collection}`, tenantId],
    {
      revalidate: LEAGUE_CACHE_TTL,
      tags: [`${collection}:${tenantId}`],
    },
  );
}

/** Every team doc for a league, shaped like a QuerySnapshot. */
export async function getCachedTeamsSnap(
  tenantId: string,
): Promise<SnapshotLike> {
  return toSnapshot(await cachedCollection(tenantId, "teams")());
}

/** Every game doc for a league, shaped like a QuerySnapshot. */
export async function getCachedGamesSnap(
  tenantId: string,
): Promise<SnapshotLike> {
  return toSnapshot(await cachedCollection(tenantId, "games")());
}
