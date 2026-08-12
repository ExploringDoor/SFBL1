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
import { provisionCoyblTeam } from "@/lib/provision-team";
import { sendEmail, notifyAddress, esc } from "@/lib/email/send";

export const runtime = "nodejs";

type Kind =
  | "team_registration"
  | "player_registration"
  | "team_waiver"
  | "umpire_evaluation"
  | "alerts_signup"
  | "player_ad"
  | "site_feedback"
  | "player_waiver";

interface SubmissionBody {
  kind: Kind;
  data: Record<string, unknown>;
}

// Per-kind required fields. All fields beyond these are optional and
// stored as-is. Anything not on the union allow-list is dropped to
// keep payloads tight and prevent random bot fields ending up in
// Firestore.
const ALLOWED_FIELDS: Record<Kind, string[]> = {
  // NOT REACHABLE: Doug decided against a digital waiver on 2026-08-06 and
  // /waiver was removed. The kind stays registered so nothing breaks if it is
  // ever brought back, and so any submission made before removal still reads
  // in the admin panel.
  //
  // Parent-signed liability release, one per PLAYER. Distinct from
  // team_waiver, which is SFBL's adult model: one manager signing for a whole
  // roster of over-18s. A parent can only release on behalf of their own
  // child, so this is per player and the signer identifies themselves and
  // their relationship to that child.
  player_waiver: [
    "player_first_name",
    "player_last_name",
    "player_dob",
    "team_name",
    "age_group",
    "parent_first_name",
    "parent_last_name",
    "relationship",
    "email",
    "phone",
    "emergency_name",
    "emergency_phone",
    "medical_notes",
    "signature",
    "signature_date",
    "agreed_to_terms",
  ],
  // "Suggest a change" — anyone using the site can report something broken,
  // confusing, or missing. Name and email are optional on purpose: making
  // people identify themselves is the fastest way to stop hearing about the
  // things they find embarrassing to ask about.
  site_feedback: ["topic", "page", "message", "name", "email", "role"],
  team_registration: [
    "manager_first_name",
    "manager_last_name",
    "email",
    "phone",
    "street_address",
    "address",
    "city",
    "state",
    "zip",
    // COYBL asks for the team's HOME FIELD rather than an unlabelled address
    // (2026-08-02). These must be listed here or they are dropped before the
    // submission is written, and the field never reaches the Fields list.
    "home_field_name",
    "home_field_street",
    "home_field_city",
    "home_field_zip",
    "home_field_maps",
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
    "asst_email",
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
  player_waiver: [
    "player_first_name",
    "player_last_name",
    "player_dob",
    "team_name",
    "parent_first_name",
    "parent_last_name",
    "relationship",
    "email",
    "phone",
    "signature",
    "agreed_to_terms",
  ],
  site_feedback: ["message"],
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
    // age_group is NOT server-required: umpire posts (COYBL's umpire board
    // reuses this kind) legitimately have no age group. Tenants that want it
    // (Island's free-agent form) still require it client-side.
    "message",
    "agreed_to_terms",
  ],
};


/** Collapse an address to the mailbox it actually reaches.
 *
 *  Gmail ignores dots and anything after "+", so h.u.m.at.er.u.fu.q.o.6.4@,
 *  h.u.mat.e.r.u.fu.q.o.6.4@ and humaterufuqo64+x@ are ONE inbox. A bot that
 *  rotates IPs (COYBL saw Tor exit ranges on 2026-08-08) still has to receive
 *  mail somewhere, so the mailbox is the stable identity to limit on when the
 *  IP is not.
 */
function normalizeEmail(raw: unknown): string {
  const e = String(raw ?? "").trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 1) return "";
  let local = e.slice(0, at);
  const domain = e.slice(at + 1);
  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);
  if (domain === "gmail.com" || domain === "googlemail.com") {
    local = local.replace(/\./g, "");
  }
  return `${local}@${domain}`;
}

/** How many submissions this mailbox has already made across ALL form kinds
 *  in the window. Firestore rather than memory: serverless instances do not
 *  share state, and this attacker's whole method is looking like a new
 *  visitor each time. */
