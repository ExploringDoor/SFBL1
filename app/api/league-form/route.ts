// Unified intake endpoint for the four public-facing league forms:
//   - team_registration  → leagues/{tid}/form_submissions/team_registration/{auto}
//   - player_registration→ leagues/{tid}/form_submissions/player_registration/{auto}
//   - team_waiver        → leagues/{tid}/form_submissions/team_waiver/{auto}
//   - umpire_evaluation  → leagues/{tid}/form_submissions/umpire_evaluation/{auto}
//
// Why one endpoint instead of four: the four forms differ only in
// which fields are required + the storage subcollection. The shape
// of the request (kind + payload), the validation pattern (require
// known fields, drop everything else), and the storage model are
// identical. One endpoint = one place to add rate limiting / notify
// / spam protection later.
//
// PII handling: full payload (incl. email/phone) is stored in the
// kind subcollection. Admin pulls it via /api/admin-form-submissions
// (later). For now Adam reviews these manually in the Firestore
// console.
//
// Rate limit: light, per-IP, 5 submissions / 10 min. Anything more
// gets 429. Bots filling all four forms in a tight loop get cut.

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import { headers } from "next/headers";
import { parseHost, resolveTenant } from "@/lib/tenants";
import { sendEmail, notifyAddress, esc } from "@/lib/email/send";

export const runtime = "nodejs";

type Kind =
  | "team_registration"
  | "player_registration"
  | "team_waiver"
  | "umpire_evaluation"
  | "alerts_signup"
  | "player_ad";

interface SubmissionBody {
  kind: Kind;
  data: Record<string, unknown>;
}

// Per-kind required fields. All fields beyond these are optional and
// stored as-is. Anything not on the union allow-list is dropped to
// keep payloads tight and prevent random bot fields ending up in
// Firestore.
const ALLOWED_FIELDS: Record<Kind, string[]> = {
  team_registration: [
    "manager_first_name",
    "manager_last_name",
    "email",
    "phone",
    "street_address",
    "city",
    "zip",
    "team_name",
    "division",
    // COYBL (youth) fields — age group instead of division, the
    // registration option ($495/$425) + USSSA add-on, club/org, and the
    // GameChanger schedule link.
    "age_group",
    "insurance_option",
    "usssa_addon",
    "organization",
    "gamechanger_link",
    "team_logo",
    "county",
    "asst_first_name",
    "asst_last_name",
    "asst_phone",
    "agreed_to_terms",
    "notes",
  ],
  player_registration: [
    "first_name",
    "last_name",
    "phone",
    "email",
    "city",
    "dob",
    "age",
    "primary_position",
    "secondary_position",
    "division",
    "county",
    "team_name",
    "free_agent",
    "agreed_to_terms",
    "notes",
  ],
  team_waiver: [
    "team_name",
    "manager_first_name",
    "manager_last_name",
    "email",
    "phone",
    "season",
    "signature",
    "signature_date",
    "agreed_to_waiver",
  ],
  umpire_evaluation: [
    "evaluator_name",
    "team_affiliation",
    "phone",
    "game_date",
    "game_time",
    "field",
    "visiting_team",
    "home_team",
    "plate_umpire_name",
    "plate_umpire_rating",
    "plate_umpire_comments",
    "field_umpire_name",
    "field_umpire_rating",
    "field_umpire_comments",
    "general_comments",
  ],
  alerts_signup: [
    "name",
    "email",
    "phone",
    "age_group",
    "notify_by",
    "agreed_to_alerts",
  ],
  // Player Ads — the on-site replacement for Island's Facebook group.
  // SPLIT BY VISIBILITY, and the split is enforced downstream in
  // /api/admin-player-ads, which builds the public doc from PUBLIC_AD_FIELDS
  // only. Nothing here is public until an admin approves it.
  //   private: contact_name, email, phone  (never copied to the public doc)
  //   public : posted_by, age_group, position, town, team_name, message
  player_ad: [
    "posted_by",
    "contact_name",
    "email",
    "phone",
    "age_group",
    "position",
    "town",
    "team_name",
    "message",
    "agreed_to_terms",
  ],
};

