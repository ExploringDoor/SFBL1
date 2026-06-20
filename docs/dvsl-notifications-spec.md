# DVSL Notifications — Verbatim Spec for LeagueEngine Port

**Source:** `~/Desktop/softball-site/` (DVSL production codebase)
**Purpose:** Field-for-field reference for porting DVSL's notification system to multi-tenant LeagueEngine.
**Status:** Spec locked. Build against this.

---

## ⚠️ READ FIRST — Schema corrections from earlier guidance

Earlier in chat I told you DVSL had a single `teams[]` field. That was incomplete. DVSL actually has **two separate team fields** plus `auth_uid` and `player_id`. Missing these will cause real bugs.

### Final schema (multi-tenant, with all DVSL fields)

```ts
{
  token: string,                 // FCM token
  leagueId: string,              // NEW for LE — multi-tenant
  uid: string,                   // NEW for LE — auth uid
  categories: string[],          // user's category subscriptions
  teams: string[],               // user's team subscriptions (empty = all)
  authed_teams: string[],        // server-set: teams player is rostered on
                                 // GATES team_chat ONLY (separate from teams[])
  is_captain_authed: boolean,    // server-set: gates captains_chat
  is_admin: boolean,             // server-set: gates adminOnly pushes
  auth_uid: string | null,       // server-set: links to auth user
  player_id: string | null,      // server-set: links to player doc
                                 // used by excludePlayerIds + rosterOnly
  created_at: string,
  updated_at: string,
}
```

**Why `teams` and `authed_teams` are separate** (DVSL comment, send-notification.js:238-242):

> "authed_teams: set by profile.html when a player signs in with Firebase Auth and their doc is linked to a team. Used ONLY to gate team_chat pushes — prevents a subscriber who picked 'all teams' for score notifications from receiving private team chat messages they aren't actually a member of."

A fan who subscribes to "all teams" for score notifications must NOT receive private team_chat messages for teams they're not rostered on. The `teams` field is a subscription preference; `authed_teams` is verified roster membership. Different fields, different filters.

---

## 1. Filter Chain — `api/send-notification.js`

### `listMatchingTokens()` (lines 199-267) — verbatim