async function recentByMailbox(
  db: FirebaseFirestore.Firestore,
  tenantId: string,
  kinds: readonly string[],
  mailbox: string,
  sinceIso: string,
): Promise<number> {
  if (!mailbox) return 0;
  let n = 0;
  for (const k of kinds) {
    try {
      const snap = await db
        .collection(`leagues/${tenantId}/form_submissions/${k}/items`)
        .where("mailbox", "==", mailbox)
        .get();
      n += snap.docs.filter(
        (d) => String(d.data().submitted_at ?? "") >= sinceIso,
      ).length;
    } catch {
      /* a kind with no docs yet is not an error */
    }
  }
  return n;
}

// Leagues where a team registration immediately becomes a real team: the team
// is created, its coach sign-in code minted, the coach's login bound and their
// welcome email sent, without anyone in the office clicking anything.
//
// The trade is that EVERY submission becomes a public team, including tests and
// duplicates, so the office deletes rather than approves. Doug wanted that at
// COYBL ("teams show as soon as they register", 2026-08-02) and Adam asked for
// Island to match it (2026-08-11).
const AUTO_PROVISION_TEAMS = new Set(["coybl", "island"]);

const MAILBOX_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAILBOX_LIMIT = 3;
// Team registrations get their own, far higher ceiling. A club director
// entering four age groups from one address is ordinary, not abuse, and the
// old shared cap of 3 silently threw the fourth team away. Spam is caught by
// the honeypot, the submit-timing check and the per-IP budget; this cap exists
// only to stop a runaway loop.
const MAILBOX_LIMIT_REGISTRATION = 15;

