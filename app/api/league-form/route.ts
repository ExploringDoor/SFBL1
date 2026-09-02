// Unified intake endpoint for the four public-facing league forms:
//   - team_registration  → leagues/{tid}/form_submissions/team_registration/{auto}
//   - player_registration→ leagues/{tid}/form_submissions/player_registration/{auto}
//   - team_waiver        → leagues/{tid}/form_submissions/team_waiver/{auto}
//   - umpire_evaluation  → leagues/{tid}/form_submissions/umpire_evaluation/{auto}
//   - coach_evaluation   → leagues/{tid}/form_submissions/coach_evaluation/{auto}
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
import {
  sendEmail,
  notifyAddress,
  notifyAddresses,
  notifyOffice,
  esc,
} from "@/lib/email/send";
import { coachCodeEmail, officeRegistrationEmail } from "@/lib/email/templates";
import { isPhoneField, normalizePhone } from "@/lib/phone";

export const runtime = "nodejs";

// Capacity, the date and the phone number come from lib/clinic so the page,
// the popup and this check can never disagree about them.
import { CLINIC, clinicIsOver } from "@/lib/clinic";
import { paidClinicPlaces } from "@/lib/clinic-count";
import { paymentDetailsFor } from "@/lib/league-payment";
const CLINIC_CAPACITY = CLINIC.capacity;