const REQUIRED: Record<Kind, string[]> = {
  team_registration: [
    // division/age_group are validated client-side per tenant (SFBL uses
    // division, COYBL uses age_group), so they're not server-required here.
    "manager_first_name",
    "manager_last_name",
    "email",
    "phone",
    "team_name",
    "agreed_to_terms",
  ],
  player_registration: [
    "first_name",
    "last_name",
    "phone",
    "email",
    "dob",
    "primary_position",
    "division",
    "agreed_to_terms",
  ],
  team_waiver: [
    "team_name",
    "manager_first_name",
    "manager_last_name",
    "email",
    "signature",
    "agreed_to_waiver",
  ],
  umpire_evaluation: [
    "evaluator_name",
    "team_affiliation",
    "game_date",
    "visiting_team",
    "home_team",
  ],
  alerts_signup: ["email", "agreed_to_alerts"],
  player_ad: [
    "posted_by",
    "contact_name",
    "email",
    "age_group",
    "message",
    "agreed_to_terms",
  ],
};

// In-memory rate limiter — fine for single-instance Vercel/Next dev.
// On production with multiple regions, swap to Redis or Edge Config.
const rate = new Map<string, { count: number; reset: number }>();
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = 5;

function pickAllowed(
  kind: Kind,
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const allow = new Set(ALLOWED_FIELDS[kind]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (allow.has(k)) out[k] = v;
  }
  return out;
}

