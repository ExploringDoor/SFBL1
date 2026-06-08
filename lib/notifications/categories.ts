// Single source of truth for the 11 push-notification categories.
//
// **MATCH DVSL EXACTLY** — names, defaults, and audience rules are
// ported verbatim from softball-site/notifications.html and
// softball-site/api/send-notification.js. Don't add a 12th category;
// don't rename one to be more "descriptive" — every trigger site,
// every prefs UI label, and every rules test depends on this exact
// shape. If you want a new category type, talk to Adam first.
//
// DVSL canonical defaults (notifications.html:1054) — 9 cats on at
// register-time. The other 2 (`captains_chat`, `admin`) are opt-in:
// captains_chat is hidden from non-captains and off by default for
// captains; `admin` is hidden from non-admins (revealed by player doc
// `is_admin === true`, NOT the legacy `?admin=1` URL trick — that's
// obsoleted as of notifications.html:1140).

export const ALL_CATEGORIES = [
  "scores",
  "rainouts",
  "schedule",
  "playoffs",
  "team_chat",
  "captains_chat",
  "announcements",
  "photos",
  "admin",
  "live",
  "pregame",
] as const;

export type NotificationCategory = (typeof ALL_CATEGORIES)[number];

export const ALL_CATEGORIES_SET: Set<string> = new Set(ALL_CATEGORIES);

// Default subscription set written to a fresh notification_tokens doc.
// Matches notifications.html:1054 EXACTLY — same 9 cats, same order:
//   ['scores', 'rainouts', 'schedule', 'playoffs', 'team_chat',
//    'announcements', 'live', 'pregame', 'photos']
// captains_chat and admin are intentionally omitted (opt-in only).
export const DEFAULT_CATEGORIES: NotificationCategory[] = [
  "scores",
  "rainouts",
  "schedule",
  "playoffs",
  "team_chat",
  "announcements",
  "live",
  "pregame",
  "photos",
];

// UI labels — verbatim from notifications.html:595-722 (the prefs UI
// markup). DVSL spec doc §4 has the canonical table. DO NOT
// "improve" these strings — captains migrating between leagues should
// see the same names everywhere.
export const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  scores: "Score Updates",
  rainouts: "Rainout Alerts",
  schedule: "Schedule Changes",
  playoffs: "Playoff Updates",
  team_chat: "Team Chat",
  captains_chat: "Captains Chat",
  announcements: "League Announcements",
  photos: "Team Photos",
  admin: "Commissioner Alerts",
  live: "Live Games",
  pregame: "Pre-Game Reminder",
};

// Sub-labels — the second-line description shown under each checkbox
// in the prefs UI. Verbatim from notifications.html:595-722.
export const CATEGORY_SUBLABELS: Record<NotificationCategory, string> = {
  scores: "Final scores and live game updates",
  rainouts: "Game cancellations and weather delays",
  schedule: "Rescheduled games and field changes",
  playoffs: "Bracket updates and elimination results",
  team_chat: "Messages from your captain and teammates",
  captains_chat:
    "Messages in the captains & commissioner room (captains only)",
  announcements: "Commissioner updates and league-wide news",
  photos: "When teammates share photos or videos",
  admin: "Score conflicts, new signups, admin-only alerts",
  live: "When a game you follow goes live",
  pregame: "One-hour heads-up before your game",
};

// Display order in the prefs UI — verbatim from DVSL spec §4 table:
// scores, rainouts, schedule, playoffs, team_chat, captains_chat,
// announcements, live, pregame, photos, admin. (admin is auth-gated
// and may be hidden; the order is still fixed when shown.)
export const CATEGORY_DISPLAY_ORDER: NotificationCategory[] = [
  "scores",
  "rainouts",
  "schedule",
  "playoffs",
  // team_chat + captains_chat hidden from the prefs UI while chat is
  // hidden site-wide (Adam, 2026-05-18). The categories still exist;
  // restore these two lines to bring the toggles back.
  // "team_chat",
  // "captains_chat",
  "announcements",
  "live",
  "pregame",
  "photos",
  "admin",
];

// Helper for when callers need to validate a string came from the
// trusted set (e.g. `category` field in /api/send-notification body).
export function isValidCategory(s: unknown): s is NotificationCategory {
  return typeof s === "string" && ALL_CATEGORIES_SET.has(s);
}
