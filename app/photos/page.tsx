// Public photo gallery — server-rendered grid of photos uploaded
// via the admin Photos tab. Each photo has an optional caption and
// taken_at date.

import { headers } from "next/headers";
import { getAdminDb } from "@/lib/firebase-admin";
import "./photos.css";

export const dynamic = "force-dynamic";

export default async function PhotosPage() {
  const tenantId = headers().get("x-tenant-id");
  if (!tenantId) {
    return (
      <main className="container py-12">
        <p>No tenant.</p>
      </main>
    );
  }

  const snap = await getAdminDb()
    .collection(`leagues/${tenantId}/photos`)
    .get();
  const photos = snap.docs
    .map((d) => {
      const data = d.data();
      return {
        id: d.id,
        image_data_url: String(data.image_data_url ?? ""),
        caption: String(data.caption ?? ""),
        taken_at:
          typeof data.taken_at === "string" ? data.taken_at : null,
        uploaded_at:
          typeof data.uploaded_at === "string" ? data.uploaded_at : "",
        hidden: data.hidden === true,
      };
    })
    .filter((p) => !p.hidden && p.image_data_url)
    .sort((a, b) => {
      // Newest first by taken_at then uploaded_at
      const at = a.taken_at || a.uploaded_at;
      const bt = b.taken_at || b.uploaded_at;
      return at < bt ? 1 : at > bt ? -1 : 0;
    });

  return (
    <main className="le-photos">
      <header className="le-photos-header">
        <h1>Photos</h1>
        <p>{photos.length} photo{photos.length === 1 ? "" : "s"}</p>
      </header>

      {photos.length === 0 ? (
        <div className="le-photos-empty">
          <div aria-hidden style={{ fontSize: 56, lineHeight: 1, marginBottom: 12 }}>
            📷
          </div>
          <strong style={{ fontSize: 18, color: "var(--text-strong)" }}>
            No photos yet
          </strong>
          <p style={{ fontSize: 14, color: "var(--muted)", margin: "6px 0 0", lineHeight: 1.5 }}>
            Got a great team or game-day shot? Send it to{" "}
            <a href="mailto:playball@sfbl.com" style={{ color: "var(--brand-primary)", fontWeight: 600 }}>
              playball@sfbl.com
            </a>{" "}
            and we&rsquo;ll add it to the gallery.
          </p>
        </div>
      ) : (
        <div className="le-photos-grid">
          {photos.map((p) => (
            <figure key={p.id} className="le-photo">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.image_data_url}
                alt={p.caption || "Game photo"}
                loading="lazy"
              />
              {(p.caption || p.taken_at) && (
                <figcaption>
                  {p.caption}
                  {p.taken_at && (
                    <span className="le-photo-date">
                      {p.caption ? " · " : ""}
                      {new Date(p.taken_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </span>
                  )}
                </figcaption>
              )}
            </figure>
          ))}
        </div>
      )}
    </main>
  );
}