// In-memory rate limiter — fine for single-instance Vercel/Next dev.
// On production with multiple regions, swap to Redis or Edge Config.
const rate = new Map<string, { count: number; reset: number }>();
const RATE_WINDOW_MS = 10 * 60 * 1000;
// Only SUCCESSFUL submissions count toward this (see below), so it is a cap on
// real saved registrations per IP per window, not on attempts. That matters at
// launch: 196 teams register in a burst, coaches retry after validation errors,
// and families / facilities / a director doing several teams can share one IP.
// The old value of 5 counted rejected attempts too and locked such users out.
const RATE_LIMIT = 20;

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
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const parsed = parseHost(host);
  const tenant = await resolveTenant(parsed);
  const tenantId = tenant?.id ?? null;
  if (!tenantId) {
    return NextResponse.json({ error: "no tenant" }, { status: 400 });
  }

  // Rate limit per IP (best-effort).
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const now = Date.now();
  // CHECK ONLY here — do not increment. A rejected attempt (missing field,
  // honeypot, bad JSON) must not burn a legitimate coach's budget, so the
  // counter is bumped only after a real save succeeds (see recordSubmission
  // below). Otherwise a coach who mistypes a few times gets a 429.
  const entry = rate.get(ip);
  if (entry && now < entry.reset && entry.count >= RATE_LIMIT) {
    return NextResponse.json(
      { error: "Too many submissions. Try again in a few minutes." },
      { status: 429 },
    );
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

  // Island: the age group and the league have to be a pairing that exists.
  //
  // This is enforced here and not only in the dropdown because it decides a
  // price. lib/square.ts charges $500 for 8U, which is really the fee for the
  // "8U Weekend League" — the only league 8U plays. A registration posted as
  // 8U + Weeknight is both a league that does not exist and, at $500, a $295
  // hole. The client no longer offers that pairing; this closes the door to a
  // direct POST as well.
  //
  // Unknown age groups pass. A new division Mike adds next season should not
  // start rejecting real coaches because this list is stale.
  if (tenantId === "island" && body.kind === "team_registration") {
    const age = String(cleaned.age_group ?? "").trim();
    const division = String(cleaned.division ?? "").trim();
    const LEAGUES_BY_AGE: Record<string, string[]> = {
      "8U": ["weekend"],
      college: ["weeknight", "weekend"],
    };
    // College does not run in the Fall (Mike, via Adam 2026-08-12), and Fall is
    // the only season currently open. The form no longer offers it; this stops
    // a direct POST taking money for a league nobody is playing.
    if (age === "college") {
      return NextResponse.json(
        {
          error:
            "The College Division does not run in the Fall season. Please contact the league office about Spring and Summer college play.",
        },
        { status: 400 },
      );
    }
    const allowed = LEAGUES_BY_AGE[age];
    if (allowed && division && !allowed.includes(division)) {
      return NextResponse.json(
        {
          error:
            age === "8U"
              ? "8U plays in the 8U Weekend League only. Please select Weekend."
              : "Please choose a league offered for that age group.",
        },
        { status: 400 },
      );
    }
  }

  // Honeypot defense — clients render a hidden "website" field; if a
  // bot fills it, drop the request silently with a 200 so we don't
  // give them a clear "you tripped the trap" signal.
  const honeypot = (body.data as Record<string, unknown>).website;
  if (typeof honeypot === "string" && honeypot.length > 0) {
    return NextResponse.json({ ok: true });
  }

  // The submission write is the whole point of the request, so it gets real
  // error handling. Unwrapped, a transient Firestore failure threw out of the
  // route as a bare 500 and the coach lost a filled-in 17-field registration
  // with no idea whether it had been recorded.
  // Too fast to be a person. A coach fills a registration in tens of seconds;
  // the bot that hit COYBL submitted instantly. Only rejects when the client
  // actually reported a time — a missing value is logged, not blocked, so a
  // cached older page or a non-standard client is never punished for it.
  const formMs = Number((body as unknown as Record<string, unknown>).form_ms);
  if (Number.isFinite(formMs) && formMs >= 0 && formMs < 4000) {
    console.warn(
      `[league-form] submitted in ${formMs}ms (too fast) tenant=${tenantId} kind=${body.kind} ip=${ip} — dropping`,
    );
    return NextResponse.json({ ok: true });
  }
  if (!Number.isFinite(formMs)) {
    console.warn(
      `[league-form] no form_ms tenant=${tenantId} kind=${body.kind} ip=${ip} (direct POST or stale client)`,
    );
  }

  const db = getAdminDb();

  // Same-mailbox flood check.
  //
  // This one hits real people, unlike the honeypot and the timing check, so it
  // gets different treatment on both counts.
  //
  // COUNTING. A cap of 3 across four form kinds is wrong for team
  // registration: one club director enters 10U, 12U, 14U and 16/18U from a
  // single address, and the fourth team vanished. Registrations are counted
  // against registrations only, at a ceiling a real director will not reach.
  //
  // TELLING THE TRUTH. It used to return a bare `{ ok: true }`, so the browser
  // showed a green "Submission received" over a submission that was never
  // saved. Adam hit exactly that testing Island: the success screen appeared,
  // then the payment block had no amount and no Pay button, because there was
  // no registration to quote. A silent 200 is right for a bot, which learns
  // from being told. It is indefensible for a coach, who then believes their
  // team is entered. Honeypot and timing checks keep the silent 200; this one
  // says what happened and who to contact.
  const mailbox = normalizeEmail((cleaned as Record<string, unknown>).email);
  if (mailbox) {
    const isRegistration = body.kind === "team_registration";
    const kinds: Kind[] = isRegistration
      ? ["team_registration"]
      : ["team_registration", "player_registration", "site_feedback", "player_ad"];
    const limit = isRegistration ? MAILBOX_LIMIT_REGISTRATION : MAILBOX_LIMIT;
    const since = new Date(Date.now() - MAILBOX_WINDOW_MS).toISOString();
    const seen = await recentByMailbox(db, tenantId, kinds, mailbox, since);
    if (seen >= limit) {
      console.warn(
        `[league-form] mailbox flood: ${mailbox} already has ${seen} ${kinds.join("/")} in 24h — dropping`,
      );
      return NextResponse.json(
        {
          error: `We already have ${seen} submissions from this email address in the last 24 hours, so this one was not saved. If that is not what you expected, please contact the league office and we will enter it for you.`,
        },
        { status: 429 },
      );
    }
  }

  let ref;
  try {
    ref = await db
      .collection(`leagues/${tenantId}/form_submissions/${body.kind}/items`)
      .add({
        ...cleaned,
        submitted_at: new Date().toISOString(),
        mailbox,
        ip,
        user_agent: h.get("user-agent") ?? null,
      });
    // Count this SUCCESSFUL save against the per-IP rate budget (the check at
    // the top of the handler only reads it). Rejected attempts never reach
    // here, so they don't count.
    const cur = rate.get(ip);
    if (cur && now < cur.reset) cur.count++;
    else rate.set(ip, { count: 1, reset: now + RATE_WINDOW_MS });
  } catch (e) {
    console.error(
      `[league-form] write FAILED tenant=${tenantId} kind=${body.kind}:`,
      e instanceof Error ? e.message : e,
    );
    return NextResponse.json(
      {
        error:
          "We could not save your submission just now. Please try again in a moment. If it keeps failing, contact the league office so we can take it manually.",
      },
      { status: 503 },
    );
  }

  // Best-effort email (no-op unless RESEND_API_KEY/EMAIL_FROM are set):
  //   1. a confirmation to the registrant (if they gave an email)
  //   2. for COYBL team registration: create the coach's login account +
  //      email a "set your password" link so they can manage their team.
  // Fire-and-forget — never blocks or fails the submission.
  const origin =
    h.get("origin") ?? (h.get("host") ? `https://${h.get("host")}` : "");

  // Create the coach's login account NOW (awaited) — fire-and-forget work
  // after the response is killed by the serverless runtime, and account
  // creation must actually happen. Wrapped so an email/auth hiccup never fails
  // the registration itself.
  //
  // This used to read `tenantId === "coybl"`. Island was excluded by that
  // hardcoded check rather than by anyone deciding it should be, and the
  // consequence was invisible until Adam paid a real registration and found
  // there was no way to turn it into a team at all. A coach who registers and
  // pays now gets their team, their sign-in code and their login immediately,
  // the same as COYBL's (Adam, 2026-08-11).
  //
  // The admin's "Create team from this registration" button stays as the
  // fallback: registrations taken before this, and any where provisioning
  // failed, still need a way through.
  const cfgSelf = tenant?.config as { name?: string; abbrev?: string } | undefined;
  const leagueName = cfgSelf?.name ?? "your league";
  const leagueAbbrev = cfgSelf?.abbrev ?? cfgSelf?.name ?? "the league";

  if (
    AUTO_PROVISION_TEAMS.has(tenantId) &&
    body.kind === "team_registration"
  ) {
    // Record whether the coach's login email actually went out. This used to
    // be an empty catch, which is how a Firebase "Domain not allowlisted"
    // error silently ate every login email while registrations looked fine:
    // the coach got an account they could not reach, and nobody could tell.
    // The registration still succeeds either way, but the failure is now
    // visible in the admin inbox instead of invisible everywhere.
    // Create the team FIRST, because that is what mints the sign-in code the
    // coach's welcome email has to contain. Idempotent, and never allowed to
    // fail the registration itself.
    let teamCode: string | null = null;
    try {
      const res = await provisionCoyblTeam(tenantId, ref.id, cleaned);
      teamCode = res.teamCode;
    } catch (err) {
      console.error("[league-form] team provisioning failed", err);
    }

    // Email the coach their team's sign-in code. Recorded either way: this
    // used to be an empty catch, which is how a Firebase "Domain not
    // allowlisted" error silently ate every login email while registrations
    // looked fine. The registration still succeeds regardless, but a failure
    // is now visible in the admin inbox instead of invisible everywhere.
    try {
      await sendCoachCodeEmail(
        cleaned,
        origin,
        teamCode,
        leagueName,
        leagueAbbrev,
        tenantId,
      );
      await ref.set({ login_email_sent: true }, { merge: true });
    } catch (err) {
      const reason = err instanceof Error ? err.message : "unknown error";
      console.error("[league-form] coach code email failed", reason);
      await ref
        .set(
          { login_email_sent: false, login_email_error: reason },
          { merge: true },
        )
        .catch(() => {
          /* flagging is best-effort; never fail the registration over it */
        });
    }
    // Tell the league office a team just registered. This branch used to
    // return without notifying anyone, so the only way the director learned
    // of a registration was to go look in the admin inbox. Best-effort: a
    // failed notification must never fail the coach's registration.
    try {
      const notify = notifyAddress();
      if (notify) {
        const who =
          `${cleaned.manager_first_name ?? ""} ${cleaned.manager_last_name ?? ""}`.trim();
        await sendEmail({
          to: notify,
          subject: `New ${leagueAbbrev} team registration: ${cleaned.team_name || who || "(no name)"}`,
          html:
            `<p><strong>Team:</strong> ${esc(cleaned.team_name)}</p>` +
            `<p><strong>Age group:</strong> ${esc(cleaned.age_group)}</p>` +
            `<p><strong>Coach:</strong> ${esc(who)}</p>` +
            `<p><strong>Email:</strong> ${esc(cleaned.email)}</p>` +
            `<p><strong>Phone:</strong> ${esc(cleaned.phone)}</p>` +
            // "Option" is COYBL's insurance choice. Island never collects it,
            // so the line rendered permanently blank, while the two things
            // Mike actually needs — which league they picked, and the
            // GameChanger link the site pulls schedules from — were missing.
            (cleaned.insurance_option
              ? `<p><strong>Option:</strong> ${esc(cleaned.insurance_option)}` +
                `${cleaned.usssa_addon ? " (USSSA add-on)" : ""}</p>`
              : "") +
            (cleaned.division
              ? `<p><strong>League:</strong> ${esc(cleaned.division)}</p>`
              : "") +
            (cleaned.gamechanger_link
              ? `<p><strong>GameChanger:</strong> ${esc(cleaned.gamechanger_link)}</p>`
              : "") +
            `<p>View it in the admin Registrations tab.</p>`,
        });
        await ref.set({ office_email_sent: true }, { merge: true });
      } else {
        // No EMAIL_NOTIFY configured, so nobody was told. Say so on the
        // record rather than looking like it succeeded.
        await ref.set(
          {
            office_email_sent: false,
            office_email_error: "no notify address configured",
          },
          { merge: true },
        );
      }
    } catch (err) {
      // Same lesson as the coach login email: an empty catch here meant we
      // could not answer "did the office actually get told?" without asking
      // Doug to search his inbox.
      const reason = err instanceof Error ? err.message : "unknown error";
      console.error("[league-form] office notification failed", reason);
      await ref
        .set(
          { office_email_sent: false, office_email_error: reason },
          { merge: true },
        )
        .catch(() => {});
    }
  } else {
    // Other tenants/kinds: best-effort confirmation email, fire-and-forget.
    void sendRegistrationEmails(
      tenantId,
      body.kind,
      cleaned,
      origin,
      leagueName,
      leagueAbbrev,
    ).catch(() => {});
  }

  return NextResponse.json({ ok: true, id: ref.id });
}