```js
async function listMatchingTokens({ projectId, accessToken, category, team, teams, adminOnly, excludePlayerIds, rosterOnly }) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/notification_tokens?pageSize=300`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }});
  const data = await resp.json();
  if (!data.documents) return [];
  // Normalize: prefer `teams` (array); else build single-element from `team`.
  const teamWanted = Array.isArray(teams) && teams.length
    ? teams.filter(Boolean)
    : (team ? [team] : []);
  const excludeIds = Array.isArray(excludePlayerIds) ? excludePlayerIds.filter(Boolean) : [];
  const out = [];
  for (const d of data.documents) {
    const f = d.fields || {};
    const tok = f.token?.stringValue;
    if (!tok) continue;
    // adminOnly filter: only tokens where is_admin === true
    if (adminOnly && f.is_admin?.booleanValue !== true) continue;
    // excludePlayerIds: skip tokens whose player_id is in the list. Used by
    // the captain "Remind waiting" broadcast to skip players who already
    // responded for the target game.
    if (excludeIds.length) {
      const tokPid = f.player_id?.stringValue;
      if (tokPid && excludeIds.includes(tokPid)) continue;
    }
    // rosterOnly: only deliver to tokens that have a player_id (i.e. the
    // recipient is a signed-up roster player), skipping fans / family /
    // other team subscribers who have no claim on a roster spot. Used by
    // captain "Remind waiting" since reminders to mark availability are
    // only meaningful to actual players.
    if (rosterOnly && !f.player_id?.stringValue) continue;
    const cats = (f.categories?.arrayValue?.values || []).map(v => v.stringValue);
    // Categories filter: skip tokens that have explicitly opted into a set
    // that doesn't include this category. EXCEPTION: when `adminOnly` is set,
    // we treat is_admin:true as the explicit subscription — the admin toggle
    // in notifications.html does not write 'admin' to the categories field
    // (it lives in its own row), so without this bypass admin pushes would
    // never deliver to anyone whose categories array is non-empty.
    if (!adminOnly && cats.length && !cats.includes(category)) continue;
    const tokTeams = (f.teams?.arrayValue?.values || []).map(v => v.stringValue);
    // authed_teams: set by profile.html when a player signs in with Firebase
    // Auth and their doc is linked to a team. Used ONLY to gate team_chat
    // pushes — prevents a subscriber who picked "all teams" for score
    // notifications from receiving private team chat messages they aren't
    // actually a member of.
    const tokAuthedTeams = (f.authed_teams?.arrayValue?.values || []).map(v => v.stringValue);
    // is_captain_authed: set by captain.html when a captain successfully
    // signs in via Firebase Auth. Used to gate captains_chat fanout — the
    // notifications.html UI shows a captains_chat toggle that anyone can
    // flip, but this gate ensures only signed-in captains actually receive.
    const tokIsCaptainAuthed = f.is_captain_authed?.booleanValue === true;
    const isTeamChat = category === 'team_chat';
    const isCaptainsChat = category === 'captains_chat';
    if (isTeamChat) {
      // Only push to devices whose authenticated player is on the target team.
      if (!teamWanted.length || !tokAuthedTeams.length) continue;
      if (!teamWanted.some(t => tokAuthedTeams.includes(t))) continue;
    } else if (isCaptainsChat) {
      // Only deliver to tokens flagged as captain-authed by captain.html.
      if (!tokIsCaptainAuthed) continue;
    } else {
      // Empty subscriber teams = "all teams" (always match). Otherwise we need
      // at least one overlap between what we're targeting and what they follow.
      if (teamWanted.length && tokTeams.length && !teamWanted.some(t => tokTeams.includes(t))) continue;
    }
    // Extract the doc ID from the REST path ("projects/.../documents/notification_tokens/{docId}").
    const docId = d.name ? d.name.split('/').pop() : null;
    out.push({ token: tok, docId });
  }
  return out;
}
```

### Filter chain summary (LE multi-tenant version)

For LE, prepend the `leagueId` filter as step 0 — non-negotiable:

1. `where("leagueId", "==", leagueId)` — non-negotiable, FIRST
2. `adminOnly` → drop where `is_admin !== true`
3. `excludePlayerIds` → drop where `player_id` is in list
4. `rosterOnly` → drop where `player_id` is missing
5. **Categories** → if `!adminOnly && cats.length > 0 && !cats.includes(category)` skip
   - Empty `categories[]` = subscribe to all (NOT none)
   - `adminOnly` BYPASSES this check
6. **Team filter — branches by category:**
   - `team_chat`: require `authed_teams` overlap with `teamWanted`
   - `captains_chat`: require `is_captain_authed === true`
   - everything else: require `teams` empty OR `teams` overlap with `teamWanted`
7. After FCM send: prune dead tokens

### Caller + FCM send loop (lines 100-155)

```js
let tokenRows = await listMatchingTokens({...});
// Exclude sender's own token so people don't get pinged for their own chat
// messages. Callers pass their localStorage 'dvsl-notif-token' here.
if (excludeToken) tokenRows = tokenRows.filter(r => r.token !== excludeToken);

if (!tokenRows.length) {
  await logPush({...sent: 0, note: 'No matching subscribers'});
  return res.status(200).json({ sent: 0, note: 'No matching subscribers' });
}

const deadDocIds = []; // tokens to prune (FCM 404/UNREGISTERED)
const results = await Promise.all(tokenRows.map(async row => {
  try { await writePendingNav({...}); } catch (_) {}
  try {
    const r = await fcmSend({...});
    return { tokenPrefix: row.token.slice(0, 24) + '...', ok: true, messageName: r?.name || null };
  } catch(e) {
    // Detect dead-token signals from FCM so we can prune them. The string
    // "UNREGISTERED" or an HTTP 404 means this device is gone.
    const msg = String(e.message || '');
    const isDead = msg.includes('UNREGISTERED')
                || msg.includes('registration-token-not-registered')
                || /FCM\s+404/.test(msg);
    if (isDead && row.docId) deadDocIds.push(row.docId);
    return { ok: false, error: msg, dead: isDead };
  }
}));

