// Instagram and Facebook posts, pulled from Meta's Graph API on our server.
//
// WHY THIS EXISTS INSTEAD OF AN EMBED OR A PAID WIDGET.
//
// Instagram killed Basic Display in Dec 2024, so the free embed shows one
// hand-picked post that goes stale — which Mike specifically did not want.
// Elfsight bills per app, so a live Instagram feed would be another
// subscription on top of the TikTok one. Meta's Graph API is free for an
// account you control: an app left in DEVELOPMENT mode needs no App Review,
// it only needs the account added to it as a tester. Island only ever serves
// its own account, so that is the whole requirement.
//
// The payoff is bigger than the fee saved. These come back as data, so the
// site renders them in its OWN styling — dark, sized like everything else,
// no third-party script, and nothing to crop. Facebook's own plugin cost five
// rounds of pixel-nudging to hide a header it will not let you turn off.
//
// TOKENS LIVE IN FIRESTORE, NOT THE TENANT CONFIG. `leagues/{id}` is
// world-readable (firestore.rules line 104). `leagues/{id}/_private/social`
// matches no rule and therefore falls to the default deny, so a browser can
// never read it while the Admin SDK still can.
//
// The token lasts 60 days. scripts/refresh-meta-token.ts renews it; if that
// ever stops running the feed goes quiet, which is the one real cost of not
// paying a provider.

import { getAdminDb } from "@/lib/firebase-admin";

const GRAPH = "https://graph.facebook.com/v21.0";

export interface SocialPost {
  id: string;
  network: "instagram" | "facebook";
  /** Post caption / message, already trimmed for display. */
  text: string;
  /** Image or video thumbnail. */
  image: string | null;
  /** Where the post lives on the network. */
  permalink: string;
  /** ISO timestamp, for ordering and "3 days ago". */
  timestamp: string;
  isVideo: boolean;
}

export interface MetaCredentials {
  ig_user_id?: string;
  ig_token?: string;
  fb_page_id?: string;
  fb_page_token?: string;
  token_expires_at?: string;
}

/** Read the tokens. Server-only — never expose this to a client component. */
export async function metaCredentials(
  leagueId: string,
): Promise<MetaCredentials | null> {
  try {
    const snap = await getAdminDb()
      .doc(`leagues/${leagueId}/_private/social`)
      .get();
    return snap.exists ? (snap.data() as MetaCredentials) : null;
  } catch {
    return null;
  }
}

async function graph<T>(path: string, params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${GRAPH}/${path}?${qs}`, {
    // Meta's data is not that fresh anyway, and this is called behind our own
    // cache; no point asking Next to cache a token-bearing URL.
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Graph ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

/** Latest Instagram posts for the connected business account. */
export async function instagramPosts(
  creds: MetaCredentials,
  limit = 4,
): Promise<SocialPost[]> {
  if (!creds.ig_user_id || !creds.ig_token) return [];
  const data = await graph<{
    data?: {
      id: string;
      caption?: string;
      media_type?: string;
      media_url?: string;
      thumbnail_url?: string;
      permalink?: string;
      timestamp?: string;
    }[];
  }>(`${creds.ig_user_id}/media`, {
    fields: "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp",
    limit: String(limit),
    access_token: creds.ig_token,
  });
  return (data.data ?? []).map((m) => ({
    id: m.id,
    network: "instagram" as const,
    text: (m.caption ?? "").trim(),
    // A VIDEO's media_url is the mp4; thumbnail_url is the still we want.
    image: m.media_type === "VIDEO" ? (m.thumbnail_url ?? null) : (m.media_url ?? null),
    permalink: m.permalink ?? "",
    timestamp: m.timestamp ?? "",
    isVideo: m.media_type === "VIDEO",
  }));
}

/** Latest posts from the connected Facebook page. */
export async function facebookPosts(
  creds: MetaCredentials,
  limit = 4,
): Promise<SocialPost[]> {
  if (!creds.fb_page_id || !creds.fb_page_token) return [];
  const data = await graph<{
    data?: {
      id: string;
      message?: string;
      full_picture?: string;
      permalink_url?: string;
      created_time?: string;
      attachments?: { data?: { type?: string }[] };
    }[];
  }>(`${creds.fb_page_id}/posts`, {
    fields: "id,message,full_picture,permalink_url,created_time,attachments{type}",
    limit: String(limit),
    access_token: creds.fb_page_token,
  });
  return (data.data ?? []).map((p) => ({
    id: p.id,
    network: "facebook" as const,
    text: (p.message ?? "").trim(),
    image: p.full_picture ?? null,
    permalink: p.permalink_url ?? "",
    timestamp: p.created_time ?? "",
    isVideo: (p.attachments?.data ?? []).some((a) =>
      String(a.type ?? "").includes("video"),
    ),
  }));
}

/**
 * Everything we can fetch for a league, newest first.
 *
 * Never throws: a dead token or a Meta outage must degrade to "no posts", not
 * to a 500 on the home page. The reason is logged so a quiet feed is
 * diagnosable rather than mysterious.
 */
export async function fetchSocialPosts(
  leagueId: string,
): Promise<{ instagram: SocialPost[]; facebook: SocialPost[] }> {
  const creds = await metaCredentials(leagueId);
  if (!creds) return { instagram: [], facebook: [] };

  const [ig, fb] = await Promise.all([
    instagramPosts(creds).catch((e) => {
      console.error("[social] instagram fetch failed", e);
      return [] as SocialPost[];
    }),
    facebookPosts(creds).catch((e) => {
      console.error("[social] facebook fetch failed", e);
      return [] as SocialPost[];
    }),
  ]);
  return { instagram: ig, facebook: fb };
}