// Email a coach the code they type to get into their team page.
//
// Replaces the old "set your password" flow (Adam, 2026-08-04). That created a
// Firebase account and mailed a reset link, which meant a volunteer coach had
// to click through, invent a password, and remember it. A coach and a manager
// are the same person and they get exactly one credential: a 5-digit code.
//
// The league's name is passed in rather than written into the copy. This was
// COYBL-only until Island was added to AUTO_PROVISION_TEAMS, and the first
// Island coach to register got "Welcome to COYBL" from
// noreply@islandfastpitch.com, signed off by the Central Ohio Youth Baseball
// League. Adam caught it on his own test registration minutes after the switch.
async function sendCoachCodeEmail(
  data: Record<string, unknown>,
  origin: string,
  teamCode: string | null,
  leagueName: string,
  leagueAbbrev: string,
  tenantId: string,
): Promise<void> {
  const c = (k: string) =>
    typeof data[k] === "string" ? (data[k] as string).trim() : "";
  const email = c("email");
  if (!email) return;
  const who = [c("manager_first_name"), c("manager_last_name")]
    .filter(Boolean)
    .join(" ");
  const team = c("team_name");
  // The assistant coach gets the code too, which is what the registration form
  // promises them. Deduped in case the same address was typed twice.
  const asst = c("asst_email");
  const recipients = [email];
  if (asst && asst.toLowerCase() !== email.toLowerCase()) recipients.push(asst);

  // No code means provisioning failed upstream. Still confirm the
  // registration, but do not promise a code we cannot supply.
  const codeBlock = teamCode
    ? `<p>Your team's sign-in code is:</p>` +
      `<p style="font:700 34px/1 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.18em;` +
      `background:#f1f4f8;border:1px solid #d3dce7;border-radius:10px;padding:16px 22px;` +
      `display:inline-block;color:#13284a;">${esc(teamCode)}</p>` +
      `<p>Go to <a href="${esc(origin)}/captain">${esc(origin)}/captain</a>, pick ` +
      `<strong>${esc(team) || "your team"}</strong> from the list, and type that code. ` +
      `There is no account to create and no password to remember.</p>` +
      `<p>Keep it to your coaching staff. Anyone with the code can enter scores for your team.</p>`
    : `<p>Your team's sign-in code is being set up. The league office will send ` +
      `it shortly. If you don't hear back in a day or two, just reply here.</p>`;

  for (const to of recipients) {
    await sendEmail({
      to,
      subject: `Welcome to ${leagueAbbrev}${team ? ` — ${team}` : ""}`,
      html:
        `<p>Hi ${esc(who) || "Coach"},</p>` +
        `<p>Thanks for registering${team ? ` <strong>${esc(team)}</strong>` : ""} with ` +
        `${esc(leagueName)}. We've got your registration.</p>` +
        codeBlock +
        // What this lists has to match the tabs app/captain/page.tsx actually
        // renders for the tenant. "Log pitch counts" was promised to every
        // league, but that tab is filtered to COYBL only and Island's config
        // sets show_pitch_counts:false — so an Island coach was told to use a
        // feature that is not on their screen. Adam caught it reading the
        // email copy (2026-08-12). Pitch counts are a Little League baseball
        // rule; this is girls fastpitch.
        `<p>From there you can ${
          tenantId === "coybl"
            ? "post your games, enter scores, log pitch counts, and upload your team logo"
            : "submit your scores, manage your roster and attendance, and upload your team logo"
        }.</p>` +
        `<p>A league director will confirm your division shortly. Questions? Just reply to this email.</p>` +
        `<p>— ${esc(leagueAbbrev)}</p>`,
      replyTo: notifyAddress() ?? undefined,
    });
  }
}

