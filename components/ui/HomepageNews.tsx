// Homepage "From the Commissioner — News & Events" strip.
//
// Reads /leagues/{leagueId}/news, sorts pinned-first then by created
// date desc, renders up to N cards with the LBDC-style layout:
//   - Orange "PINNED" pill (only when post.pinned)
//   - Optional 📅 + date row (when post.event_date set)
//   - Title (bold)
//   - HTML body (sanitized at write-time via /api/admin-news)
//   - Colored left border (post.color, falls back to brand-primary)
//
// Server component — runs on every request. Hidden entirely when the
// league has no news posts (no "empty state" copy; if there's nothing
// to announce, the strip doesn't exist).

import { getAdminDb } from "@/lib/firebase-admin";

interface NewsPost {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  event_date: string | null;
  color: string | null;
  created_at: string | null;
  updated_at: string | null;
}

async function loadNews(tenantId: string, limit: number): Promise<NewsPost[]> {
  try {
    // Order by created_at desc; pin priority done in JS so a small N
    // doesn't accidentally drop a pinned post that's older than the
    // newest unpinned posts.
    const snap = await getAdminDb()
      .collection(`leagues/${tenantId}/news`)
      .orderBy("created_at", "desc")
      .limit(limit * 3) // over-fetch so the pin-priority sort has runway
      .get();
    const list: NewsPost[] = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: String(data.id ?? d.id),
        title: String(data.title ?? ""),
        body: String(data.body ?? ""),
        pinned: data.pinned === true,
        event_date: data.event_date ? String(data.event_date) : null,
        color:
          typeof data.color === "string" &&
          /^#[0-9a-f]{6}$/i.test(data.color)
            ? data.color
            : null,
        created_at: data.created_at ? String(data.created_at) : null,
        updated_at: data.updated_at ? String(data.updated_at) : null,
      };
    });
    list.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      // Within each group: event_date desc when present, else
      // created_at desc.
      const ad = a.event_date ?? a.created_at ?? "";
      const bd = b.event_date ?? b.created_at ?? "";
      return bd.localeCompare(ad);
    });
    return list.slice(0, limit);
  } catch {
    // News collection may not exist yet for a brand-new tenant.
    // Empty array = strip doesn't render.
    return [];
  }
}

export async function HomepageNews({
  leagueId,
  limit = 4,
}: {
  leagueId: string;
  limit?: number;
}) {
  const posts = await loadNews(leagueId, limit);
  if (posts.length === 0) return null;
  return (
    <section className="le-home-news" aria-label="News and events">
      <p className="le-home-news-eyebrow">From the Commissioner</p>
      <h2 className="le-home-news-title">News &amp; Events</h2>
      <ul className="le-home-news-list">
        {posts.map((p) => (
          <NewsCard key={p.id} post={p} />
        ))}
      </ul>
    </section>
  );
}

function NewsCard({ post }: { post: NewsPost }) {
  const accent = post.color ?? "var(--brand-primary, #002d6e)";
  const eventLabel = post.event_date
    ? formatEventDate(post.event_date)
    : null;
  return (
    <li className="le-home-news-card" style={{ borderLeftColor: accent }}>
      <div className="le-home-news-card-meta">
        {post.pinned && (
          <span className="le-home-news-pin">📌 Pinned</span>
        )}
        {eventLabel && (
          <span className="le-home-news-date">📅 {eventLabel}</span>
        )}
      </div>
      {post.title && (
        <h3 className="le-home-news-card-title">{post.title}</h3>
      )}
      {post.body && (
        <div
          className="le-home-news-body"
          dangerouslySetInnerHTML={{ __html: post.body }}
        />
      )}
    </li>
  );
}

// Pretty "Fri, Jul 3, 2026" — matches the LBDC original site format
// (calendar emoji + comma-separated short weekday/long month/day/year).
function formatEventDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("en-US", {
      weekday: "short",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}
