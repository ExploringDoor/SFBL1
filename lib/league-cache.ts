// Process-local, TENANT-KEYED cache for the whole-league collection
// reads that player pages need. Keyed strictly by tenantId so one
// tenant's data can never surface under another (multi-tenant is
// non-negotiable — same discipline as tickerCache in site-data.ts).
//
// Why this exists (audit 2026-07): every /players/[id] render did four
// FULL collection reads (box_scores + seasons + teams + games) that are
// identical for every player in a league. With ~400 player pages in the
// sitemap, a crawl re-fetched the same four collections ~400 times. This
// caches that bundle so a burst/crawl shares one read set per warm
// process within the TTL window.
//
// NOT a CDN/HTML cache: this only dedups Firestore reads inside the
// server process. Rendered HTML is still per-request and per-tenant, so
// there is no cross-tenant page-bleed risk (that's why we did NOT reach
// for ISR / edge caching, which key on path not Host).

import type { Firestore, QuerySnapshot } from "firebase-admin/firestore";

export interface LeagueBundle {
  boxesSnap: QuerySnapshot;
  seasonsSnap: QuerySnapshot;
  teamsSnap: QuerySnapshot;
  gamesSnap: QuerySnapshot;
}

interface BundleEntry {
  bundle: LeagueBundle;
  expires_at: number;
}

// 30s TTL — long enough to absorb a crawler sweeping hundreds of player
// URLs, short enough that a captain viewing their page right after a
// score is entered sees fresh data within half a minute.
const BUNDLE_TTL_MS = 30_000;
const bundleCache = new Map<string, BundleEntry>();

export async function loadLeagueBundle(
  db: Firestore,
  tenantId: string,
): Promise<LeagueBundle> {
  const hit = bundleCache.get(tenantId);
  if (hit && Date.now() < hit.expires_at) return hit.bundle;

  const [boxesSnap, seasonsSnap, teamsSnap, gamesSnap] = await Promise.all([
    db.collection(`leagues/${tenantId}/box_scores`).get(),
    db.collection(`leagues/${tenantId}/seasons`).get(),
    db.collection(`leagues/${tenantId}/teams`).get(),
    db.collection(`leagues/${tenantId}/games`).get(),
  ]);
  const bundle: LeagueBundle = {
    boxesSnap,
    seasonsSnap,
    teamsSnap,
    gamesSnap,
  };
  bundleCache.set(tenantId, {
    bundle,
    expires_at: Date.now() + BUNDLE_TTL_MS,
  });
  return bundle;
}

// Lighter bundle for the high-traffic read pages (/standings, /scores,
// /schedule) which each independently read the full games + teams
// collections per request. Sharing this cache dedups those reads across
// the three pages AND across requests within the TTL window — same
// tenant-keyed, in-process, no-cross-tenant discipline as above.
export interface GamesTeamsSnaps {
  gamesSnap: QuerySnapshot;
  teamsSnap: QuerySnapshot;
}

interface GamesTeamsEntry {
  snaps: GamesTeamsSnaps;
  expires_at: number;
}

const gamesTeamsCache = new Map<string, GamesTeamsEntry>();

export async function loadGamesAndTeamsSnaps(
  db: Firestore,
  tenantId: string,
): Promise<GamesTeamsSnaps> {
  const hit = gamesTeamsCache.get(tenantId);
  if (hit && Date.now() < hit.expires_at) return hit.snaps;

  const [gamesSnap, teamsSnap] = await Promise.all([
    db.collection(`leagues/${tenantId}/games`).get(),
    db.collection(`leagues/${tenantId}/teams`).get(),
  ]);
  const snaps: GamesTeamsSnaps = { gamesSnap, teamsSnap };
  gamesTeamsCache.set(tenantId, {
    snaps,
    expires_at: Date.now() + BUNDLE_TTL_MS,
  });
  return snaps;
}