// Prune dead tokens — fire and forget, don't block the response.
if (deadDocIds.length) {
  pruneDeadTokens({ projectId, accessToken, docIds: deadDocIds }).catch(...);
}
```

### Dead-token signals — match all three OR'd

```js
msg.includes('UNREGISTERED')
|| msg.includes('registration-token-not-registered')
|| /FCM\s+404/.test(msg)
```

### `pruneDeadTokens` — batched commit (lines 346-357)

```js
async function pruneDeadTokens({ projectId, accessToken, docIds }) {
  if (!docIds.length) return;
  const endpoint = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:commit`;
  const writes = docIds.map(id => ({
    delete: `projects/${projectId}/databases/(default)/documents/notification_tokens/${id}`,
  }));
  await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ writes }),
  });
}
```

Use Firestore batched commit (single API call), not per-token deletes.

### FCM send shape — data-only, no notification block (lines 270-305)

iOS PWA quirk: NO top-level `notification` block. NO webpush.notification. NO fcm_options.link. The SW handles `onBackgroundMessage` → `showNotification` → `notificationclick` end-to-end.

```js
const message = {
  token,
  data: {
    title: String(title || 'DVSL'),
    body: String(body || ''),
    url: clickUrl,
  },
  webpush: {
    headers: { Urgency: 'high', TTL: '86400' },
  },
};
```

---

## 2. Register Flow — `notifications.html:1054-1096`

```js
const categories = ['scores', 'rainouts', 'schedule', 'playoffs', 'team_chat', 'announcements', 'live', 'pregame', 'photos'];
const teams = JSON.parse(localStorage.getItem('dvsl-notif-teams') || '[]');

// Save token to Firestore — backend filters on (categories, teams)
// to decide which tokens to push a given event to. An empty teams
// array means "all teams".
//
// Upsert by FCM token. The previous version unconditionally addDoc'd
// a new row every time Enable was tapped, so users who enabled +
// disabled + re-enabled (or who hit the button twice) accumulated
// duplicate rows and received 2x/3x/Nx copies of every push.
try {
  const existingSnap = await getDocs(query(
    collection(db, 'notification_tokens'),
    where('token', '==', token)
  ));
  if (existingSnap.empty) {
    await addDoc(collection(db, 'notification_tokens'), {
      token, categories, teams, timestamp: new Date()
    });
  } else {
    const [keep, ...dupes] = existingSnap.docs;
    await updateDoc(doc(db, 'notification_tokens', keep.id), {
      categories, teams, timestamp: new Date()
    });
    for (const d of dupes) {
      try { await deleteDoc(doc(db, 'notification_tokens', d.id)); } catch(_) {}
    }
  }
} catch(e) {
  console.warn('Token upsert failed, falling back to addDoc:', e);
  await addDoc(collection(db, 'notification_tokens'), {
    token, categories, teams, timestamp: new Date()
  });
}

localStorage.setItem('dvsl-notif-token', token);
localStorage.setItem('dvsl-notif-categories', JSON.stringify(categories));
```

### Default categories at register — exactly 9, NOT 10

```js
['scores', 'rainouts', 'schedule', 'playoffs', 'team_chat',
 // 'captains_chat' OMITTED — opt-in
 'announcements', 'live', 'pregame', 'photos']
 // 'admin' OMITTED — server-controlled
```

**LE register flow must:**
- Stamp `leagueId` server-side from claim (never trust client)
- Default `teams: []`
- Default `is_captain_authed: false`, `is_admin: false`, `authed_teams: []`
- Set `auth_uid` and `player_id` if user is signed in (from claim/lookup)
- Doc ID: `${token}_${leagueId}` for deterministic upsert across multi-tenant

### Migration helper for existing tokens (lines 872-900)

```js
async function migrateAddTeamChatCategory(token) {
  // Add any categories to existing subscribers' docs that didn't exist when
  // they first enabled notifications. Opt-out for them means unchecking
  // later — opt-in-by-default keeps them in the loop for new features.
  // Note: captains_chat is NOT auto-added — only captains should subscribe,
  // and they opt in by flipping the toggle themselves.
  const NEW_CATS = ['team_chat', 'announcements', 'live', 'pregame', 'photos'];
  ...
}
```

---

## 3. Trust-Field Attach Functions

### `profile.html:1858-1900` — auth team attach + detach

```js
// Attach the current auth'd player's team_id to the notification_tokens doc
// under an authed_teams array. Server-side, team_chat pushes filter on this
// (not the subscription `teams` field) — so subscribing to all teams'
// score notifications no longer leaks team chat messages across teams.
async function _dvslAttachAuthedTeamToPushToken(teamId) {
  if (!teamId) return;
  let token = '';
  try { token = localStorage.getItem('dvsl-notif-token') || ''; } catch(_) {}
  if (!token) return;
  try {
    const snap = await getDocs(query(collection(db, 'notification_tokens'),
      where('token', '==', token)));
    const authUid = auth.currentUser?.uid || null;
    for (const d of snap.docs) {
      const at = Array.isArray(d.data().authed_teams) ? d.data().authed_teams : [];
      const cur = d.data();
      const update = {};
      if (!at.includes(teamId)) update.authed_teams = [...at, teamId];
      // Also pin auth_uid + player_id so server-side push gating can
      // exclude already-responded players from the captains "Remind"
      // broadcast. Only writes when missing or stale.
      if (authUid && cur.auth_uid !== authUid) update.auth_uid = authUid;
      if (MY_AUTH_PLAYER?.id && cur.player_id !== MY_AUTH_PLAYER.id) update.player_id = MY_AUTH_PLAYER.id;
      if (Object.keys(update).length) {
        await updateDoc(doc(db, 'notification_tokens', d.id), update);
      }
    }
  } catch(_) { /* best effort */ }
}

async function _dvslDetachAuthedTeamFromPushToken(teamId) {
  if (!teamId) return;
  let token = '';
  try { token = localStorage.getItem('dvsl-notif-token') || ''; } catch(_) {}
  if (!token) return;
  try {
    const snap = await getDocs(query(collection(db, 'notification_tokens'),
      where('token', '==', token)));
    for (const d of snap.docs) {
      const at = Array.isArray(d.data().authed_teams) ? d.data().authed_teams : [];
      if (!at.includes(teamId)) continue;
      await updateDoc(doc(db, 'notification_tokens', d.id), {
        authed_teams: at.filter(t => t !== teamId),
      });
    }
  } catch(_) { /* best effort */ }
}
```

### `captain.html:2026-2043` — captain flag setter

```js
// Set/clear is_captain_authed on this device's notification_tokens row.
// Server-side captains_chat fanout filters on this flag (mirrors how
// team_chat uses authed_teams). Best-effort — failures don't block the
// captain dashboard from loading.
async function _dvslSetCaptainFlagOnPushToken(value) {
  let token = '';
  try { token = localStorage.getItem('dvsl-notif-token') || ''; } catch(_) {}
  if (!token) return;
  try {
    const snap = await getDocs(query(collection(db, 'notification_tokens'),
      where('token', '==', token)));
    for (const d of snap.docs) {
      await updateDoc(doc(db, 'notification_tokens', d.id), {
        is_captain_authed: !!value
      });
    }
  } catch(_) { /* best effort */ }
}
```

### `notifications.html:1140-1223` — admin toggle init + force-clear + setter

```js
// Authorization for the "Commissioner Alerts" toggle is now keyed off
// the signed-in user's player doc: is_admin === true. The legacy ?admin=1
// URL trick is gone — anyone could have used it to flag themselves.
//
// Flow:
//   onAuthStateChanged → look up player doc by auth_uid →
//     if is_admin: show toggle + load current state
//     else: hide toggle + force is_admin=false on this token (defensive)
async function initAdminToggle() {
  onAuthStateChanged(auth, async (user) => {
    const row = document.getElementById('admin-toggle-row');
    if (!user) {
      if (row) row.classList.add('hidden');
      MY_PLAYER_DOC = null;
      await _forceClearAdminFlagOnToken();
      return;
    }
    try {
      const snap = await getDocs(query(collection(db, 'players'),
        where('auth_uid', '==', user.uid)));
      if (snap.empty) {
        MY_PLAYER_DOC = null;
        if (row) row.classList.add('hidden');
        await _forceClearAdminFlagOnToken();
        return;
      }
      MY_PLAYER_DOC = { id: snap.docs[0].id, ...snap.docs[0].data() };
      const isAdmin = MY_PLAYER_DOC.is_admin === true;
      if (!isAdmin) {
        if (row) row.classList.add('hidden');
        await _forceClearAdminFlagOnToken();
        return;
      }
      // Authorized — show the toggle and reflect current state.
      if (row) row.classList.remove('hidden');
      const token = localStorage.getItem('dvsl-notif-token');
      if (!token) return;
      const tokSnap = await getDocs(query(collection(db, 'notification_tokens'),
        where('token', '==', token)));
      for (const d of tokSnap.docs) {
        const cb = document.getElementById('admin-flag-toggle');
        if (cb) cb.checked = d.data().is_admin === true;
      }
    } catch(e) { console.warn('Admin toggle init failed:', e); }
  });
}

async function _forceClearAdminFlagOnToken() {
  const token = localStorage.getItem('dvsl-notif-token');
  if (!token) return;
  try {
    const snap = await getDocs(query(collection(db, 'notification_tokens'),
      where('token', '==', token)));
    for (const d of snap.docs) {
      if (d.data().is_admin === true) {
        await updateDoc(doc(db, 'notification_tokens', d.id), { is_admin: false });
      }
    }
  } catch(_) {}
}

window.updateAdminFlag = async function() {
  // Re-check authorization on every toggle. If the user isn't actually an
  // admin (e.g. they edited the DOM to un-hide the row), refuse the update.
  if (!MY_PLAYER_DOC || MY_PLAYER_DOC.is_admin !== true) {
    const cb = document.getElementById('admin-flag-toggle');
    if (cb) cb.checked = false;
    return;
  }
  const token = localStorage.getItem('dvsl-notif-token');
  if (!token) return;
  const checked = !!document.getElementById('admin-flag-toggle')?.checked;
  try {
    const q = query(collection(db, 'notification_tokens'), where('token', '==', token));
    const snap = await getDocs(q);
    for (const d of snap.docs) {
      await updateDoc(doc(db, 'notification_tokens', d.id), { is_admin: checked });
    }
  } catch(e) { console.warn('Admin flag update failed:', e); }
};
```

**For LE:** auth-state pattern same, but determine admin via custom claim (`claims.leagues[leagueId] === 'admin'`) instead of `players.is_admin` Firestore lookup. No `?admin=1` URL param.

---

## 4. Prefs UI Markup + Behavior — `notifications.html:595-756`

### Categories block — 11 rows, all checked except captains_chat (and admin hidden)

| Order | data-cat | Label | Sub-label | Default |
|---|---|---|---|---|
| 1 | `scores` | Score Updates | Final scores and live game updates | ✅ checked |
| 2 | `rainouts` | Rainout Alerts | Game cancellations and weather delays | ✅ checked |
| 3 | `schedule` | Schedule Changes | Rescheduled games and field changes | ✅ checked |
| 4 | `playoffs` | Playoff Updates | Bracket updates and elimination results | ✅ checked |
| 5 | `team_chat` | Team Chat | Messages from your captain and teammates | ✅ checked |
| 6 | `captains_chat` | Captains Chat | Messages in the captains & commissioner room (captains only) | ❌ **unchecked** |
| 7 | `announcements` | League Announcements | Commissioner updates and league-wide news | ✅ checked |
| 8 | `live` | Live Games | When a game you follow goes live | ✅ checked |
| 9 | `pregame` | Pre-Game Reminder | One-hour heads-up before your game | ✅ checked |
| 10 | `photos` | Team Photos | When teammates share photos or videos | ✅ checked |
| 11 | `admin` | Commissioner Alerts | Score conflicts, new signups, admin-only alerts | 🚫 hidden (revealed on auth) |

Match this exact copy. Match this exact order. **`captains_chat` MUST default unchecked.**

### "Which teams?" radio — THREE modes (not two)

| Value | Label | Sub-label | When chosen |
|---|---|---|---|
| `all` | All teams | Get score updates and league alerts for every team | Writes `teams: []` |
| `mine` | Just my team [auto-detected name] | Only my team's scores, schedule changes, and chat | Writes `teams: [auto-detected_id]` |
| `custom` | Custom — pick teams | Follow specific teams (e.g. friends' teams, your kid's team) | Reveals checkbox grid |

Mode is reverse-derived from `teams[]` on load (notifications.html:965-977):

```js
let mode = 'all';
if (saved.length === 0) mode = 'all';
else if (saved.length === 1 && teamObj && saved[0] === teamObj.id) mode = 'mine';
else mode = 'custom';
```

### `setTeamMode` (lines 980-999) — verbatim

```js
window.setTeamMode = async function(mode) {
  const host = document.getElementById('team-prefs-list');
  if (mode === 'all') {
    // Empty array means "all teams" in the existing wire format.
    localStorage.setItem('dvsl-notif-teams', JSON.stringify([]));
    document.querySelectorAll('[data-team]').forEach(cb => cb.checked = false);
    host.style.display = 'none';
    await _saveTeamPrefsToFirestore([]);
  } else if (mode === 'mine') {
    const tid = document.getElementById('tm-mine').dataset.teamId;
    if (!tid) return;
    localStorage.setItem('dvsl-notif-teams', JSON.stringify([tid]));
    document.querySelectorAll('[data-team]').forEach(cb => { cb.checked = (cb.dataset.team === tid); });
    host.style.display = 'none';
    await _saveTeamPrefsToFirestore([tid]);
  } else {
    // Custom — reveal the checkbox grid; user picks from there.
    host.style.display = 'flex';
  }
};
```

### Pre-enable state

- Status badge: "Notifications disabled"
- Single button: "Enable Notifications"
- All categories + team-mode UI hidden behind `#enabledSection.hidden`

### Post-enable state

- Status badge flips to "Notifications enabled"
- Categories + team-mode UI revealed
- Bottom: "Disable Notifications" button (calls `disableNotifications()`)

### Coming-soon banner (VAPID not configured)

```html
<div class="coming-soon" id="comingSoon">
  <p><strong>Notifications coming soon!</strong><br>Push notifications are being set up. Check back after the admin configures push notifications in the Firebase Console.</p>
</div>
```

### iOS-PWA-required banner (from notifications.html setup section)

> **🔔 Install the app to enable push notifications**
> On iPhone: tap the Share button in Safari, then "Add to Home Screen."
> On Android: tap the browser menu, then "Install app."
> Push only works once installed.

---

## 5. Trigger-Point Inventory (where pushes fire)

| Trigger | File:Line | Category | Notes |
|---|---|---|---|
| Captain submits, awaiting confirm | `captain.html:1349` | `scores` | "Score submitted: ..." |
| Game flips to done (final) | `captain.html:1321` | `scores` | "Final: ..." |
| Score conflict between captains | `captain.html:1302`, `profile.html:4141` | `admin` + `adminOnly:true` | Admin-only |
| Captain rains out | `captain.html:2782` | `rainouts` | |
| Schedule change | `captain.html:3075`, `admin.html:8392` | `schedule` | |
| Team chat message | `captain.html:5491,5823`, `profile.html:4838,4895` | `team_chat` | Uses `authed_teams` filter |
| Captains chat message | `captain.html:5888`, `profile.html:4966` | `captains_chat` | Requires `is_captain_authed:true` |
| Photo posted | `profile.html:2852` | `photos` | |
| Admin announcement | `admin.html:8446` | `admin` or `announcements` | |
| Live scoring updates | `index.html:5125` | `live` | |
| Pregame ping (1hr before) | (cron in DVSL) | `pregame` | Server-scheduled |

---

## 6. Payload Shape — All Fields `/api/send-notification` Accepts

```ts
type SendPayload = {
  title: string;
  body: string;
  category: typeof CATEGORIES[number];   // exactly 11
  leagueId: string;                       // NEW for LE — never trust client
  team?: string;                          // single team filter
  teams?: string[];                       // multi-team filter
  url?: string;                           // deep link
  adminOnly?: boolean;                    // gates by is_admin, bypasses category prefs
  rosterOnly?: boolean;                   // only roster-linked tokens (player_id present)
  excludeToken?: string;                  // sender's device, suppresses self-notify
  excludePlayerIds?: string[];            // explicit per-player suppress list
  sourceId?: string;                      // dedup key
  imageDataUrl?: string;                  // optional embedded image
}
```

---

## 7. Multi-Tenant Critical Requirement

DVSL is single-tenant; tokens are flat. **LE must scope every read by leagueId.**

### Required guards
- Token doc: must include `leagueId` field (server-stamped, never client-trusted)
- Doc ID convention: `${token}_${leagueId}` for deterministic per-league upsert
- Every `listMatchingTokens` query: prepend `where("leagueId", "==", leagueId)` BEFORE all other filters
- Every server endpoint that reads tokens: derive `leagueId` from verified ID token claim, not client input

### Required test (`tests/integration/notification-tenant-isolation.test.ts`)

Provision two leagues `sfbl` + `kcsl`. Register a token for an SFBL captain (with `leagueId: 'sfbl'`). Fire a KCSL game-final event through `/api/send-notification`. Assert the SFBL token is NOT in the recipient set.

Without this test, a leagueId-filter regression won't surface until a captain in League A receives push for League B — production-affecting bug, hard to debug after the fact.

---

## End — Verification Checklist

Before declaring notifications backbone done:

- [ ] Schema includes all 8 fields beyond token/leagueId/uid (categories, teams, authed_teams, is_captain_authed, is_admin, auth_uid, player_id, created/updated_at)
- [ ] Default 9 categories at register (NOT 10), with captains_chat omitted, admin omitted
- [ ] Filter chain ordering matches DVSL: leagueId → adminOnly → excludePlayerIds → rosterOnly → categories → team-branched filter → excludeToken → fcm → prune
- [ ] team_chat filters on `authed_teams` (server-set), NOT `teams` (user pref)
- [ ] captains_chat filters on `is_captain_authed`
- [ ] `adminOnly: true` BYPASSES category prefs check
- [ ] Empty `categories[]` = subscribe to all (NOT none)
- [ ] Empty `teams[]` = all teams (NOT none)
- [ ] Doc ID is `${token}_${leagueId}` (not just `${token}`)
- [ ] Dead-token pruning detects all 3 signals (UNREGISTERED, registration-token-not-registered, FCM 404)
- [ ] Pruning uses Firestore batched `documents:commit`, not per-token deletes
- [ ] FCM payload is data-only (no top-level notification block)
- [ ] Admin toggle revealed via auth-state + claim check (no `?admin=1`)
- [ ] Cross-tenant rules test passes — SFBL token does not receive KCSL push
- [ ] 11-category prefs UI matches exact copy + ordering + checked-state from `notifications.html:595-722`
- [ ] Team-mode UI has THREE radio options (all / mine / custom)