type Kind =
  | "team_registration"
  | "player_registration"
  | "team_waiver"
  | "umpire_evaluation"
  | "coach_evaluation"
  | "alerts_signup"
  | "player_ad"
  | "site_feedback"
  | "player_waiver"
  | "clinic_registration"
  | "umpire_registration"
  | "tournament_registration"
  | "baseball_order";

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
  // College Clinic, 2026-10-12. One PLAYER per submission, $175 each, capped
  // at 40. Grad year and high school are in here because the point of the day
  // is college coaches watching, and a recruiter's first two questions are
  // what position and what year.
  // COYBL umpire registration. Doug's own form is at
  // coybl.sportngin.com/register/form/123104747 and re-runs EVERY YEAR: "Umpires
  // must register each year." Free to register, and a current OHSAA license is
  // a separate requirement he states on the welcome page.
  //
  // Field names mirror the league's umpire roster (name / level / email /
  // phone in components/admin/UmpiresManager.tsx) so a registration can be
  // promoted onto the roster without a translation layer.
  // COYBL's own tournaments. ONE kind for all of them, with `tournament`
  // naming which — Doug runs "a couple of small" ones and adds to the list, and
  // a kind per event would mean seven allow-lists and an admin tab every time.
  tournament_registration: [
    "tournament",
    "team_name",
    "team_age",
    "first_name",
    "last_name",
    "email",
    "phone",
    "payment_preference",
    "not_travel_team",
    "notes",
    "agreed_to_terms",
  ],
  // Rawlings baseballs, sold by the dozen. Address fields are here because he
  // ships: they are the delivery address, not profile data.
  baseball_order: [
    "first_name",
    "last_name",
    "email",
    "phone",
    "team_name",
    "team_age",
    "address",
    "city",
    "state",
    "zip",
    "dozens",
    "ship_to_home",
    "payment_preference",
    "notes",
    "agreed_to_terms",
  ],
  umpire_registration: [
    "first_name",
    "last_name",
    "email",
    "phone",
    "address",
    "city",
    "state",
    "zip",
    "level",
    "ohsaa_licensed",
    "ohsaa_number",
    "years_experience",
    "age_groups",
    "travel_radius",
    "shirt_size",
    "emergency_name",
    "emergency_phone",
    "notes",
    "agreed_to_terms",
  ],
  clinic_registration: [
    "player_first_name",
    "player_last_name",
    "age_group",
    "grad_year",
    "high_school",
    "current_team",
    "primary_position",
    "secondary_position",
    "parent_first_name",
    "parent_last_name",
    "email",
    "phone",
    "notes",
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
    // Island's yes/no home-field claim (the $200 discount the office confirms).
    // Anything not on this list is dropped before the submission is written,
    // so a field the form collects but this omits vanishes silently.
    "home_field",
    "home_field_name",
    "home_field_street",
    "home_field_city",
    "home_field_zip",
    "home_field_maps",
    "team_name",
    "division",
    // UCSL (adult coed softball) — captain lists the player roster as free
    // text (one player per line). Additive: no other tenant sends this field.
    "roster",
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
    // Windmill Fastpitch (youth fastpitch): rec/club lead contacts, skill
    // level, home-field address, and scheduling requests. Team-level only —
    // no player/minor data. Not on this list = dropped before the write.
    "new_or_returning_team",
    "new_or_returning_coach",
    "lead_name",
    "lead_phone",
    "lead_email",
    "level",
    "age_or_grade",
    "experience",
    "home_field_address",
    "blackout_dates",
    "home_date_requests",
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
  coach_evaluation: [
    "evaluator_name",
    "evaluator_role",
    "phone",
    "game_date",
    "game_time",
    "field",
    "visiting_team",
    "home_team",
    "coach_name",
    "coach_team",
    "sportsmanship_rating",
    "rules_rating",
    "players_rating",
    "officials_rating",
    "coach_comments",
    "incident",
    "incident_details",
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
  // Enough to invoice a team and chase them. Everything else is optional.
  tournament_registration: [
    "tournament",
    "team_name",
    "team_age",
    "first_name",
    "last_name",
    "email",
    "phone",
  ],
  // `dozens` is required and minimum 2, matching his form. An order with no
  // quantity is not an order, and the page enforces the minimum too.
  baseball_order: [
    "first_name",
    "last_name",
    "email",
    "phone",
    "dozens",
  ],
  // Deliberately short. Doug's stated purpose is "to send updates and info to
  // you and to contact you in case of an issue at a COYBL event", so the only
  // hard requirements are who you are and how to reach you. Everything else
  // helps him assign games and is optional, because a half-filled registration
  // from a real umpire beats a bounced one.
  umpire_registration: [
    "first_name",
    "last_name",
    "email",
    "phone",
    "agreed_to_terms",
  ],
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
  clinic_registration: [
    "player_first_name",
    "player_last_name",
    "age_group",
    "grad_year",
    "primary_position",
    "parent_first_name",
    "parent_last_name",
    "email",
    "phone",
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
  coach_evaluation: [
    "evaluator_name",
    "game_date",
    "visiting_team",
    "home_team",
    "coach_name",
    "coach_team",
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

// How long a submitter waits on the mail before we give up on it.
//
// Vercel freezes the lambda the moment the response is returned, so anything
// not awaited here may simply never be sent. Waiting is the only way to be
// sure, and this cap is the price: a hung provider costs eight seconds and a
// recorded failure, never a submit button that spins forever.
const MAIL_TIMEOUT_MS = 8000;

// Kinds whose mail is sent BEFORE the response and stamped on the document.
//
// player_registration and non auto provision team_registration are NOT in
// here, and the reason is volume, not size. They run the same one
// confirmation plus N office sends as team_waiver, so awaiting them would be
// no slower per submission. What stops it is LCYBL, where 185 teams register
// in a burst and every added second is paid 185 times, and it is 23 days to
// the season. They stay on the fire and forget path below until that can be
// measured rather than guessed. COYBL's and Island's team registrations are
// already awaited and recorded in their own branch above.
const MAIL_RECORDED_KINDS = new Set<Kind>([
  "site_feedback",
  "clinic_registration",
  "team_waiver",
  "umpire_evaluation",
  "coach_evaluation",
  "player_ad",
  "alerts_signup",
  // The three COYBL forms added 2026-08-27. Left off this list when they were
  // built, so they took the fire-and-forget path the comment above warns
  // about, and none of them stamped a flag saying whether the mail went.
  //
  // Found on 2026-08-31 by a real order: Rhonda Hare submitted FIFTY DOZEN
  // baseballs, $2,600, on 28 August, and the document carries no mail flags at
  // all — so there is no way to tell whether Doug was ever told about it.
  //
  // Safe to await, for exactly the reason the comment gives: nobody submits an
  // umpire registration, a tournament entry or a baseball order in bulk. These
  // are the forms where a lost notification costs the most, because unlike a
  // team registration there is no ledger row or roster that would surface the
  // submission anywhere else.
  "umpire_registration",
  "tournament_registration",
  "baseball_order",
]);

// What actually went out, merged onto the submission so a failed send is
// visible in the admin inbox instead of nowhere at all. The names match
// login_email_sent / office_email_sent on a team registration so the office
// reads one vocabulary across every form.
//
// Only ever built with DEFINED values: the Admin SDK here is not initialised
// with ignoreUndefinedProperties, so a stray `undefined` throws on write and
// would take the flag write down with it.
interface MailFlags {
  confirmation_email_sent?: boolean;
  confirmation_email_error?: string;
  office_email_sent?: boolean;
  office_email_error?: string;
  office_email_to?: string;
}

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
    if (!allow.has(k)) continue;
    // TRIM EVERY STRING ON THE WAY IN. Phone keyboards and autofill both leave
    // a trailing space, and a stored one is invisible everywhere it is
    // displayed while quietly breaking every exact match against it. Island
    // 2026-08-22: 38 fields across 20 records, including team_name
    // "Lindenhurst Bulldogs " and a clinic registrant stored as "Alyssa ",
    // whose name then rendered as "Alyssa  Schroeder" with two spaces on a
    // card statement. Looking a team up by name simply missed.
    //
    // ENDS ONLY, never internal runs. Two of these records are `notes` fields
    // carrying real line breaks, "Please include Jackie Barth on
    // notifications... \nCell 631-807-3961\nemail ...", and collapsing
    // whitespace would flatten a coach's message into one line.
    //
    // Ordering note: this runs before the REQUIRED check below, which already
    // trims before testing, so a whitespace-only answer fails exactly as it
    // did before. Nothing else changes.
    out[k] = typeof v === "string" ? v.trim() : v;
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

  // PHONE NUMBERS: checked, and stored in one shape.
  //
  // These were free text. Alyssa Schroeder's clinic registration on
  // 2026-08-19 stored an 11-digit number that was neither a 10-digit number
  // nor a country code plus one, and it will not dial. The single purpose of
  // this field is letting the league ring a parent.
  //
  // Refused rather than flagged, which is the opposite of the bot checks
  // below, and the difference is who is standing there: a bad number is
  // caught while the person still has the form open and can fix it in five
  // seconds. A dropped submission is a customer lost.
  //
  // Empty optional fields are left alone; the required-field check owns those.
  for (const key of Object.keys(cleaned)) {
    if (!isPhoneField(key)) continue;
    const raw = cleaned[key];
    if (raw == null || String(raw).trim() === "") continue;
    const r = normalizePhone(raw);
    if (!r.ok) {
      return NextResponse.json(
        { error: `${r.reason} (${key.replace(/_/g, " ")})` },
        { status: 400 },
      );
    }
    // Stored normalised, so every number in the admin and every CSV export
    // reads the same way regardless of how it was typed.
    cleaned[key] = r.value;
  }

  // Required-field check.
  // Trimmed, because a required field that accepts " " is not required. Every
  // required free-text field on these forms has always had this hole, the
  // signature on the team waiver included; nothing trims on the way in (see
  // pickAllowed above). Turning the team dropdowns into text inputs for a
  // tenant hiding its roster just made it easier to reach.
  const missing = REQUIRED[body.kind].filter(
    (f) => cleaned[f] == null || String(cleaned[f]).trim() === "",
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

  // ---- bot signals: FLAG, never silently drop -----------------------------
  //
  // Both of these used to `return NextResponse.json({ ok: true })` and throw
  // the submission away. A 200 is exactly what makes the client print
  // "Submission received", so a real coach saw a green tick, believed they
  // were registered, and nothing existed. That happened: LI Rebels Blue 12U
  // on 2026-08-17 sent a screenshot of the success screen and had no record
  // anywhere. It cost an evening to find because the site said yes.
  //
  // Neither signal is trustworthy enough to destroy a registration on:
  //
  //   (a honeypot field lived here until 2026-09-01. Removed: 0 bots, 9 real
  //    people. See components/forms/LeagueForm.tsx for the measurement.)
  //             autoComplete="off" is advisory and Chrome and every password
  //             manager ignore it. A coach with 1Password fills it without
  //             ever seeing it.
  //   too fast  under four seconds. That is a bot, or it is anyone whose
  //             browser autofilled the form in one click — which is most
  //             likely on a SECOND registration, when every field is already
  //             remembered.
  //
  // So they are recorded on the document and surfaced to the office instead.
  // A junk registration takes one click to delete. A silently discarded real
  // one costs a paying customer and the league's credibility.
  const spamFlags: string[] = [];

  // Both names. `website` was the old field and a cached page can still be
  // open in somebody's browser mid-registration; reading only the new name
  // would quietly stop checking those. Drop `website` once no stale client
  // can plausibly be live.
  // Honeypot check removed 2026-09-01. It caught 0 bots and 9 real people
  // across six weeks; the timing check below caught all 165 bots by itself.
  // See the note in components/forms/LeagueForm.tsx for the full measurement.

  // The submission write is the whole point of the request, so it gets real
  // error handling. Unwrapped, a transient Firestore failure threw out of the
  // route as a bare 500 and the coach lost a filled-in 17-field registration
  // with no idea whether it had been recorded.
  // Too fast to be a person. A coach fills a registration in tens of seconds;
  // the bot that hit COYBL submitted instantly. Only rejects when the client
  // actually reported a time — a missing value is logged, not blocked, so a
  // cached older page or a non-standard client is never punished for it.
  // TWO THRESHOLDS, not one, and the gap between them is the whole design.
  //
  // Under CERTAIN_BOT_MS nothing human is possible. A coach fills seventeen
  // fields; a clinic parent fills fourteen. Measured across Island's first 27
  // flagged submissions the SLOWEST bot was 722ms and the median was 255ms,
  // while every genuine submission ran to tens of seconds. 1500ms leaves
  // roughly double the headroom over the worst bot ever seen here and is still
  // an order of magnitude under a real person.
  //
  // Between the two it is a judgement call, so it stays a flag: saved, mailed
  // to the office as NEEDS REVIEW, and a human decides.
  const CERTAIN_BOT_MS = 1500;
  const formMs = Number((body as unknown as Record<string, unknown>).form_ms);
  if (Number.isFinite(formMs) && formMs >= 0 && formMs < 4000) {
    console.warn(
      `[league-form] submitted in ${formMs}ms (too fast) tenant=${tenantId} kind=${body.kind} ip=${ip} — FLAGGING, not dropping`,
    );
    spamFlags.push(`too_fast_${Math.round(formMs)}ms`);
  }
  // Quarantined, NOT dropped. The document is still written in full and can be
  // read in the admin's Spam filter, because the promise not to silently
  // discard a real person still holds and always will. What it does not do is
  // reach the office: 27 of these arrived in six days from 19 different IPs,
  // across all five public forms, and the cost of that is not the junk itself.
  // It is Mike learning to delete anything that looks automated, on the day a
  // real coach lands in the same pile.
  const certainBot =
    Number.isFinite(formMs) && formMs >= 0 && formMs < CERTAIN_BOT_MS;
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
    // team_registration is counted ONLY against itself. Leaving it in the
    // other bucket meant a club director who entered three teams in the
    // morning, which is explicitly allowed and well under the registration
    // ceiling, was refused when he came back that afternoon to file the team
    // waiver, which is mandatory before the first game. His three legitimate
    // registrations filled a cap of three that the waiver then hit.
    const kinds: Kind[] = isRegistration
      ? ["team_registration"]
      : ["player_registration", "site_feedback", "player_ad"];
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

  if (body.kind === "clinic_registration") {
    // THE EVENT IS OVER. This endpoint used to accept a clinic registration on
    // any date forever, which is half of how a parent could be charged $175 on
    // 13 October for a clinic held on the 12th.
    if (clinicIsOver()) {
      return NextResponse.json(
        {
          error:
            `The College Clinic on ${CLINIC.dateLabel} has already taken place, so this form was not saved. ` +
            `Call Mike on ${CLINIC.phone} to hear about the next one.`,
        },
        { status: 410 },
      );
    }

    // THE SAME PLAYER, AGAIN. Alyssa S. submitted this form three times in
    // twelve minutes on 2026-08-20 and never paid. There is no way to come
    // back later and pay a registration you already made, so re-submitting is
    // the only move the site leaves you, and she made it twice looking for the
    // payment step. Until a signed pay-later link exists, say plainly that we
    // already have her and how to pay.
    //
    // Matched on player name AND mailbox, never mailbox alone. Two sisters
    // registering from one parent's address is ordinary, which is exactly why
    // the mailbox flood check above does not cover this kind.
    //
    // Both sides trimmed and lowercased because they have to be: the earliest
    // of those three live documents stores the first name as "Alyssa " with a
    // trailing space.
    const first = String(cleaned.player_first_name ?? "").trim().toLowerCase();
    const last = String(cleaned.player_last_name ?? "").trim().toLowerCase();
    if (mailbox && first && last) {
      const prior = await db
        .collection(`leagues/${tenantId}/form_submissions/clinic_registration/items`)
        .where("mailbox", "==", mailbox)
        .get()
        .catch(() => null);
      const dupe = (prior?.docs ?? []).find((d) => {
        const x = d.data();
        return (
          x.deleted !== true &&
          String(x.player_first_name ?? "").trim().toLowerCase() === first &&
          String(x.player_last_name ?? "").trim().toLowerCase() === last
        );
      });
      if (dupe) {
        const already =
          (dupe.data().payment as { status?: string } | undefined)?.status ===
          "paid";
        const venmo = paymentDetailsFor(tenantId)?.venmoHandle;
        const name = String(cleaned.player_first_name ?? "").trim();
        return NextResponse.json(
          {
            error: already
              ? `${name} is already registered and paid for the College Clinic, so this second form was not saved. Nothing else is needed. Questions, call Mike on ${CLINIC.phone}.`
              : `${name} is already registered for the College Clinic, so this second form was not saved. The place is held once the fee is paid. ` +
                (venmo
                  ? `Send $${CLINIC.fee} on Venmo to ${venmo} with the player's name in the note, `
                  : "") +
                `or call Mike on ${CLINIC.phone}.`,
          },
          { status: 409 },
        );
      }
    }

    // The clinic is capped, and the cap is real: 40 places, one player each.
    //
    // Counted here rather than trusted from a page that may have been open for
    // an hour. Only PAID places hold a spot. A registration that never paid is
    // not occupying anything, and treating it as occupied would let a handful
    // of abandoned forms close a clinic that is half empty.
    //
    // THIS CHECK IS NOT THE ONE THAT MATTERS. Registration is free and
    // unlimited, so 60 families can pass this line while paid is still 0 and
    // then all 60 can pay. The check that holds the line is the one in
    // /api/square-pay, immediately before the money moves. This one exists so
    // nobody fills in seventeen fields for a place that is already gone.
    const paid = await paidClinicPlaces(db, tenantId);
    if (paid >= CLINIC_CAPACITY) {
      return NextResponse.json(
        {
          error:
            `The College Clinic is full. All ${CLINIC_CAPACITY} places are paid for. ` +
            `Call Mike on ${CLINIC.phone} to go on the waiting list in case of a drop out.`,
        },
        { status: 409 },
      );
    }
  }

  let ref;
  // His form sets a minimum of 2 dozen and the page says so, but the page can
  // be bypassed. Enforced here too, because an order for 1 dozen is one Doug
  // has to decline by hand after the coach already thinks it is placed.
  if (body.kind === "baseball_order") {
    const dozens = Number((cleaned as Record<string, unknown>).dozens);
    if (!Number.isFinite(dozens) || dozens < 2) {
      return NextResponse.json(
        { error: "Minimum order is 2 dozen." },
        { status: 400 },
      );
    }
  }

  // COYBL umpires get a NUMBER, not just a record. Doug's own form says so:
  // "Your Registration Entry number will be your 2026 COYBL Umpire
  // registration number as it is a special number assigned to you." On
  // SportsEngine that number falls out of the entry sequence, so moving to a
  // Firestore document id would have quietly taken away something he has been
  // handing to umpires for years.
  //
  // Sequential per league per SEASON, because "umpires must register each
  // year" — the counter is keyed on the season so 2027 starts at 1 again
  // rather than continuing 2026's run.
  //
  // A transaction, not a collection count: two umpires submitting in the same
  // second would both read the same count and be issued the same number, and
  // the number is the thing that identifies them.
  let registrationNumber: number | null = null;
  if (body.kind === "umpire_registration" && !certainBot) {
    try {
      // The league's OWN season_year, not the calendar year. Doug opened the
      // "2026 Umpire Registration" on 1 September 2025, so an umpire signing up
      // that autumn belongs to the 2026 run. new Date().getFullYear() would
      // have filed them under 2025 and restarted the numbering in January,
      // mid-season, handing two umpires the same number.
      const leagueDoc = await db.doc(`leagues/${tenantId}`).get();
      const season =
        Number(leagueDoc.data()?.season_year) || new Date().getFullYear();
      const counter = db.doc(
        `leagues/${tenantId}/counters/umpire_registration_${season}`,
      );
      registrationNumber = await db.runTransaction(async (tx) => {
        const snap = await tx.get(counter);
        const next = Number(snap.data()?.next ?? 1);
        tx.set(counter, { next: next + 1, updated_at: new Date().toISOString() }, { merge: true });
        return next;
      });
    } catch (e) {
      // Never fail the registration over the number. An umpire who filled the
      // form in must be recorded either way; the office can assign a number by
      // hand from the admin far more easily than that umpire can be persuaded
      // to fill it in twice.
      console.error("[league-form] umpire number transaction failed:", e);
    }
  }

  try {
    ref = await db
      .collection(`leagues/${tenantId}/form_submissions/${body.kind}/items`)
      .add({
        ...cleaned,
        submitted_at: new Date().toISOString(),
        mailbox,
        ip,
        user_agent: h.get("user-agent") ?? null,
        ...(registrationNumber != null
          ? { registration_number: registrationNumber }
          : {}),
        // Empty for an ordinary submission. When set, the office is told in
        // the subject line so a human decides, rather than this route
        // deciding on their behalf and destroying the evidence.
        ...(spamFlags.length ? { spam_flags: spamFlags } : {}),
        ...(certainBot ? { spam: true } : {}),
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
    //
    // NOT WHEN A BOT CHECK FIRED. "Saved for review" and "given a team on the
    // public site with a working sign-in code" are different promises, and
    // this made both: on 2026-08-20 a bot provisioned team
    // 51WLwx5NFNkXMDKaambw named "DRjxknBQmludnVaJiixdNjRo", then the office
    // was emailed NEEDS REVIEW about a team that already existed.
    //
    // GATE ONLY THIS, and the coach's welcome email below with it. The first
    // attempt gated the whole surrounding block, which silently took the
    // NEEDS REVIEW office email out with it: a flagged signup fell through to
    // the plain fallback notification, so the office got a routine looking
    // "New Team registration" with no warning, no team, and nothing saying
    // anything was needed. That is worse than the bug it was fixing, because a
    // REAL coach caught by a password manager would be waiting for a code
    // nobody knew to send. Caught live at 22:56 the same evening.
    // WHICH FLAGS ACTUALLY HOLD A TEAM BACK.
    //
    // Only the timing check holds a team back, and since the honeypot was
    // removed on 2026-09-01 it is the only check there is. Measured over
    // Island's first six weeks: 165 bots, all 165 caught here, 0 false
    // positives. Kept as a `some()` over the flags rather than a plain
    // boolean so a future second check has to opt in to holding a team.
    const flagged = spamFlags.some((f) => f.startsWith("too_fast"));
    let teamCode: string | null = null;
    if (!flagged) {
      try {
        const res = await provisionCoyblTeam(tenantId, ref.id, cleaned);
        teamCode = res.teamCode;
      } catch (err) {
        console.error("[league-form] team provisioning failed", err);
      }
    }

    // Email the coach their team's sign-in code. Recorded either way: this
    // used to be an empty catch, which is how a Firebase "Domain not
    // allowlisted" error silently ate every login email while registrations
    // looked fine. The registration still succeeds regardless, but a failure
    // is now visible in the admin inbox instead of invisible everywhere.
    // Nothing to send while flagged: no team means no sign-in code, and mailing
    // one would confirm to a bot that it landed. The office decides first, and
    // /api/admin-provision-team sends the code when it does. Recorded so the
    // admin row shows WHY the coach has not heard, rather than reading as a
    // bounce.
    if (flagged) {
      await ref
        .set(
          { login_email_sent: false, login_email_error: "held for review" },
          { merge: true },
        )
        .catch(() => {
          /* best-effort; never fail the registration over a flag */
        });
    } else {
    try {
      // sendEmail NEVER throws, it returns { ok: false }, so the catch below
      // could not see a refused send and this wrote login_email_sent: true
      // over the top of one. The flag exists precisely to catch a login email
      // that vanished, so it has to read the result.
      const res = await sendCoachCodeEmail(
        cleaned,
        origin,
        teamCode,
        leagueName,
        leagueAbbrev,
        tenantId,
      );
      await ref.set(
        res.ok
          ? { login_email_sent: true }
          : {
              login_email_sent: false,
              login_email_error: res.error ?? "unknown error",
            },
        { merge: true },
      );
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
    }
    // Tell the league office a team just registered. This branch used to
    // return without notifying anyone, so the only way the director learned
    // of a registration was to go look in the admin inbox. Best-effort: a
    // failed notification must never fail the coach's registration.
    try {
      const who =
        `${cleaned.manager_first_name ?? ""} ${cleaned.manager_last_name ?? ""}`.trim();
      const built = officeRegistrationEmail({
          leagueAbbrev,
          team: String(cleaned.team_name ?? ""),
          who,
          email: String(cleaned.email ?? ""),
          phone: String(cleaned.phone ?? ""),
          ageGroup: String(cleaned.age_group ?? ""),
          division: String(cleaned.division ?? ""),
          gamechangerLink: String(cleaned.gamechanger_link ?? ""),
          insuranceOption: String(cleaned.insurance_option ?? ""),
          usssaAddon: Boolean(cleaned.usssa_addon),
          homeField: String(cleaned.home_field ?? ""),
          homeFieldName: String(cleaned.home_field_name ?? ""),
      });
      // A flagged registration is still a registration. Say so in the subject
      // so it cannot be missed, and explain WHY at the top of the body — the
      // office needs to know the trap is unreliable, otherwise "flagged as a
      // bot" reads as "safe to delete". The wording also has to be honest that
      // nothing was provisioned, because a flagged signup now waits for a human.
      const sentTo = certainBot ? 0 : await notifyOffice({
        // THE HEADER MUST MATCH WHAT ACTUALLY HAPPENED, and there are now two
        // different outcomes, not one.
        //
        // `flagged` is the timing check, and only it withholds a team. The
        // second branch is now unreachable in practice, because the honeypot
        // was the only check that flagged without holding and it was removed
        // on 2026-09-01. It stays because the next check added here will very
        // likely be another advisory one, and the lesson that produced it is
        // worth keeping: keyed on spamFlags.length this told the office "no
        // team was created" for a honeypot hit where the team HAD been created
        // and the coach HAD been emailed, which would have had Mike create a
        // duplicate and send Craig Fisher a second sign-in code.
        subject: flagged
          ? `NEEDS REVIEW — ${built.subject}`
          : built.subject,
        html: flagged
          ? `<p style="background:#fff4e5;border:1px solid #f0b37e;padding:10px 12px;border-radius:8px">` +
            `<strong>This registration tripped an automatic bot check (${esc(spamFlags.join(", "))}).</strong><br/>` +
            `It has been saved in full, but <strong>no team was created</strong> and the coach has not been ` +
            `sent a sign-in code. Nothing happens until you decide.` +
            `</p><p style="background:#fff4e5;border:1px solid #f0b37e;padding:10px 12px;border-radius:8px">` +
            `These checks catch real people: a password manager filling a hidden field, or a browser ` +
            `autofilling the form in one click, both look like a bot. If it is a real team, open ` +
            `<strong>Registrations</strong> in the admin and click ` +
            `<strong>Create team from this registration</strong>, which sets it up and emails the coach ` +
            `their sign-in code. If it is junk, delete it.` +
            `</p>` + built.html
          : spamFlags.length
            ? `<p style="background:#eef6ff;border:1px solid #b6d4f7;padding:10px 12px;border-radius:8px">` +
              `<strong>Set up as normal. No action needed.</strong><br/>` +
              `A minor bot check fired (${esc(spamFlags.join(", "))}), which usually just means the coach ` +
              `used a password manager. The team was created and the coach has been emailed their ` +
              `sign-in code. Mentioned only so nothing looks unexplained.` +
              `</p>` + built.html
            : built.html,
        // Hitting reply reaches the coach who registered rather than the
        // noreply sender. Every other office notification in this file
        // already does this; the registration one was the exception, so the
        // one email the office actually answers was the one they could not.
        replyTo: String(cleaned.email ?? "") || undefined,
      });
      if (sentTo > 0) {
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
  } else if (MAIL_RECORDED_KINDS.has(body.kind)) {
    // AWAITED, not fire-and-forget. `void`ing this on Vercel is a coin flip:
    // the response returns, the lambda is frozen, and a pending email is
    // simply never sent. Next 14 has no after() and @vercel/functions is not
    // installed, so there is no way to keep the function alive in the
    // background, the only reliable option is to wait for it.
    //
    // Safe to wait for these kinds where it was not for registration: at most
    // three short messages on forms nobody submits in bulk. Capped anyway so a
    // slow SendGrid cannot hang the submit, and the submission is already
    // written, so a failed or slow email never loses a clinic place, a signed
    // waiver or a free agent ad.
    //
    // The outcome is stamped on the document. sendEmail NEVER throws, it
    // returns { ok: false }, and that result used to be dropped on the floor:
    // a SendGrid 401 or a quota block left no flag, no log and no clue, and
    // the first person to find out would have been a parent who paid $175 and
    // never got a confirmation.
    let flags: MailFlags;
    try {
      const raced = await Promise.race([
        sendRegistrationEmails(
          tenantId,
          body.kind,
          cleaned,
          origin,
          leagueName,
          leagueAbbrev,
          certainBot,
          registrationNumber,
        ),
        // Resolves a sentinel rather than undefined so a timeout is RECORDED
        // as a timeout. Resolving nothing would be indistinguishable from a
        // clean send that had nothing to report, which is the same silence
        // this whole change exists to remove.
        new Promise<"timeout">((r) =>
          setTimeout(() => r("timeout"), MAIL_TIMEOUT_MS),
        ),
      ]);
      flags =
        raced === "timeout"
          ? {
              office_email_sent: false,
              office_email_error: `no answer from the email provider in ${
                MAIL_TIMEOUT_MS / 1000
              }s, the message may or may not have gone out`,
            }
          : raced;
    } catch (err) {
      const reason = err instanceof Error ? err.message : "unknown error";
      console.error(`[league-form] ${body.kind} notify threw:`, reason);
      flags = { office_email_sent: false, office_email_error: reason };
    }
    if (Object.keys(flags).length > 0) {
      // Best effort in both directions: the submission is already saved, and
      // failing to write the flag must never fail the submission.
      await ref.set(flags, { merge: true }).catch(() => {});
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
      certainBot,
      registrationNumber,
    ).catch(() => {});
  }

  // registration_number goes back to the browser so the success screen can
  // show it. Doug's umpires are told this number IS their COYBL registration
  // number, so it has to be on screen the moment they finish, not only in an
  // email that may bounce or land in spam.
  return NextResponse.json({
    ok: true,
    id: ref.id,
    ...(registrationNumber != null
      ? { registration_number: registrationNumber }
      : {}),
  });
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
): Promise<{ ok: boolean; error?: string }> {
  const c = (k: string) =>
    typeof data[k] === "string" ? (data[k] as string).trim() : "";
  const email = c("email");
  if (!email) return { ok: false, error: "no email on the registration" };
  const who = [c("manager_first_name"), c("manager_last_name")]
    .filter(Boolean)
    .join(" ");
  const team = c("team_name");
  // The assistant coach gets the code too, which is what the registration form
  // promises them. Deduped in case the same address was typed twice.
  const asst = c("asst_email");
  const recipients = [email];
  if (asst && asst.toLowerCase() !== email.toLowerCase()) recipients.push(asst);

  const built = coachCodeEmail({
    who,
    team,
    teamCode,
    origin,
    leagueName,
    leagueAbbrev,
    tenantId,
  });
  // The COACH's copy decides the flag. An assistant's address bouncing does
  // not stop the coach getting into their team, and treating it as a failure
  // would send the office chasing a problem that is not there.
  let outcome: { ok: boolean; error?: string } = {
    ok: false,
    error: "no recipients",
  };
  for (const to of recipients) {
    const res = await sendEmail({
      to,
      subject: built.subject,
      html: built.html,
      replyTo: notifyAddress() ?? undefined,
    });
    if (to === email) {
      outcome = res.ok
        ? { ok: true }
        : {
            ok: false,
            error: res.skipped
              ? "email not configured"
              : (res.error ?? "unknown error"),
          };
    }
  }
  return outcome;
}

async function sendRegistrationEmails(
  tenantId: string,
  kind: Kind,
  data: Record<string, unknown>,
  origin: string,
  leagueName: string,
  leagueAbbrev: string,
  certainBot = false,
  /** Assigned in POST, not derivable here: the number lives on a per-season
   *  counter and is issued once, inside a transaction. */
  registrationNumber: number | null = null,
): Promise<MailFlags> {
  // A submission that could not have been typed by a person sends NOTHING.
  //
  // The team_registration path already did this at its own notifyOffice call.
  // These three did not, so on 2026-08-23 a bot filled the alerts form in
  // 283ms and the umpire board in 431ms, from two Tor exit addresses in
  // 185.220.101.x, and Doug got an email for each inside the same minute. He
  // forwarded them both asking "How can I delete this one?" and "spam?".
  //
  // The submission is still written and still visible under the admin's Spam
  // filter, so the promise never to silently discard a real person holds. What
  // stops is the mail.
  //
  // Both directions, deliberately. Suppressing only the office copy would
  // still send a confirmation to the address the bot supplied, and every
  // league here shares ONE SendGrid account, so mailing a throwaway address
  // spends every other client's sender reputation to answer a robot.
  if (certainBot) {
    console.warn(
      `[league-form] certain bot — no mail sent tenant=${tenantId} kind=${kind}`,
    );
    return {
      office_email_sent: false,
      office_email_error: "quarantined as a certain bot, no mail sent",
    };
  }
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
    const res = await sendEmail({
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
    // A failed send used to vanish with no trace: Adam expected an email per
    // submission and had no way to tell a broken sender from a quiet week.
    // The outcome was computed here and then discarded by the caller, which
    // is the same silence with extra steps. It is now merged onto the
    // submission and shows in the admin panel.
    //
    // office_email_to is recorded because this kind is the exception: site
    // feedback goes to ADAM, not the league office, so a row that only said
    // "Office notified: Yes" would be telling Kaitlin something untrue.
    if (!res.ok) {
      console.error(
        `[league-form] site_feedback notify FAILED to=${to}:`,
        res.skipped ? "email not configured" : res.error,
      );
    }
    return {
      office_email_to: to,
      office_email_sent: res.ok,
      ...(res.ok
        ? {}
        : {
            office_email_error: res.skipped
              ? "email not configured"
              : (res.error ?? "unknown error"),
          }),
    };
  }

  // College Clinic. Its own branch rather than a case in the generic path
  // below, because that path reads manager_* names and labels everything it
  // does not recognise a "Team registration" — a clinic sign-up would have
  // reached Mike as "New Team registration: (no name)".
  //
  // Before this existed, clinic_registration fell straight through the gate
  // underneath and NOBODY was emailed: not the parent, not the office. Adam
  // asked for exactly this ("make sure mike gets emails about sign ups",
  // 2026-08-19).
  if (kind === "clinic_registration") {
    const g = (k: string) =>
      typeof data[k] === "string" ? (data[k] as string).trim() : "";
    const player = `${g("player_first_name")} ${g("player_last_name")}`.trim();
    const parent = `${g("parent_first_name")} ${g("parent_last_name")}`.trim();
    const parentEmail = g("email");
    // Where to send the money, from the one place that knows. Not a literal:
    // a second copy of a Venmo handle is how half a league pays the wrong
    // account. Undefined for any tenant with no entry, which the copy below
    // handles rather than inventing a handle to pay.
    const venmoHandle = paymentDetailsFor(tenantId)?.venmoHandle;

    // Recorded, not merely attempted. A parent who registers a player for a
    // $175 clinic and hears nothing cannot tell a missing email from a
    // missing registration, and until now neither could the office.
    const flags: MailFlags = {};
    if (parentEmail) {
      const res = await sendEmail({
        to: parentEmail,
        subject: `${leagueAbbrev} College Clinic — ${player || "registration received"}`,
        html:
          `<p>Hi ${esc(parent) || "there"},</p>` +
          `<p>Thanks for registering <strong>${esc(player)}</strong> for the ` +
          `${esc(leagueName)} College Clinic.</p>` +
          // This is the confirmation a parent keeps and turns up with, so the
          // venue belongs in it.
          `<p><strong>${esc(CLINIC.dateLabel)}</strong>, ${esc(CLINIC.timeLabel)}<br/>` +
          `${esc(CLINIC.venue)}, ${esc(CLINIC.address)}</p>` +
          // The place is not theirs until the money lands, and saying so once
          // here is kinder than telling them at the gate on the day.
          // "You can still do it from the registration page" was not true.
          // Re-opening /college-clinic starts a NEW registration, it does not
          // return you to the one you just made, and there is no signed
          // pay-later link in this codebase. Alyssa S. submitted three times
          // in twelve minutes on 2026-08-20 hunting for the payment step this
          // sentence promised. Only say what the site can actually do.
          `<p>The fee is <strong>$${CLINIC.fee}</strong> and places are capped at ` +
          `${CLINIC.capacity}. The place is held once the fee is paid.</p>` +
          (venmoHandle
            ? `<p>To pay by Venmo, send <strong>$${CLINIC.fee}</strong> to ` +
              `<strong>${esc(venmoHandle)}</strong> and put <strong>${esc(player)}</strong> ` +
              `in the note so the office can match it. Do not fill the form in again, ` +
              `we have the registration.</p>`
            : `<p>Reply to this email and the office will tell you how to pay. ` +
              `Do not fill the form in again, we have the registration.</p>`) +
          `<p>Bring a glove, bat, helmet, cleats and water. Wear your travel team ` +
          `uniform if you have one.</p>` +
          `<p>Questions about the day: Mike on ${esc(CLINIC.phone)}.</p>` +
          `<p>— ${esc(leagueAbbrev)}</p>`,
        replyTo: notifyAddress() ?? undefined,
      });
      flags.confirmation_email_sent = res.ok;
      if (!res.ok) {
        flags.confirmation_email_error = res.skipped
          ? "email not configured"
          : (res.error ?? "unknown error");
        console.error(
          `[league-form] clinic confirmation FAILED to=${parentEmail}:`,
          flags.confirmation_email_error,
        );
      }
    }

    const sentTo = await notifyOffice({
      subject: `College Clinic: ${player || "(no name)"}${g("grad_year") ? ` (${g("grad_year")})` : ""}`,
      html:
        `<p><strong>College Clinic registration</strong></p>` +
        `<p><strong>Player:</strong> ${esc(player)}<br/>` +
        `<strong>Age group:</strong> ${esc(g("age_group"))}<br/>` +
        // Grad year and position first: these are what a college coach asks
        // and what the day is organised around.
        `<strong>Grad year:</strong> ${esc(g("grad_year"))}<br/>` +
        `<strong>Position:</strong> ${esc(g("primary_position"))}` +
        (g("secondary_position") ? ` / ${esc(g("secondary_position"))}` : "") +
        `</p>` +
        (g("high_school") ? `<p><strong>High school:</strong> ${esc(g("high_school"))}</p>` : "") +
        (g("current_team") ? `<p><strong>Travel team:</strong> ${esc(g("current_team"))}</p>` : "") +
        `<p><strong>Parent:</strong> ${esc(parent)}<br/>` +
        `<strong>Email:</strong> ${esc(parentEmail)}<br/>` +
        `<strong>Phone:</strong> ${esc(g("phone"))}</p>` +
        (g("notes") ? `<p><strong>Notes:</strong> ${esc(g("notes"))}</p>` : "") +
        // NOT the Payments tab. That is the TEAM ledger and a clinic place is
        // not a team, so /api/square-pay no longer writes a row there for one
        // and the Venmo path never did. Sending Mike to a tab that will always
        // be empty for a clinic is how he concludes nobody has paid.
        `<p>Payment is separate. Open Admin, Form submissions, College Clinic to see ` +
        `whether this place is paid for, and to record a Venmo or a check.</p>`,
      replyTo: parentEmail || undefined,
    });
    flags.office_email_sent = sentTo > 0;
    if (sentTo === 0) {
      // Two very different problems that look identical on the document
      // unless they are named: nobody is configured to be told, or SendGrid
      // refused everyone who is. The admin badge reads these strings to
      // decide between amber and red, so do not reword them here without
      // changing MAIL_NOT_CONFIGURED in FormSubmissionsViewer.tsx.
      flags.office_email_error =
        notifyAddresses().length === 0
          ? "no notify address configured"
          : "the email provider accepted none of the office addresses";
      console.error(
        "[league-form] clinic office notify reached nobody:",
        flags.office_email_error,
      );
    }
    return flags;
  }

  // player_ad, umpire_evaluation and alerts_signup fell through the gate below
  // and emailed NOBODY. All three are silent in a way that costs something
  // real:
  //
  //   player_ad          the poster is told their post is "reviewed before it
  //                      appears". Nothing told a reviewer one was waiting, so
  //                      keeping that promise depended on somebody opening the
  //                      board tab of their own accord.
  //   umpire_evaluation  a complaint about an official, filed and unread.
  //   alerts_signup      a family asking to be told about rain outs, with
  //                      nobody told that they had asked.
  //
  // Office only, no confirmation to the submitter: none of these is a
  // transaction anyone is waiting on, and mailing a poster back would read as
  // approval of a post that has not been reviewed yet.
  // Umpire registration. Its own branch because the generic builder below
  // reads manager_first_name and would have addressed every umpire as "Hi
  // there" and told them the office would "follow up with payment", on a
  // registration Doug states three times is free.
  //
  // The confirmation email is not a courtesy here, it is load-bearing. Doug's
  // own welcome page, in capitals: "IF YOU DO NOT GET AN EMAIL CONFIRMING YOUR
  // REGISTRATION, YOU DID NOT COMPLETE IT PROPERLY AND WILL NEED TO REDO IT."
  // So the email has to arrive, has to be recognisable as the confirmation,
  // and has to carry the number.
  // Tournament entries and baseball orders. Both owe Doug money and neither is
  // charged on the site, so the confirmation has to carry the payment
  // instructions: a coach who registers and is told nothing about paying is a
  // coach Doug chases in June.
  //
  // Own branch for the same reason as umpire registration — the generic
  // builder reads manager_first_name and would address every one of these as
  // "Hi there".
  if (kind === "tournament_registration" || kind === "baseball_order") {
    const f = (k: string) =>
      typeof data[k] === "string" ? (data[k] as string).trim() : "";
    const name = `${f("first_name")} ${f("last_name")}`.trim();
    const email = f("email");
    const team = f("team_name");
    const isOrder = kind === "baseball_order";
    const what = isOrder
      ? "baseball order"
      : `entry for ${f("tournament") || "the tournament"}`;
    const dozens = Number(data.dozens ?? 0);
    const flags: MailFlags = {};

    // How to pay, from the ONE place these details live. lib/coybl-payment.ts
    // exists because the address was already duplicated once, and a league
    // that tells half its coaches to post cheques to a dead address is the
    // thing that note is there to prevent.
    const pay = paymentDetailsFor(tenantId);
    const payHtml =
      `<p><strong>How to pay</strong></p><ul>` +
      (pay?.venmoHandle
        ? `<li>Venmo <strong>${esc(pay.venmoHandle)}</strong>. Please put the team name and ${isOrder ? "“baseballs”" : "the tournament name"} in the note.</li>`
        : "") +
      (pay?.checkPayableTo && pay?.checkAddress
        ? `<li>Cheque payable to <strong>${esc(pay.checkPayableTo)}</strong>, posted to ${esc(pay.checkAddress)}.</li>`
        : "") +
      `<li>By card, on the confirmation screen on the website. A processing fee applies.</li>` +
      `</ul>`;

    if (email) {
      const res = await sendEmail({
        to: email,
        subject: isOrder
          ? `We got your ${leagueAbbrev} baseball order`
          : `We got your ${leagueAbbrev} tournament entry`,
        html:
          `<p>Hi ${esc(name) || "there"},</p>` +
          `<p>Thanks. We have your ${esc(what)}${team ? ` for ${esc(team)}` : ""}.</p>` +
          (isOrder && dozens > 0
            ? `<p><strong>Order:</strong> ${dozens} dozen${dozens === 1 ? "" : ""} at $52 per dozen` +
              (f("ship_to_home") === "Yes"
                ? `, plus $5 per dozen shipping.`
                : `, for collection at no extra cost.`) +
              `</p>`
            : "") +
          payHtml +
          `<p>You can still pay by card on the website: reopen the page and finish there, ` +
          `or use any option above. Nothing is confirmed until payment reaches the league. ` +
          `Questions go to ${esc(notifyAddress() ?? "the league office")}.</p>`,
        replyTo: notifyAddress() ?? undefined,
      });
      flags.confirmation_email_sent = res.ok;
      if (!res.ok) {
        flags.confirmation_email_error = res.skipped
          ? "email not configured"
          : (res.error ?? "unknown error");
        console.error(
          `[league-form] ${kind} confirmation FAILED to=${email}:`,
          flags.confirmation_email_error,
        );
      }
    }

    const sentTo = await notifyOffice({
      subject: isOrder
        ? `Baseball order: ${team || name || "(no name)"}${dozens ? ` — ${dozens} dozen` : ""}`
        : `${f("tournament") || "Tournament"} entry: ${team || "(no team)"}`,
      html:
        `<p><strong>${isOrder ? "A baseball order came in." : "A team entered a tournament."}</strong></p>` +
        (f("tournament") ? `<p><strong>Tournament:</strong> ${esc(f("tournament"))}</p>` : "") +
        `<p><strong>Team:</strong> ${esc(team)}${f("team_age") ? ` (${esc(f("team_age"))})` : ""}<br/>` +
        `<strong>Contact:</strong> ${esc(name)}<br/>` +
        `<strong>Email:</strong> ${esc(email)}<br/>` +
        `<strong>Phone:</strong> ${esc(f("phone"))}` +
        (dozens ? `<br/><strong>Dozens:</strong> ${dozens}` : "") +
        (isOrder
          ? `<br/><strong>Ship to home:</strong> ${esc(f("ship_to_home") || "not stated")}`
          : "") +
        (f("payment_preference")
          ? `<br/><strong>Intends to pay by:</strong> ${esc(f("payment_preference"))}`
          : "") +
        (f("not_travel_team")
          ? `<br/><strong>Certified not a travel team:</strong> yes`
          : "") +
        `</p>` +
        (isOrder && f("address")
          ? `<p><strong>Delivery address:</strong><br/>${esc(f("address"))}<br/>` +
            `${esc(f("city"))} ${esc(f("state"))} ${esc(f("zip"))}</p>`
          : "") +
        (f("notes") ? `<p><strong>Notes:</strong> ${esc(f("notes"))}</p>` : "") +
        `<p>If they paid by card on the site it is already recorded on the submission. ` +
        `Venmo and cheque still need marking off by hand.</p>`,
      replyTo: email || undefined,
    });
    flags.office_email_sent = sentTo > 0;
    if (sentTo === 0) {
      flags.office_email_error = "no office recipient accepted the message";
    }
    return flags;
  }

  if (kind === "umpire_registration") {
    const f = (k: string) =>
      typeof data[k] === "string" ? (data[k] as string).trim() : "";
    const name = `${f("first_name")} ${f("last_name")}`.trim();
    const email = f("email");
    const num =
      typeof registrationNumber === "number" ? String(registrationNumber) : "";
    const flags: MailFlags = {};

    if (email) {
      const res = await sendEmail({
        to: email,
        subject: `Your ${leagueAbbrev} umpire registration is confirmed${num ? ` (#${num})` : ""}`,
        html:
          `<p>Hi ${esc(name) || "there"},</p>` +
          `<p>Your umpire registration with ${esc(leagueName)} is complete. ` +
          `This email is your confirmation, so keep it.</p>` +
          (num
            ? `<p style="background:#f1f5f9;border:1px solid #cbd5e1;padding:12px 14px;border-radius:8px">` +
              `<strong style="font-size:18px">Your registration number is ${esc(num)}.</strong><br/>` +
              `This is your ${esc(leagueAbbrev)} umpire registration number for the season.` +
              `</p>`
            : "") +
          `<p>There is no cost to register. A current OHSAA licence is a ` +
          `separate requirement and is also needed to work ${esc(leagueAbbrev)} games.</p>` +
          `<p>Registration runs every year, so you will be asked to do this ` +
          `again next season.</p>`,
        replyTo: notifyAddress() ?? undefined,
      });
      flags.confirmation_email_sent = res.ok;
      if (!res.ok) {
        flags.confirmation_email_error = res.skipped
          ? "email not configured"
          : (res.error ?? "unknown error");
        // Loud, because Doug tells umpires that a missing confirmation means
        // the registration did not take. A silent failure here sends a
        // correctly registered official back to fill the form in again.
        console.error(
          `[league-form] umpire confirmation FAILED to=${email}:`,
          flags.confirmation_email_error,
        );
      }
    }

    const sentTo = await notifyOffice({
      subject: `Umpire registration${num ? ` #${num}` : ""}: ${name || "(no name)"}`,
      html:
        `<p><strong>An umpire registered.</strong></p>` +
        (num ? `<p><strong>Registration number:</strong> ${esc(num)}</p>` : "") +
        `<p><strong>Name:</strong> ${esc(name)}<br/>` +
        `<strong>Email:</strong> ${esc(email)}<br/>` +
        `<strong>Phone:</strong> ${esc(f("phone"))}` +
        (f("level") ? `<br/><strong>Level:</strong> ${esc(f("level"))}` : "") +
        (f("ohsaa_licensed")
          ? `<br/><strong>OHSAA licensed:</strong> ${esc(f("ohsaa_licensed"))}`
          : "") +
        (f("ohsaa_number")
          ? `<br/><strong>OHSAA number:</strong> ${esc(f("ohsaa_number"))}`
          : "") +
        (f("years_experience")
          ? `<br/><strong>Years:</strong> ${esc(f("years_experience"))}`
          : "") +
        (f("age_groups")
          ? `<br/><strong>Age groups:</strong> ${esc(f("age_groups"))}`
          : "") +
        `</p>` +
        (f("notes") ? `<p><strong>Notes:</strong> ${esc(f("notes"))}</p>` : "") +
        `<p>See it in Admin, Form submissions, Umpire registration.</p>`,
      replyTo: email || undefined,
    });
    flags.office_email_sent = sentTo > 0;
    if (sentTo === 0) {
      flags.office_email_error = "no office recipient accepted the message";
    }
    return flags;
  }

  if (
    kind === "player_ad" ||
    kind === "umpire_evaluation" ||
    kind === "coach_evaluation" ||
    kind === "alerts_signup"
  ) {
    const f = (k: string) =>
      typeof data[k] === "string" ? (data[k] as string).trim() : "";
    const from = f("email");
    let subject: string;
    let html: string;
    if (kind === "player_ad") {
      // ONE kind, TWO boards. Island runs this as a free agent board
      // (posted_by is coach or player). COYBL runs the identical form as its
      // umpire board (umpire or team_ump), see the isCoybl branch in
      // app/player-ads/page.tsx. A subject hardcoded to "Player ad" would
      // reach Doug about an umpire looking for games.
      const posted = f("posted_by");
      const noun =
        posted === "umpire" || posted === "team_ump"
          ? "Umpire post"
          : "Player ad";
      const who = f("contact_name") || "(no name)";
      subject = `${noun} waiting for review: ${who}`;
      html =
        `<p><strong>A post has been submitted and is waiting for review.</strong> ` +
        `Nothing is public until it is approved in Admin, Player ads.</p>` +
        `<p><strong>Posted by:</strong> ${esc(f("posted_by"))}<br/>` +
        `<strong>Contact:</strong> ${esc(f("contact_name"))}<br/>` +
        `<strong>Email:</strong> ${esc(from)}<br/>` +
        `<strong>Phone:</strong> ${esc(f("phone"))}</p>` +
        (f("age_group") || f("position") || f("town") || f("team_name")
          ? `<p>${[f("age_group"), f("position"), f("town"), f("team_name")]
              .filter(Boolean)
              .map((s) => esc(s))
              .join(" &middot; ")}</p>`
          : "") +
        `<p style="white-space:pre-wrap">${esc(f("message"))}</p>` +
        `<p style="color:#555;font-size:13px">The contact details above are ` +
        `private and stay in the admin. The public ad carries the age group, ` +
        `position, town, team and message only.</p>`;
    } else if (kind === "coach_evaluation") {
      // The incident flag leads the SUBJECT, not just the body. An ejection
      // report and a routine "he was fine" evaluation arrive in the same inbox
      // and look identical in a list; the office has to be able to tell them
      // apart without opening either.
      const incident = f("incident").toLowerCase() === "yes";
      subject =
        (incident ? "INCIDENT — " : "") +
        `Coach evaluation: ${f("coach_name") || "?"} (${f("coach_team") || "?"})` +
        (f("game_date") ? ` ${f("game_date")}` : "");
      const rating = (label: string, key: string) =>
        f(key) ? `<li>${label}: <strong>${esc(f(key))}</strong> of 5</li>` : "";
      html =
        (incident
          ? `<p style="background:#fdecea;border:1px solid #f5b5ae;padding:10px 12px;border-radius:8px">` +
            `<strong>An ejection or incident was reported.</strong> Details below.</p>`
          : "") +
        `<p><strong>Coach:</strong> ${esc(f("coach_name"))}` +
        (f("coach_team") ? `, ${esc(f("coach_team"))}` : "") +
        `</p>` +
        `<p><strong>Game:</strong> ${esc(f("visiting_team"))} at ${esc(f("home_team"))}` +
        (f("game_date") ? `, ${esc(f("game_date"))}` : "") +
        (f("game_time") ? ` ${esc(f("game_time"))}` : "") +
        (f("field") ? `<br/><strong>Field:</strong> ${esc(f("field"))}` : "") +
        `</p>` +
        `<p><strong>From:</strong> ${esc(f("evaluator_name"))}` +
        (f("evaluator_role") ? `, ${esc(f("evaluator_role"))}` : "") +
        (f("phone") ? `<br/><strong>Phone:</strong> ${esc(f("phone"))}` : "") +
        `</p>` +
        (f("sportsmanship_rating") ||
        f("rules_rating") ||
        f("players_rating") ||
        f("officials_rating")
          ? `<ul>` +
            rating("Sportsmanship and conduct", "sportsmanship_rating") +
            rating("Knowledge of the rules", "rules_rating") +
            rating("Treatment of players", "players_rating") +
            rating("Treatment of officials", "officials_rating") +
            `</ul>`
          : "") +
        (f("coach_comments")
          ? `<p><strong>Comments:</strong><br/>` +
            `<span style="white-space:pre-wrap">${esc(f("coach_comments"))}</span></p>`
          : "") +
        (f("incident_details")
          ? `<p><strong>Incident:</strong><br/>` +
            `<span style="white-space:pre-wrap">${esc(f("incident_details"))}</span></p>`
          : "") +
        (f("general_comments")
          ? `<p><strong>For the league:</strong><br/>` +
            `<span style="white-space:pre-wrap">${esc(f("general_comments"))}</span></p>`
          : "");
    } else if (kind === "umpire_evaluation") {
      subject =
        `Umpire evaluation: ${f("visiting_team") || "?"} at ${f("home_team") || "?"}` +
        (f("game_date") ? ` (${f("game_date")})` : "");
      html =
        `<p><strong>Umpire evaluation</strong></p>` +
        `<p><strong>Game:</strong> ${esc(f("visiting_team"))} at ${esc(f("home_team"))}` +
        (f("game_date") ? `, ${esc(f("game_date"))}` : "") +
        (f("game_time") ? ` ${esc(f("game_time"))}` : "") +
        (f("field") ? `<br/><strong>Field:</strong> ${esc(f("field"))}` : "") +
        `</p>` +
        `<p><strong>From:</strong> ${esc(f("evaluator_name"))}` +
        (f("team_affiliation") ? `, ${esc(f("team_affiliation"))}` : "") +
        (f("phone") ? `<br/><strong>Phone:</strong> ${esc(f("phone"))}` : "") +
        `</p>` +
        (f("plate_umpire_name") || f("plate_umpire_rating")
          ? `<p><strong>Plate:</strong> ${esc(f("plate_umpire_name"))} ${esc(f("plate_umpire_rating"))}` +
            `<br/><span style="white-space:pre-wrap">${esc(f("plate_umpire_comments"))}</span></p>`
          : "") +
        (f("field_umpire_name") || f("field_umpire_rating")
          ? `<p><strong>Bases:</strong> ${esc(f("field_umpire_name"))} ${esc(f("field_umpire_rating"))}` +
            `<br/><span style="white-space:pre-wrap">${esc(f("field_umpire_comments"))}</span></p>`
          : "") +
        (f("general_comments")
          ? `<p style="white-space:pre-wrap">${esc(f("general_comments"))}</p>`
          : "") +
        `<p>See it in Admin, Form submissions, Umpire evaluation.</p>`;
    } else {
      subject = `Alerts sign-up: ${f("name") || from || "(no name)"}`;
      html =
        `<p><strong>Someone signed up for league alerts.</strong></p>` +
        `<p><strong>Name:</strong> ${esc(f("name"))}<br/>` +
        `<strong>Email:</strong> ${esc(from)}<br/>` +
        `<strong>Phone:</strong> ${esc(f("phone"))}` +
        (f("age_group") ? `<br/><strong>Age group:</strong> ${esc(f("age_group"))}` : "") +
        (f("notify_by") ? `<br/><strong>Notify by:</strong> ${esc(f("notify_by"))}` : "") +
        `</p>` +
        `<p>They are on the list the admin Broadcast tool sends to. Nothing to ` +
        `do unless you want to welcome them.</p>`;
    }
    const sentTo = await notifyOffice({
      subject,
      html,
      // Reply reaches the person who wrote in rather than a noreply mailbox.
      replyTo: from || undefined,
    });
    if (sentTo > 0) return { office_email_sent: true };
    const why =
      notifyAddresses().length === 0
        ? "no notify address configured"
        : "the email provider accepted none of the office addresses";
    console.error(`[league-form] ${kind} office notify reached nobody: ${why}`);
    return { office_email_sent: false, office_email_error: why };
  }

  // team_waiver used to fall out here. The waiver was written to Firestore and
  // NOBODY was emailed — the coach had no confirmation their signed waiver
  // arrived, and the office was never told to look. Adam asked where waivers
  // go (2026-08-12); the answer was "into the admin panel, silently".
  // Anything still here sends nothing. player_waiver is the only kind that
  // reaches this line, and it is unreachable in the UI (see ALLOWED_FIELDS).
  if (
    kind !== "player_registration" &&
    kind !== "team_registration" &&
    kind !== "team_waiver"
  )
    return {};

  const c = (k: string) =>
    typeof data[k] === "string" ? (data[k] as string).trim() : "";
  const who =
    kind === "player_registration"
      ? `${c("first_name")} ${c("last_name")}`.trim()
      : `${c("manager_first_name")} ${c("manager_last_name")}`.trim();
  const email = c("email");
  const team = c("team_name");
  const division = c("division");
  // A team waiver is not a registration. Both emails called it one, so a coach
  // who signed the waiver was told "we got your team registration" — and Mike
  // got "New Team registration" for a team that had registered weeks earlier
  // (Adam asked where waivers go, 2026-08-12).
  // A waiver is not a registration. Calling it one told a coach who had just
  // signed the waiver that we had their "team registration", weeks after they
  // actually registered.
  const label =
    kind === "player_registration"
      ? "Player registration"
      : kind === "team_waiver"
        ? "Team waiver"
        : "Team registration";

  // 1) Confirmation to the registrant.
  const flags: MailFlags = {};
  if (email) {
    const res = await sendEmail({
      to: email,
      subject:
        kind === "team_waiver"
          ? `We got your ${leagueAbbrev} team waiver`
          : `We got your ${leagueAbbrev} registration`,
      html:
        `<p>Hi ${esc(who) || "there"},</p>` +
        (kind === "team_waiver"
          ? `<p>Thanks for signing the waiver for ${esc(leagueName)}. ` +
            `We have it on file — nothing else is needed.</p>`
          : `<p>Thanks for registering with ${esc(leagueName)}. ` +
            `We've received your ${esc(label.toLowerCase())} and the league ` +
            `office will follow up with payment and roster details.</p>`) +
        (division ? `<p><strong>Division:</strong> ${esc(division)}</p>` : "") +
        (team ? `<p><strong>Team:</strong> ${esc(team)}</p>` : "") +
        `<p>Questions? Reply to this email or text the league office.</p>` +
        `<p>— ${esc(leagueAbbrev)}</p>`,
      replyTo: notifyAddress() ?? undefined,
    });
    flags.confirmation_email_sent = res.ok;
    if (!res.ok) {
      flags.confirmation_email_error = res.skipped
        ? "email not configured"
        : (res.error ?? "unknown error");
      console.error(
        `[league-form] ${kind} confirmation FAILED to=${email}:`,
        flags.confirmation_email_error,
      );
    }
  }

  // 2) Heads-up to the league office — all of it, not just the first inbox.
  const sentTo = await notifyOffice({
    subject: `New ${label}: ${who || "(no name)"}`,
    html:
      `<p><strong>${esc(label)}</strong></p>` +
      `<p>Name: ${esc(who) || "—"}<br/>` +
      `Email: ${esc(email) || "—"}<br/>` +
      (division ? `Division: ${esc(division)}<br/>` : "") +
      (team ? `Team: ${esc(team)}<br/>` : "") +
      `</p><p>See it in Admin → Form submissions.</p>`,
    replyTo: email || undefined,
  });
  flags.office_email_sent = sentTo > 0;
  if (sentTo === 0) {
    flags.office_email_error =
      notifyAddresses().length === 0
        ? "no notify address configured"
        : "the email provider accepted none of the office addresses";
    console.error(
      `[league-form] ${kind} office notify reached nobody:`,
      flags.office_email_error,
    );
  }
  return flags;
}
