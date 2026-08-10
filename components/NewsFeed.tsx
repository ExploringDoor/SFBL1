// Full News & Events feed for /content/news (LCYBL). The platform already has
// a homepage "News & Events" strip (HomepageNews, capped at 4) and an admin
// editor (NewsManager) writing /leagues/{tenant}/news — this is the dedicated
// page that lists EVERY post. Pinned first, then newest. Pure server component
// (admin SDK read, so Firestore rules don't gate display). SVG icons, no emoji
// (see feedback_match_flagship_quality). Empty state is a friendly placeholder
// rather than a blank page.

import { getAdminDb } from "@/lib/firebase-admin";
import styles from "./NewsFeed.module.css";

interface NewsPost {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  event_date: string | null;
  color: string | null;
  created_at: string | null;
}

async function loadAllNews(tenantId: string): Promise<NewsPost[]> {
  try {
    const snap = await getAdminDb()
      .collection(`leagues/${tenantId}/news`)
      .orderBy("created_at", "desc")
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
          typeof data.color === "string" && /^#[0-9a-f]{6}$/i.test(data.color)
            ? data.color
            : null,
        created_at: data.created_at ? String(data.created_at) : null,
      };
    });
    list.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      const ad = a.event_date ?? a.created_at ?? "";
      const bd = b.event_date ?? b.created_at ?? "";
      return bd.localeCompare(ad);
    });
    return list;
  } catch {
    return [];
  }
}

function fmt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export async function NewsFeed({ tenantId }: { tenantId: string }) {
  const posts = await loadAllNews(tenantId);

  if (posts.length === 0) {
    return (
      <div className={styles.empty}>
        <strong>No announcements yet.</strong>
        <p>
          League news, event dates, and reminders will appear here as the
          season gets going. Check back soon.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.feed}>
      {posts.map((p) => {
        const accent = p.color ?? "var(--brand-primary, #14213d)";
        return (
          <article
            key={p.id}
            className={styles.card}
            style={{ borderLeftColor: accent }}
          >
            <div className={styles.meta}>
              {p.pinned && (
                <span className={styles.pin}>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden
                  >
                    <path d="M16 3l5 5-4 1-4 4-1 6-2-2-4 4-1-1 4-4-2-2 6-1 4-4z" />
                  </svg>
                  Pinned
                </span>
              )}
              {p.event_date ? (
                <span className={styles.date}>
                  <CalIcon /> {fmt(p.event_date)}
                </span>
              ) : (
                p.created_at && (
                  <span className={styles.date}>
                    <CalIcon /> {fmt(p.created_at)}
                  </span>
                )
              )}
            </div>
            {p.title && <h2 className={styles.title}>{p.title}</h2>}
            {p.body && (
              <div
                className={styles.body}
                dangerouslySetInnerHTML={{ __html: p.body }}
              />
            )}
          </article>
        );
      })}
    </div>
  );
}

function CalIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}