export async function POST(req: Request) {
  const h = headers();
  // Resolve the tenant from the request Host header. Middleware is
  // intentionally excluded for /api/* (see PRELAUNCH_AUDIT Fix #2),
  // so the `x-tenant-id` header middleware injects on page routes
  // is NEVER present here. Same pattern as /api/schedule.ics.
  const host =
    h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const parsed = parseHost(host);
  const tenant = await resolveTenant(parsed);
  const tenantId = tenant?.id ?? null;
  if (!tenantId) {
    return NextResponse.json({ error: "no tenant" }, { status: 400 });
  }

  // Rate limit per IP (best-effort).
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const now = Date.now();
  const entry = rate.get(ip);
  if (entry && now < entry.reset) {
    if (entry.count >= RATE_LIMIT) {
      return NextResponse.json(
        { error: "Too many submissions. Try again in a few minutes." },
        { status: 429 },
      );
    }
    entry.count++;
  } else {
    rate.set(ip, { count: 1, reset: now + RATE_WINDOW_MS });
  }

  let body: SubmissionBody;
  try {
    body = (await req.json()) as SubmissionBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  if (!body.kind || !ALLOWED_FIELDS[body.kind]) {
    return NextResponse.json(
      { error: `unknown form kind: ${body.kind}` },
      { status: 400 },
    );
  }
  if (!body.data || typeof body.data !== "object") {
    return NextResponse.json({ error: "missing data" }, { status: 400 });
  }

  const cleaned = pickAllowed(body.kind, body.data);

  // Required-field check.
  const missing = REQUIRED[body.kind].filter(
    (f) => cleaned[f] == null || cleaned[f] === "",
  );
  if (missing.length > 0) {
    return NextResponse.json(
      {
        error: `Missing required field${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`,
      },
      { status: 400 },
    );
  }

  // Honeypot defense — clients render a hidden "website" field; if a
  // bot fills it, drop the request silently with a 200 so we don't
  // give them a clear "you tripped the trap" signal.
  const honeypot = (body.data as Record<string, unknown>).website;
  if (typeof honeypot === "string" && honeypot.length > 0) {
    return NextResponse.json({ ok: true });
  }

  const db = getAdminDb();
  const ref = await db
    .collection(`leagues/${tenantId}/form_submissions/${body.kind}/items`)
    .add({
      ...cleaned,
      submitted_at: new Date().toISOString(),
      ip,
      user_agent: h.get("user-agent") ?? null,
    });

  // Best-effort email (no-op unless RESEND_API_KEY/EMAIL_FROM are set):
  //   1. a confirmation to the registrant (if they gave an email)
  //   2. for COYBL team registration: create the coach's login account +
  //      email a "set your password" link so they can manage their team.
  // Fire-and-forget — never blocks or fails the submission.
  const origin =
    h.get("origin") ?? (h.get("host") ? `https://${h.get("host")}` : "");

  // COYBL: create the coach's login account NOW (awaited) — fire-and-forget
  // work after the response is killed by the serverless runtime, and account
  // creation must actually happen. Wrapped so an email/auth hiccup never fails
  // the registration itself.
  if (tenantId === "coybl" && body.kind === "team_registration") {
    try {
      await createCoachLogin(cleaned, origin);
    } catch {
      /* registration still succeeds even if the login email can't be sent */
    }
  } else {
    // Other tenants/kinds: best-effort confirmation email, fire-and-forget.
    const cfg = tenant?.config as
      | { name?: string; abbrev?: string }
      | undefined;
    void sendRegistrationEmails(
      tenantId,
      body.kind,
      cleaned,
      origin,
      cfg?.name ?? "your league",
      cfg?.abbrev ?? cfg?.name ?? "the league",
    ).catch(() => {});
  }

  return NextResponse.json({ ok: true, id: ref.id });
}

// Create (or reuse) the coach's Firebase account for their COYBL team and
// email a "set your password" link (with the confirmation). The team is
// placed into a division by a director later; an admin then binds the coach's
// account to the team (captain claim). Email no-ops unless RESEND is set — but
// the account + link are still created either way.
async function createCoachLogin(
  data: Record<string, unknown>,
  origin: string,
): Promise<void> {
  const c = (k: string) =>
    typeof data[k] === "string" ? (data[k] as string).trim() : "";
  const email = c("email");
  if (!email) return;
  const who = `${c("manager_first_name")} ${c("manager_last_name")}`.trim();
  const team = c("team_name");

  const auth = getAdminAuth();
  try {
    await auth.getUserByEmail(email);
  } catch {
    try {
      await auth.createUser({ email }); // no password yet — set via the link
    } catch {
      return; // invalid email etc.
    }
  }

  let link = "";
  try {
    link = await auth.generatePasswordResetLink(
      email,
      origin ? { url: `${origin}/login` } : undefined,
    );
  } catch {
    return;
  }

  await sendEmail({
    to: email,
    subject: `Welcome to COYBL — set up your ${team || "team"} login`,
    html:
      `<p>Hi ${esc(who) || "Coach"},</p>` +
      `<p>Thanks for registering${team ? ` <strong>${esc(team)}</strong>` : ""} with the Central Ohio Youth Baseball League — we've got your registration.</p>` +
      `<p>Set your password to access your team portal, where you can enter scores, log pitch counts, upload your team logo, and manage your schedule:</p>` +
      `<p><a href="${esc(link)}" style="display:inline-block;padding:10px 18px;background:#13284a;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;">Set your password</a></p>` +
      `<p style="font-size:13px;color:#555;">Or paste this into your browser:<br>${esc(link)}</p>` +
      `<p>A league director will confirm your division shortly. Questions? Just reply to this email.</p>` +
      `<p>— COYBL</p>`,
    replyTo: notifyAddress() ?? undefined,
  });
}

async function sendRegistrationEmails(
  tenantId: string,
  kind: Kind,
  data: Record<string, unknown>,
  origin: string,
  leagueName: string,
  leagueAbbrev: string,
): Promise<void> {
  // COYBL team registration → create the coach's own-login account and
  // email a "set your password" link (plus the confirmation) in one go.
  if (tenantId === "coybl" && kind === "team_registration") {
    await createCoachLogin(data, origin);
    return;
  }
  if (kind !== "player_registration" && kind !== "team_registration") return;

  const c = (k: string) =>
    typeof data[k] === "string" ? (data[k] as string).trim() : "";
  const who =
    kind === "player_registration"
      ? `${c("first_name")} ${c("last_name")}`.trim()
      : `${c("manager_first_name")} ${c("manager_last_name")}`.trim();
  const email = c("email");
  const team = c("team_name");
  const division = c("division");
  const label =
    kind === "player_registration" ? "Player registration" : "Team registration";

  // 1) Confirmation to the registrant.
  if (email) {
    await sendEmail({
      to: email,
      subject: `We got your ${leagueAbbrev} registration`,
      html:
        `<p>Hi ${esc(who) || "there"},</p>` +
        `<p>Thanks for registering with ${esc(leagueName)}. ` +
        `We've received your ${esc(label.toLowerCase())} and the league ` +
        `office will follow up with payment and roster details.</p>` +
        (division ? `<p><strong>Division:</strong> ${esc(division)}</p>` : "") +
        (team ? `<p><strong>Team:</strong> ${esc(team)}</p>` : "") +
        `<p>Questions? Reply to this email or text the league office.</p>` +
        `<p>— ${esc(leagueAbbrev)}</p>`,
      replyTo: notifyAddress() ?? undefined,
    });
  }

  // 2) Heads-up to the league office.
  const notify = notifyAddress();
  if (notify) {
    await sendEmail({
      to: notify,
      subject: `New ${label}: ${who || "(no name)"}`,
      html:
        `<p><strong>${esc(label)}</strong></p>` +
        `<p>Name: ${esc(who) || "—"}<br/>` +
        `Email: ${esc(email) || "—"}<br/>` +
        (division ? `Division: ${esc(division)}<br/>` : "") +
        (team ? `Team: ${esc(team)}<br/>` : "") +
        `</p><p>See it in Admin → Form intake.</p>`,
      replyTo: email || undefined,
    });
  }
}
