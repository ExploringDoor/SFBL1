// One Instagram or Facebook post, rendered by us rather than embedded.
//
// The point of pulling posts through the Graph API is that they arrive as
// DATA, so they can look like the rest of the site instead of like a panel
// borrowed from somewhere else. Facebook's own plugin is a white iframe with
// a header it will not let you hide; this is a dark card that matches every
// other card on the page, loads no third-party script, and cannot be
// restyled out from under us.

import type { SocialPost } from "@/lib/social/meta";

/** "3 days ago" — posts older than a fortnight just show the date. */
function ago(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  return new Date(t).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function SocialPostCard({ post }: { post: SocialPost }) {
  // Captions run long and a feed of three-paragraph posts destroys the row's
  // rhythm. Trimmed on a word boundary so it never cuts mid-word.
  const MAX = 140;
  let text = post.text;
  if (text.length > MAX) {
    text = text.slice(0, MAX);
    text = text.slice(0, Math.max(0, text.lastIndexOf(" "))) + "…";
  }

  return (
    <a
      className="le-post"
      href={post.permalink}
      target="_blank"
      rel="noopener noreferrer"
    >
      {post.image && (
        <span className="le-post-media">
          {/* Plain <img>: these are Meta CDN URLs that expire and rotate, so
              next/image would try to optimise a moving target and fill the
              cache with dead entries. Lazy + async so a feed of four never
              competes with the page itself. */}
          <img
            src={post.image}
            alt=""
            loading="lazy"
            decoding="async"
            className="le-post-img"
          />
          {post.isVideo && (
            <span className="le-post-play" aria-hidden="true">
              ▶
            </span>
          )}
        </span>
      )}
      {text && <span className="le-post-text">{text}</span>}
      <span className="le-post-when">{ago(post.timestamp)}</span>
    </a>
  );
}