async function sendRegistrationEmails(
  tenantId: string,
  kind: Kind,
  data: Record<string, unknown>,
  origin: string,
  leagueName: string,
  leagueAbbrev: string,
): Promise<void> {
  // Site feedback goes to ADAM, not the league office (Adam, 2026-08-04).
  // Doug triages these in the admin panel and does not need an inbox for
  // them; Adam does, because "the standings page is broken" is his to fix.
  //
  // Address is env-overridable so it can move without a deploy. Falls back to
  // the same address the captain Help tab has always used for him.
  if (kind === "site_feedback") {
    const to =
      process.env.SITE_FEEDBACK_NOTIFY || "adam.mainlinewebdesign@gmail.com";
    const f = (k: string) =>
      typeof data[k] === "string" ? (data[k] as string).trim() : "";
    const from = f("email");
    await sendEmail({
      to,
      subject: `${leagueAbbrev} site feedback: ${f("topic") || "suggestion"}`,
      html:
        `<p><strong>${esc(f("topic") || "Feedback")}</strong>` +
        ` &middot; ${esc(leagueName)}</p>` +
        (f("page") ? `<p><strong>Page:</strong> ${esc(f("page"))}</p>` : "") +
        `<p style="white-space:pre-wrap">${esc(f("message"))}</p>` +
        `<hr style="border:none;border-top:1px solid #ddd">` +
        `<p style="color:#555;font-size:13px">` +
        `From: ${esc(f("name") || "anonymous")}` +
        (from ? ` &lt;${esc(from)}&gt;` : " (no email left)") +
        (f("role") ? ` &middot; ${esc(f("role"))}` : "") +
        `</p>` +
        `<p style="color:#555;font-size:13px">` +
        `Also in the admin panel under Form submissions &rarr; Site feedback.` +
        `</p>`,
      // Reply lands on whoever wrote in, when they said who they are.
      replyTo: from || undefined,
    });
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
    kind === "player_registration"
      ? "Player registration"
      : "Team registration";

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
