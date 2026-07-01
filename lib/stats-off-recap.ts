// Resolve the recap for a stats-off game (COYBL), server-side.
//
// Precedence:
//   1. An existing /recaps/{gameId} doc — an admin/captain override OR a
//      previously-cached AI recap. Reused as-is (never regenerated).
//   2. A freshly generated AI recap — cached to /recaps/{gameId} with
//      source:"ai" so subsequent views are instant.
//   3. A deterministic template recap — used when no API key is set.
//      NOT cached, so the recap upgrades to AI automatically once an
//      ANTHROPIC_API_KEY is configured.
//
// Writing the cache during a GET render is a deliberate lazy-populate:
// the Admin SDK write bypasses security rules, and it only runs when no
// recap doc exists yet.

import { getAdminDb } from "@/lib/firebase-admin";
import { markdownToHtml } from "@/lib/markdown";
import {
  generateAiRecap,
  shortTemplateRecap,
  type ShortRecapInput,
} from "@/lib/ai-recap";

export interface ResolvedRecap {
  html: string;
  markdown: string;
  source: "override" | "ai" | "template";
}

export async function getStatsOffRecap(
  tenantId: string,
  gameId: string,
  input: ShortRecapInput,
): Promise<ResolvedRecap> {
  const db = getAdminDb();
  const ref = db.doc(`leagues/${tenantId}/recaps/${gameId}`);

  const snap = await ref.get();
  if (snap.exists) {
    const d = snap.data() ?? {};
    const markdown = typeof d.markdown === "string" ? d.markdown : "";
    const html =
      typeof d.html === "string" && d.html
        ? d.html
        : markdown
          ? markdownToHtml(markdown)
          : "";
    if (html) {
      return { html, markdown, source: d.source === "ai" ? "ai" : "override" };
    }
  }

  // No recap yet — try AI and cache it.
  const ai = await generateAiRecap(input);
  if (ai) {
    const html = markdownToHtml(ai);
    await ref
      .set(
        {
          markdown: ai,
          html,
          source: "ai",
          updated_at: new Date().toISOString(),
          updated_by_role: "ai",
        },
        { merge: true },
      )
      .catch(() => {
        /* cache write is best-effort; still render the recap */
      });
    return { html, markdown: ai, source: "ai" };
  }

  // Fallback: template recap (not cached — upgrades to AI once a key is
  // configured and the game is viewed again).
  const md = shortTemplateRecap(input);
  return { html: markdownToHtml(md), markdown: md, source: "template" };
}
