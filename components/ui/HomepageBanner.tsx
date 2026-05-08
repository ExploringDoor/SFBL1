// Homepage banner alert. Server component — reads
// /leagues/{leagueId}/site_config/banner directly. Renders nothing
// when no banner is active or when the active banner has expired.
//
// Hidden by force-dynamic page wrapper, so admin publishes are
// reflected on the next request without a deploy or cache wait.
//
// Body is HTML produced by the RichEditor in the Alerts admin tab,
// already sanitized server-side at write time (/api/admin-alert →
// stored verbatim — wait, NO: alert body comes through admin-alert
// endpoint which currently doesn't sanitize. We sanitize here at
// render time as a defense-in-depth, using the same DOMPurify
// allowlist as the page renderer.

import { getAdminDb } from "@/lib/firebase-admin";
import { sanitizeHtml } from "@/lib/markdown";
import "./HomepageBanner.css";

interface BannerDoc {
  active?: boolean;
  title?: string;
  body?: string;
  kind?: "info" | "warning" | "critical";
  expires_at?: string | null;
}

const PALETTE: Record<NonNullable<BannerDoc["kind"]>, string> = {
  info: "le-banner-info",
  warning: "le-banner-warning",
  critical: "le-banner-critical",
};

export async function HomepageBanner({ leagueId }: { leagueId: string }) {
  let data: BannerDoc | null = null;
  try {
    const snap = await getAdminDb()
      .doc(`leagues/${leagueId}/site_config/banner`)
      .get();
    if (snap.exists) {
      data = snap.data() as BannerDoc;
    }
  } catch {
    // Banner is non-critical — never fail the page if Firestore is
    // unhappy.
    return null;
  }

  if (!data || data.active !== true) return null;
  if (!data.title && !data.body) return null;

  // Expiry check — server-side wall clock.
  if (data.expires_at) {
    const expiry = Date.parse(data.expires_at);
    if (Number.isFinite(expiry) && Date.now() >= expiry) return null;
  }

  const kindClass =
    PALETTE[data.kind ?? "info"] ?? PALETTE.info;

  // Body may be either plain text (legacy) or HTML (RichEditor).
  // Always sanitize before rendering as HTML.
  const bodyHtml = data.body ? sanitizeHtml(data.body) : "";

  return (
    <div className={`le-banner ${kindClass}`} role="status">
      <div className="le-banner-inner">
        {data.title && (
          <strong className="le-banner-title">{data.title}</strong>
        )}
        {data.title && bodyHtml && (
          <span className="le-banner-sep"> — </span>
        )}
        {bodyHtml && (
          <span
            className="le-banner-body"
            dangerouslySetInnerHTML={{ __html: bodyHtml }}
          />
        )}
      </div>
    </div>
  );
}
