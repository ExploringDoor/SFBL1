# DVSL Attendance + Chat + Trigger Payloads — Verbatim Spec for LeagueEngine Port

**Source:** `~/Desktop/softball-site/`
**Companion to:** `docs/dvsl-notifications-spec.md` (read that first for the schema + filter chain)
**Purpose:** Field-for-field reference for porting attendance, team chat, captains chat, announcements, and the 11 push trigger payloads.

---

## TL;DR — Key gotchas surfaced while reading source

1. **Chat collections are flat, not subcollections.** Team chat → `/team_messages` filtered by `team_id`. Captains chat → `/captain_chat` (league-wide, no team filter). Both store doc shape verbatim below.
2. **There are TWO captain implementations** — `captain.html` (auth-gated dashboard) and `profile.html` (player-side captain affordances). They write to the same Firestore collections but have different doc-field names. **You need to handle BOTH shapes when reading.**
3. **`captainRemindWaiting`** appears in both `captain.html` (full implementation with `excludePlayerIds`) and `profile.html` (simpler version without). Port the captain.html version — it's the canonical one.
4. **A historical bug bit them once already:** `category: 'captain_chat'` (singular) was used in `profile.html` while everywhere else used `'captains_chat'` (plural). Pushes silently dropped. Comment is at `profile.html:4962`. Pick `captains_chat` and grep your codebase for any singular variant.
5. **Pregame is a Vercel cron** (`api/pregame-reminder.js`), not an in-app trigger. Runs every 15 min, uses `pregame_reminder_sent: true` flag for exactly-once.
6. **Chat real-time pattern:** `onSnapshot` with `orderBy('timestamp','asc')` + `limit(100)` for team chat, `limitToLast(200)` for captains chat. The `limitToLast` choice avoids needing a `desc` index.
7. **Delete cascades to push history** via `/api/delete-by-source` — when a chat message is deleted, the corresponding `pending_nav` doc is also deleted so it disappears from recipients' notification bells.

---

## 1. ATTENDANCE — `captain.html`

### Firestore collection: `/availability`

**Doc ID:** `${team_id}_${game_id}_${player_id}`
**Doc shape:**
```ts
{
  game_id: string,
  player_id: string,
  player_name: string,        // denormalized for fast read in renderTeamAvailability
  team_id: string,
  status: 'yes' | 'maybe' | 'no',
  updated_at: string,         // ISO timestamp
}
```

For LE multi-tenant: add `leagueId: string` and scope all queries.

### `renderAttendance()` — captain.html:5255

```js
function renderAttendance() {
  // Populate player dropdown
  const sel = document.getElementById('avail-player-select');
  if (sel && MY_PLAYERS.length && sel.options.length <= 1) {
    MY_PLAYERS.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name + (p.num ? ` (#${p.num})` : '');
      sel.appendChild(opt);
    });
    // Restore saved selection
    const saved = localStorage.getItem('avail_player_' + captainData.team_id);
    if (saved) sel.value = saved;
  }
  showAvailView(_availView);
}

window.onAvailPlayerChange = function() {
  const sel = document.getElementById('avail-player-select');
  localStorage.setItem('avail_player_' + captainData.team_id, sel.value);
  showAvailView('my');
};

window.showAvailView = async function(view) {
  _availView = view;
  document.getElementById('avail-tab-my').className   = view === 'my'   ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm';
  document.getElementById('avail-tab-team').className = view === 'team' ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm';
  document.getElementById('avail-tab-edit').className = view === 'edit' ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm';
  if (view === 'my') await renderMyAvailability();
  else if (view === 'team') await renderTeamAvailability();
  else await renderCaptainEdit();
};
```

**Three views:**
- `my` — player picks their name from a dropdown, sees upcoming games with Yes/Maybe/No buttons
- `team` — captain sees team-wide RSVP summary (Yes/Maybe/No/Waiting columns) + "Remind Waiting" button
- `edit` — captain edit grid: every player × every game, captain can set anyone's RSVP

### `renderMyAvailability()` — captain.html:5288

```js
async function renderMyAvailability() {
  const el = document.getElementById('attendance-content');
  const sel = document.getElementById('avail-player-select');
  const playerId = sel?.value;
  if (!playerId) {
    el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted);font-size:13px">Select your name above to get started.</div>';
    return;
  }
  const player = MY_PLAYERS.find(p => p.id === playerId);
  el.innerHTML = '<div class="loading"><div class="spinner"></div> Loading...</div>';

  // Load existing RSVPs for this player
  try {
    const snap = await getDocs(query(
      collection(db, 'availability'),
      where('player_id', '==', playerId),
      where('team_id', '==', captainData.team_id)
    ));
    _availRsvps = {};
    snap.docs.forEach(d => { _availRsvps[d.data().game_id] = d.data().status; });
  } catch(e) { _availRsvps = {}; }

  const upcoming = MY_GAMES.filter(g => !g.done).sort((a,b) => (a.wk||0)-(b.wk||0));
  const past = MY_GAMES.filter(g => g.done).sort((a,b) => (b.wk||0)-(a.wk||0)).slice(0,5);

  // ...gameBlock(games, label) renders Wk/opponent/date/buttons row per game

  el.innerHTML = `
    <div style="font-size:13px;font-weight:600;margin-bottom:16px">Marking availability as: <span style="color:var(--navy)">${player?.name || ''}</span></div>
    ${upcoming.length ? gameBlock(upcoming, 'Upcoming Games') : '<div style="padding:20px;text-align:center;color:var(--muted);font-size:13px">No upcoming games scheduled.</div>'}
    ${past.length ? gameBlock(past, 'Recent Games') : ''}`;
}
```

### `setAvail()` — toggle-off behavior — captain.html:5346

```js
window.setAvail = async function(gameId, status, playerId, rerender) {
  // If no playerId passed, use the dropdown (player setting their own)
  const ownEntry = !playerId;
  if (!playerId) {
    const sel = document.getElementById('avail-player-select');
    playerId = sel?.value;
  }
  if (!playerId) return;
  const player = MY_PLAYERS.find(p => p.id === playerId);
  const docId = captainData.team_id + '_' + gameId + '_' + playerId;
  try {
    // Toggle off: clicking the already-selected status clears the response
    const current = ownEntry ? _availRsvps[gameId] : null;
    if (ownEntry && current === status) {
      await deleteDoc(doc(db, 'availability', docId));
      delete _availRsvps[gameId];
    } else {
      await setDoc(doc(db, 'availability', docId), {
        game_id: gameId,
        player_id: playerId,
        player_name: player?.name || '',
        team_id: captainData.team_id,
        status: status,
        updated_at: new Date().toISOString()
      });
      if (ownEntry) _availRsvps[gameId] = status;
    }
    if (rerender === 'edit') await renderCaptainEdit();
    else await renderMyAvailability();
  } catch(e) {
    toast('Could not save: ' + e.message, 'error');
  }
};
```

**Tap-the-already-selected-status to clear** — UX detail. Match this.

### `renderTeamAvailability()` — captain.html:5380

Builds a per-game RSVP summary with four columns: Yes / Maybe / No / Waiting. "Waiting" is computed by subtracting the responded-names set from the full roster.

```js
async function renderTeamAvailability() {
  const el = document.getElementById('attendance-content');
  el.innerHTML = '<div class="loading"><div class="spinner"></div> Loading team RSVPs...</div>';
  try {
    const snap = await getDocs(query(
      collection(db, 'availability'),
      where('team_id', '==', captainData.team_id)
    ));
    // Build map: gameId → {yes:[names], maybe:[names], no:[names]}
    const byGame = {};
    snap.docs.forEach(d => {
      const r = d.data();
      if (!byGame[r.game_id]) byGame[r.game_id] = { yes:[], maybe:[], no:[], all:new Set() };
      if (r.status === 'yes' || r.status === 'maybe' || r.status === 'no') {
        byGame[r.game_id][r.status].push(r.player_name);
        byGame[r.game_id].all.add(r.player_name);
      }
    });

    const upcoming = MY_GAMES.filter(g => !g.done).sort((a,b) => (a.wk||0)-(b.wk||0));
    if (!upcoming.length) { el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted);font-size:13px">No upcoming games.</div>'; return; }

    el.innerHTML = upcoming.map(g => {
      const opp = g.away === captainData.team_id ? g.home : g.away;
      const oppTeam = ALL_TEAMS.find(t => t.id === opp);
      const oppName = oppTeam?.name || opp?.toUpperCase() || 'TBD';
      const homeAway = g.home === captainData.team_id ? 'vs' : '@';
      const rsvp = byGame[g.id] || { yes:[], maybe:[], no:[], all:new Set() };
      const responded = rsvp.yes.length + rsvp.maybe.length + rsvp.no.length;
      const total = MY_PLAYERS.length;
      // Pending = roster names not yet in the responded set.
      const pending = MY_PLAYERS.filter(p => !rsvp.all.has(p.name)).map(p => p.name);
      // ...renders four columns + "📢 Remind N waiting" button
    }).join('');
  }
  // ...
}
```

### `captainRemindWaiting()` — captain.html:5449 — THE canonical implementation

This is the one that uses `excludePlayerIds`. The `profile.html` version is simpler and lacks this.

```js
// Push a "please mark availability" reminder to everyone subscribed to
// this team. Uses category 'announcements' (not team_chat) so it
// reaches subscribers who haven't signed in via Firebase Auth yet —
// most of the league at this stage. team_chat would only deliver to
// the few players already authed, which defeats the purpose of
// reminding the un-signed-up players to sign up.
//
// (Note: comment says "announcements" but actual code uses 'team_chat'.
// The comment is stale — DO follow the code, not the comment, when porting.)
window.captainRemindWaiting = async function(gameId, btn) {
  const g = MY_GAMES.find(x => x.id === gameId);
  if (!g) { toast('Game not found', 'error'); return; }
  const team = ALL_TEAMS.find(t => t.id === captainData.team_id);
  if (!team) { toast('Team context missing — refresh and try again', 'error'); return; }
  const oppId = g.away === team.id ? g.home : g.away;
  const oppTeam = ALL_TEAMS.find(t => t.id === oppId);
  const oppName = oppTeam?.name || oppId?.toUpperCase() || 'TBD';
  const ha = g.home === team.id ? 'vs' : '@';
  const when = [g.date, g.time].filter(Boolean).join(' ');
  const title = (team.short || team.name) + ' · Availability needed';
  const body = `Please mark your availability for Wk ${g.wk||'?'} ${ha} ${oppName}${when ? ' · ' + when : ''}. Tap to submit.`;
  const prevLabel = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = 'Sending…'; }
  // Compute the player_ids of teammates who already responded so the
  // server can skip their devices. Cross-references the availability
  // collection (player_name) against MY_PLAYERS (id + name + auth_uid).
  let excludePlayerIds = [];
  try {
    const aSnap = await getDocs(query(collection(db,'availability'),
      where('team_id','==', team.id), where('game_id','==', gameId)));
    const respondedNames = new Set();
    aSnap.docs.forEach(d => {
      const r = d.data();
      if (['yes','maybe','no'].includes(r.status)) respondedNames.add(r.player_name);
    });
    excludePlayerIds = MY_PLAYERS
      .filter(p => respondedNames.has(p.name))
      .map(p => p.id)
      .filter(Boolean);
  } catch(_) { /* best effort — fall through to broad delivery */ }
  try {
    const resp = await fetch('/api/send-notification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': CAPTAIN_PUSH_SECRET },
      body: JSON.stringify({
        title, body,
        // team_chat is gated server-side on authed_teams: only delivers to
        // signed-in players whose roster spot links to the target team.
        // That prevents leakage to other teams' subscribers (e.g. a TBIR
        // player who'd subscribed to OA score updates won't get OA's
        // availability reminder).
        category: 'team_chat',
        teams: [team.id],
        url: '/profile.html#avail',
        excludeToken: localStorage.getItem('dvsl-notif-token') || undefined,
        excludePlayerIds,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    const sent = Number(data.sent) || 0;
    toast(sent ? `Sent to ${sent} player${sent===1?'':'s'} ✓` : 'No waiting players to nudge', sent ? 'success' : 'error');
    if (btn) { btn.innerHTML = sent ? `Sent ✓` : 'None to nudge'; setTimeout(() => { btn.disabled = false; btn.innerHTML = prevLabel; }, 4000); }
  } catch(e) {
    toast('Reminder failed: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = prevLabel; }
  }
};
```

**Critical:** `excludePlayerIds` requires `rosterOnly: true` to work AND each `notification_tokens` doc must have `player_id` set (server-stamped from auth flow — see notifications spec). For the team_chat category, gating already filters to signed-in players via `authed_teams`, so `rosterOnly` is implied.

### `renderCaptainEdit()` — captain edit view — captain.html:5509

```js
async function renderCaptainEdit() {
  const el = document.getElementById('attendance-content');
  el.innerHTML = '<div class="loading"><div class="spinner"></div> Loading...</div>';
  try {
    const snap = await getDocs(query(
      collection(db, 'availability'),
      where('team_id', '==', captainData.team_id)
    ));
    // Build map: playerId_gameId → status
    const rsvpMap = {};
    snap.docs.forEach(d => {
      const r = d.data();
      rsvpMap[r.player_id + '_' + r.game_id] = r.status;
    });

    const upcoming = MY_GAMES.filter(g => !g.done).sort((a,b) => (a.wk||0)-(b.wk||0));
    // ...renders one row per player with a button-group per upcoming game
  } catch(e) {
    el.innerHTML = `<div class="empty">Could not load: ${e.message}</div>`;
  }
}

window.setCaptainAvail = async function(gameId, playerId, status) {
  const player = MY_PLAYERS.find(p => p.id === playerId);
  const docId = captainData.team_id + '_' + gameId + '_' + playerId;
  try {
    await setDoc(doc(db, 'availability', docId), {
      game_id: gameId, player_id: playerId,
      player_name: player?.name || '',
      team_id: captainData.team_id,
      status, updated_at: new Date().toISOString()
    });
    await renderCaptainEdit();
  } catch(e) { toast('Could not save: ' + e.message, 'error'); }
};

window.clearAvail = async function(gameId, playerId) {
  const pid = playerId || document.getElementById('avail-player-select')?.value;
  if (!pid) return;
  const docId = captainData.team_id + '_' + gameId + '_' + pid;
  try {
    await deleteDoc(doc(db, 'availability', docId));
    if (pid === document.getElementById('avail-player-select')?.value) delete _availRsvps[gameId];
    if (_availView === 'edit') await renderCaptainEdit();
    else await renderMyAvailability();
  } catch(e) { toast('Could not clear: ' + e.message, 'error'); }
};
```

---

## 2. TEAM CHAT — `captain.html` + `profile.html`

### Firestore collection: `/team_messages`

**Doc shape from captain.html:5795:**
```ts
{
  text: string,
  author_email: string,
  author_name: string,        // captain's real first+last name
  is_captain: true,
  team_id: string,
  team_name: string,
  team_color: string,         // for chat-bubble rendering
  timestamp: serverTimestamp(),
}
```

**Older doc shape from profile.html:4825 (still in production):**
```ts
{
  team_id: string,
  sender_id: string,          // = team_id (legacy)
  sender_name: string,        // "<short> (Captain)" — older format
  text: string,
  is_captain: true,
  timestamp: serverTimestamp(),
}
```

**LE port:** unify on the captain.html shape (`author_email`, `author_name`, `team_color`) and add `leagueId`. The profile.html shape exists only because old messages still live in Firestore; render-time code handles both. Inline comment at captain.html:5648:

> "Team Chat: prefer the sender's real name. author_name on the message is the source of truth (captains now write their own name on send -- see sendTeamMsg). Older captain messages stored 'Team Name (Captain)' in author_name; detect that and swap in the captain's real name from ALL_CAPTAINS by email."

### `setupChatListeners()` — captain.html:5726 — onSnapshot pattern

```js
function setupChatListeners() {
  // ── Team Chat ──
  if (_unsubTeamChat) _unsubTeamChat();
  const teamQ = query(
    collection(db, 'team_messages'),
    where('team_id', '==', captainData.team_id),
    orderBy('timestamp', 'asc'),
    limit(100)
  );
  _unsubTeamChat = onSnapshot(teamQ, snap => {
    const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const activeTab = document.querySelector('.tab-item.active')?.dataset?.tab;
    renderChatMessages(msgs, 'teamchat-messages', currentUser.email);
    // Show badge if not currently viewing this tab
    if (activeTab !== 'teamchat' && msgs.length > 0) {
      const lastRead = parseInt(localStorage.getItem('lastRead_teamchat_' + currentUser.email) || '0');
      const lastMsg = msgs[msgs.length - 1];
      const lastMsgTime = lastMsg.timestamp?.toDate ? lastMsg.timestamp.toDate().getTime() : 0;
      if (lastMsgTime > lastRead) {
        const unread = msgs.filter(m => {
          const mt = m.timestamp?.toDate ? m.timestamp.toDate().getTime() : 0;
          return mt > lastRead && m.author_email !== currentUser.email;
        }).length;
        const b = document.getElementById('badge-teamchat');
        if (b && unread > 0) { b.textContent = unread > 9 ? '9+' : unread; b.hidden = false; }
      }
    }
  });
  // ...captQ similar but no team filter, see Captains Chat section
}
```

### `renderChatMessages()` — captain.html:5604 — bubble rendering

```js
function renderChatMessages(msgs, containerId, myEmail) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!msgs.length) { el.innerHTML = '<div class="empty">No messages yet. Say hello!</div>'; CHAT_CACHE[containerId] = {}; return; }
  // Which Firestore collection are these messages in? Team chat uses
  // team_messages; captains chat uses captain_chat. We need this for the
  // delete call to target the right doc.
  const collName = containerId === 'teamchat-messages' ? 'team_messages' : 'captain_chat';
  // Captains moderate their own team chat — they can delete anyone's
  // message in team chat. In captains chat, they can only delete their own.
  const canModerateOthers = containerId === 'teamchat-messages';
  CHAT_CACHE[containerId] = {};
  msgs.forEach(m => { CHAT_CACHE[containerId][m.id] = m; });
  // Captains Chat bubble labels are "SHORT (Captain Full Name)" -- short
  // keeps it tight on mobile, the name in parens tells Adam which captain
  // is talking (per-message). Team Chat bubbles show the sender's real
  // first+last name (Adam: "you should be using the person's first and
  // last name, so if I'm signed in you should see that coming from my
  // name").
  const preferShort = containerId === 'captchat-messages';
  el.innerHTML = msgs.map(m => {
    const mine = m.author_email === myEmail;
    const canDelete = mine || canModerateOthers;
    const delBtn = canDelete
      ? `<button class="chat-del" data-cid="${containerId}" data-coll="${collName}" data-mid="${esc(m.id)}" title="Delete">×</button>`
      : '';
    let label;
    if (preferShort) {
      // Captains Chat: "SHORT (Captain Name)"
      const byId = m.team_id ? ALL_TEAMS.find(t => t.id === m.team_id) : null;
      const byName = !byId && m.team_name ? ALL_TEAMS.find(t => t.name === m.team_name) : null;
      const short = m.team_short || byId?.short || byName?.short || m.team_name || '';
      const senderLc = (m.author_email || '').toLowerCase();
      const senderCap = senderLc
        ? (ALL_CAPTAINS || []).find(c => (c.email || '').toLowerCase() === senderLc)
        : null;
      const firstForTeam = m.team_id
        ? (ALL_CAPTAINS || []).find(c => c.team_id === m.team_id)
        : null;
      const capName = senderCap?.name || firstForTeam?.name || '';
      label = capName ? `${short} (${capName})` : (short || m.author_email || 'Unknown');
    } else {
      // Team Chat: prefer the sender's real name. author_name on the
      // message is the source of truth (captains now write their own
      // name on send -- see sendTeamMsg). Older captain messages stored
      // "Team Name (Captain)" in author_name; detect that and swap in
      // the captain's real name from ALL_CAPTAINS by email.
      let name = m.author_name || '';
      if (/\(captain\)\s*$/i.test(name)) {
        const lc = (m.author_email || '').toLowerCase();
        const cap = lc
          ? (ALL_CAPTAINS || []).find(c => (c.email || '').toLowerCase() === lc)
          : null;
        if (cap?.name) name = cap.name;
      }
      label = name || m.author_email || m.team_name || 'Unknown';
    }
    return `<div class="chat-msg ${mine ? 'mine' : 'theirs'}">
      ${!mine ? `<div class="chat-meta">${esc(label)}</div>` : ''}
      <div class="chat-bubble">${esc(m.text)}${delBtn}</div>
      <div class="chat-meta">${fmtChatTime(m.timestamp)}</div>
    </div>`;
  }).join('');
  el.querySelectorAll('.chat-del').forEach(btn => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      deleteChatMessage(btn.dataset.cid, btn.dataset.coll, btn.dataset.mid);
    });
  });
  el.scrollTop = el.scrollHeight;
}
```

### `sendTeamMsg()` — captain.html:5778

```js
window.sendTeamMsg = async function() {
  const input = document.getElementById('teamchat-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  input.disabled = true;
  const teamName = MY_TEAM?.name || captainData.team_name;
  // Write the captain's real first+last name as author_name so Team Chat
  // renders "Adam Miller" (not "Tifereth Bet Israel -- Royals (Captain)")
  // in the bubble header.
  const myCapDoc = (ALL_CAPTAINS || []).find(c =>
    c.team_id === captainData.team_id &&
    (c.email || '').toLowerCase() === (currentUser.email || '').toLowerCase()
  );
  const myName = myCapDoc?.name || currentUser.displayName || currentUser.email || 'Captain';
  try {
    const msgRef = await addDoc(collection(db, 'team_messages'), {
      text,
      author_email: currentUser.email,
      author_name: myName,
      is_captain: true,
      team_id: captainData.team_id,
      team_name: teamName,
      team_color: MY_TEAM?.color || '#002D72',
      timestamp: serverTimestamp(),
    });
    // Fire push notification to opted-in players of this team.
    try {
      const capDoc = (ALL_CAPTAINS || []).find(c =>
        c.team_id === captainData.team_id &&
        (c.email || '').toLowerCase() === (currentUser.email || '').toLowerCase()
      );
      const pushTitle = capDoc?.name
        || `${MY_TEAM?.short || captainData.team_id} — Captain`;
      await fetch('/api/send-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': 'dvsl-push-2026-rkj3849f' },
        body: JSON.stringify({
          title: pushTitle,
          body: text.length > 120 ? text.slice(0, 120) + '…' : text,
          category: 'team_chat',
          team: captainData.team_id,
          url: `/team-chat.html?team=${encodeURIComponent(captainData.team_id)}`,
          sourceId: msgRef.id,
          excludeToken: localStorage.getItem('dvsl-notif-token') || undefined,
        }),
      });
    } catch(e) { console.warn('Team push failed (message still delivered in-app):', e); }
    // Email players who have an email on file
    if (EMAILJS_ENABLED) { /* per-player emailjs.send(...) loop */ }
    localStorage.setItem('lastRead_teamchat_' + currentUser.email, Date.now());
    const b = document.getElementById('badge-teamchat'); if (b) b.hidden = true;
  } catch(e) { toast('Failed to send: ' + e.message, 'error'); }
  input.disabled = false;
  input.focus();
};
```

**Note:** push uses `team:` (singular) not `teams:[]`. Server normalizes to single-element array (see filter chain in notifications spec).

### Delete + cascade — captain.html:5679

```js
async function deleteChatMessage(containerId, collName, mid) {
  const m = CHAT_CACHE[containerId]?.[mid];
  if (!m) return;
  const preview = (m.text || '').slice(0, 60);
  if (!confirm(`Delete this message?\n\n"${preview}${m.text?.length > 60 ? '…' : ''}"`)) return;
  try {
    await deleteDoc(doc(db, collName, mid));
    // Cascade-clear matching pending_nav rows so the corresponding push
    // disappears from every recipient's bell panel. Fire-and-forget.
    fetch('/api/delete-by-source', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': 'dvsl-push-2026-rkj3849f' },
      body: JSON.stringify({ sourceId: mid }),
    }).catch(() => {});
    // onSnapshot listener will re-render
  } catch(e) {
    alert('Could not delete: ' + e.message);
  }
}
```

**Build a parallel `/api/delete-by-source` endpoint** in LE — it deletes `pending_nav` docs by `sourceId` so message deletion cleans up the notification bell on every recipient's device. The `sourceId` is the message doc ID (passed in the original `send-notification` payload).

### Reset entire team chat — captain.html:5701

```js
window.resetTeamChat = async function() {
  const teamName = captainData?.team_name || captainData?.team_id || 'your team';
  if (!confirm(`Reset the entire Team Chat for ${teamName}?\n\nThis deletes ALL messages permanently. This cannot be undone.`)) return;
  if (!confirm('Are you absolutely sure? Last chance to back out.')) return;
  try {
    const q = query(collection(db, 'team_messages'), where('team_id', '==', captainData.team_id));
    const snap = await getDocs(q);
    if (!snap.docs.length) { alert('Chat is already empty.'); return; }
    let remaining = snap.docs.slice();
    while (remaining.length) {
      const chunk = remaining.splice(0, 400);
      const batch = writeBatch(db);
      chunk.forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
    alert(`Deleted ${snap.docs.length} message(s).`);
  } catch(e) {
    alert('Reset failed: ' + e.message);
  }
};
```

400-doc batching to stay under Firestore's 500-op writeBatch limit. Match this.

---

## 3. CAPTAINS CHAT — `captain.html` + `profile.html`

### Firestore collection: `/captain_chat` (NO team filter — league-wide)

**Doc shape from captain.html:5861:**
```ts
{
  text: string,
  author_email: string,
  team_id: string,
  team_name: string,
  team_short: string,
  team_color: string,
  timestamp: serverTimestamp(),
}
```

For LE multi-tenant: add `leagueId`. League-wide within a single tenant.

### Listener — captain.html:5755

```js
// ── Captains Chat ──
if (_unsubCaptChat) _unsubCaptChat();
const captQ = query(
  collection(db, 'captain_chat'),
  orderBy('timestamp', 'asc'),
  limit(100)
);
_unsubCaptChat = onSnapshot(captQ, snap => {
  const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const activeTab = document.querySelector('.tab-item.active')?.dataset?.tab;
  renderChatMessages(msgs, 'captchat-messages', currentUser.email);
  if (activeTab !== 'captchat' && msgs.length > 0) {
    const lastRead = parseInt(localStorage.getItem('lastRead_captchat_' + currentUser.email) || '0');
    const unread = msgs.filter(m => {
      const mt = m.timestamp?.toDate ? m.timestamp.toDate().getTime() : 0;
      return mt > lastRead && m.author_email !== currentUser.email;
    }).length;
    const b = document.getElementById('badge-captchat');
    if (b && unread > 0) { b.textContent = unread > 9 ? '9+' : unread; b.hidden = false; }
  }
});
```

### Listener — profile.html:4920 — uses `limitToLast(200)` to avoid extra index

```js
function activateCaptainCaptChat() {
  // Captain-chat subscription is league-wide (no per-team filter), so
  // once set up it stays valid across tab switches. No need to tear
  // down and re-subscribe every time the Captains tab is activated.
  if (_unsubCaptChat) return;
  // v97: asc + limitToLast so we use the existing asc index (no new index required).
  const q = query(collection(db, 'captain_chat'),
    orderBy('timestamp', 'asc'), limitToLast(200));
  _unsubCaptChat = onSnapshot(q, snap => {
    const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderCaptainCaptChat(msgs);
  });
}
```

**Why `asc + limitToLast` not `desc + limit`:** avoids a new Firestore composite index. Match this. Note the inline comment.

### `sendCaptMsg()` — captain.html:5854

```js
window.sendCaptMsg = async function() {
  const input = document.getElementById('captchat-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  input.disabled = true;
  try {
    const msgRef = await addDoc(collection(db, 'captain_chat'), {
      text,
      author_email: currentUser.email,
      team_id: captainData.team_id,
      team_name: MY_TEAM?.name || captainData.team_name,
      team_short: MY_TEAM?.short || captainData.team_id || '',
      team_color: MY_TEAM?.color || '#002D72',
      timestamp: serverTimestamp(),
    });
    // Fire a push to everyone subscribed to captains_chat (no team filter —
    // this room is league-wide for captains + commissioners).
    try {
      // Title format: "TBI — Mark Schwartz" — short team code + captain's
      // real name. Falls back to "<short> — Captain" if we can't find the
      // captain doc for this logged-in email.
      const teamShort = MY_TEAM?.short || captainData.team_id;
      const capDoc = (ALL_CAPTAINS || []).find(c =>
        c.team_id === captainData.team_id &&
        (c.email || '').toLowerCase() === (currentUser.email || '').toLowerCase()
      );
      const senderName = capDoc?.name || 'Captain';
      await fetch('/api/send-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': 'dvsl-push-2026-rkj3849f' },
        body: JSON.stringify({
          title: `${teamShort} — ${senderName}`,
          body: text.length > 120 ? text.slice(0, 120) + '…' : text,
          category: 'captains_chat',
          url: '/captain.html?tab=captchat',
          sourceId: msgRef.id,
          excludeToken: localStorage.getItem('dvsl-notif-token') || undefined,
        }),
      });
    } catch(e) { console.warn('Captains-chat push failed (message still delivered in-app):', e); }
    // Email all other captains
    if (EMAILJS_ENABLED) { /* per-captain emailjs.send(...) loop */ }
    localStorage.setItem('lastRead_captchat_' + currentUser.email, Date.now());
    const b = document.getElementById('badge-captchat'); if (b) b.hidden = true;
  } catch(e) { toast('Failed to send: ' + e.message, 'error'); }
  input.disabled = false;
  input.focus();
};
```

**No `team` filter on the push** — captains_chat is league-wide. Server filter is `is_captain_authed === true` only.

---

## 4. ANNOUNCEMENTS — `admin.html`

DVSL doesn't have a separate "announcement" feature — it's a generic "Send Push Notification" form in admin where the commissioner picks any category. The category dropdown is at admin.html:1234, default selected is `announcements`.

### Form (admin.html ~1208-1240)

```html
<strong>📣 League-wide announcement?</strong> Set Category to <em>Announcements</em>, leave Team blank, write your message, hit Send. Goes to everyone subscribed to Announcements.

<select id="push-category">
  <option value="announcements" selected>📣 Announcements (league-wide)</option>
  <!-- ...other categories -->
</select>
```

### Send handler — admin.html:8656

```js
window.sendPushNotification = async function() {
  const title = document.getElementById('push-title').value.trim();
  const body  = document.getElementById('push-body').value.trim();
  const category = document.getElementById('push-category').value;
  const team = document.getElementById('push-team').value || undefined;
  // When an image is attached, default the click destination to the
  // inbox so the user can see the full-size photo (tap-to-zoom). Without
  // a URL, FCM notifications either no-op or open the start page; with
  // a URL, our service worker routes the user there.
  let url = document.getElementById('push-url').value.trim();
  if (!url && _pushImageDataUrl) url = '/inbox.html';
  url = url || undefined;
  const result = document.getElementById('push-result');

  if (!title || !body) { toast('Title and message are required', 'error'); return; }
  const imgNote = _pushImageDataUrl ? ' (with photo)' : '';
  if (!confirm(`Send push "${title}"${imgNote} to ${team ? getTeamName(team)+' subscribers' : 'ALL subscribers'}?`)) return;

  result.innerHTML = `<span style="color:var(--muted2)">Sending...</span>`;
  try {
    const resp = await fetch('/api/send-notification', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(PUSH_ADMIN_SECRET ? { 'X-Admin-Secret': PUSH_ADMIN_SECRET } : {}),
      },
      body: JSON.stringify({
        title, body, category, team, url,
        adminOnly: category === 'admin' || undefined,
        imageDataUrl: _pushImageDataUrl || undefined,
      }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.detail || data.error || `HTTP ${resp.status}`);
    result.innerHTML = `<span style="color:#16a34a">✓ Sent to ${data.sent} device${data.sent===1?'':'s'}${data.failed ? ` (${data.failed} failed)` : ''}${_pushImageDataUrl ? ' (with photo)' : ''}</span>`;
    await logActivity('Push Notifications', `Sent "${title}"${_pushImageDataUrl?' (with photo)':''} (${category}${team?', '+getTeamName(team):''}) to ${data.sent} devices`);
    if (_pushImageDataUrl) clearPushImage();
  } catch(err) {
    result.innerHTML = `<span style="color:#dc2626">✗ ${err.message}</span>`;
  }
};
```

**Key features:**
- Optional `imageDataUrl` for photo-attached pushes
- Auto-defaults `url` to `/inbox.html` if image attached and no URL set
- Auto-sets `adminOnly: true` if category is `admin`
- Confirmation prompt before sending

For LE: same form, scoped to current tenant's leagueId (server-stamped).

---

## 5. THE 11 TRIGGER PAYLOADS — Verbatim Code Blocks

### 5.1 — Captain submits, awaiting confirm (`scores`)

**File:** `captain.html:1351-1371` — `sendScoreSubmittedPush`

```js
function sendScoreSubmittedPush(g, awayScore, homeScore, submittedBy) {
  if (!g || !g.away || !g.home) return;
  const awayName = ALL_TEAMS.find(t => t.id === g.away)?.name || g.away;
  const homeName = ALL_TEAMS.find(t => t.id === g.home)?.name || g.home;
  const parts = [];
  if (submittedBy) parts.push(`by ${submittedBy}`);
  if (g.wk) parts.push(`Week ${g.wk}`);
  if (g.date) parts.push(g.date);
  return fetch('/api/send-notification', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': CAPTAIN_PUSH_SECRET },
    body: JSON.stringify({
      title: `Score submitted: ${awayName} ${awayScore}, ${homeName} ${homeScore}`,
      body: parts.join(' · ') || 'Awaiting confirmation from the other captain',
      category: 'scores',
      teams: [g.away, g.home],
      url: g.id ? `/#game/${g.id}` : '/#scores',
      excludeToken: localStorage.getItem('dvsl-notif-token') || undefined,
    }),
  }).catch(e => console.warn('Score submitted push failed:', e));
}
```

**Guard:** fires on FIRST captain's submission (before the other captain confirms). Once both align and `done` flips true, `sendFinalScorePush` takes over.

### 5.2 — Game flips to done (`scores` + maybe `playoffs`)

**File:** `captain.html:1321-1343` — `sendFinalScorePush`

```js
function sendFinalScorePush(g, awayScore, homeScore) {
  if (!g || !g.away || !g.home) return;
  const awayName = ALL_TEAMS.find(t => t.id === g.away)?.name || g.away;
  const homeName = ALL_TEAMS.find(t => t.id === g.home)?.name || g.home;
  const parts = [];
  if (g.wk) parts.push(`Week ${g.wk}`);
  if (g.date) parts.push(g.date);
  return fetch('/api/send-notification', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': CAPTAIN_PUSH_SECRET },
    body: JSON.stringify({
      title: `Final: ${awayName} ${awayScore}, ${homeName} ${homeScore}`,
      body: parts.join(' · ') || 'Game final',
      category: 'scores',
      teams: [g.away, g.home],
      url: g.id ? `/#game/${g.id}` : '/#scores',
      excludeToken: localStorage.getItem('dvsl-notif-token') || undefined,
    }),
  }).catch(e => console.warn('Final score push failed:', e));
}
```

**File:** `admin.html:8402-8434` — `sendScorePush` (admin path, also fires playoffs category if playoff game)

```js
window.sendScorePush = function(g, awayScore, homeScore) {
  if (!g || !g.away || !g.home) return;
  const awayName = getTeamName(g.away);
  const homeName = getTeamName(g.home);
  const title = `Final: ${awayName} ${awayScore}, ${homeName} ${homeScore}`;
  const parts = [];
  if (g.wk) parts.push(`Week ${g.wk}`);
  if (g.date) parts.push(g.date);
  const sendOne = (category, url) => fetch('/api/send-notification', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': PUSH_ADMIN_SECRET },
    body: JSON.stringify({
      title,
      body: parts.join(' · ') || 'Game final',
      category,
      teams: [g.away, g.home],
      url,
      excludeToken: localStorage.getItem('dvsl-notif-token') || undefined,
    }),
  }).catch(e => console.warn(`${category} push failed:`, e));
  // Deep-link to the box score for this specific game.
  sendOne('scores', g.id ? `/#game/${encodeURIComponent(g.id)}` : '/#scores');
  // Also fire a playoff-bracket push if this is a playoff-round game.
  const wkStr = String(g.wk || '').toUpperCase();
  const isPlayoff = g.playoff === true || wkStr.startsWith('PL') || wkStr.includes('PLAYOFF') || wkStr.includes('CHAMP') || wkStr.includes('SEMI') || wkStr.includes('QUARTER');
  if (isPlayoff) {
    sendOne('playoffs', '/playoffs.html');
  }
};
```

**Guard:** only call when `done` is transitioning to true — not on draft saves or score edits to already-final games.

### 5.3 — Score conflict (`admin` + `adminOnly:true`)

**File:** `captain.html:1302-1319` — `sendScoreConflictAlert`

```js
function sendScoreConflictAlert(g, awayFinal, homeFinal, otherAway, otherHome) {
  try {
    const awayName = ALL_TEAMS.find(t => t.id === g.away)?.name || g.away;
    const homeName = ALL_TEAMS.find(t => t.id === g.home)?.name || g.home;
    return fetch('/api/send-notification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': CAPTAIN_PUSH_SECRET },
      body: JSON.stringify({
        title: `🔔 Score conflict: ${awayName} @ ${homeName}`,
        body: `Captains disagree — one says ${awayFinal}-${homeFinal}, other says ${otherAway}-${otherHome}. Review on admin.`,
        category: 'admin',
        adminOnly: true,
        url: '/admin.html',
        excludeToken: localStorage.getItem('dvsl-notif-token') || undefined,
      }),
    }).catch(e => console.warn('Conflict alert failed:', e));
  } catch(e) { console.warn('Conflict alert skipped:', e); }
}
```

**File:** `admin.html:8439-8452` — `sendAdminAlert` (generic admin alert, used by score discrepancies AND new signups)

```js
window.sendAdminAlert = function({ title, body, url }) {
  return fetch('/api/send-notification', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': PUSH_ADMIN_SECRET },
    body: JSON.stringify({
      title: `🔔 ${title}`,
      body,
      category: 'admin',
      adminOnly: true,
      url: url || '/admin.html',
      excludeToken: localStorage.getItem('dvsl-notif-token') || undefined,
    }),
  }).catch(e => console.warn('Admin alert failed:', e));
};
```

### 5.4 — Captain rains out (`rainouts`)

**File:** `captain.html:2775-2787`

```js
fetch('/api/send-notification', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': CAPTAIN_PUSH_SECRET },
  body: JSON.stringify({
    title: `🌧 PPD: ${awayName} @ ${homeName}`,
    body: `Week ${g.wk||'?'} · ${g.date||''} ${g.time||''} @ ${g.field||''} is postponed.` +
          (rescheduledTo ? ` Rescheduled to ${rescheduledTo}.` : ' Reschedule TBD.'),
    category: 'rainouts',
    teams: [g.away, g.home].filter(Boolean),
    url: '/schedule.html',
    excludeToken: localStorage.getItem('dvsl-notif-token') || undefined,
  }),
}).catch(e => console.warn('PPD push failed:', e));
```

**File:** `admin.html:6110-6122` — same payload from admin path (used by `togglePpd`)

```js
fetch('/api/send-notification', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': PUSH_ADMIN_SECRET },
  body: JSON.stringify({
    title: `🌧 PPD: ${getTeamName(g.away)} @ ${getTeamName(g.home)}`,
    body: `Week ${g.wk||'?'} · ${g.date||''} ${g.time||''} @ ${g.field||''} is postponed.` +
          (rescheduledTo ? ` Rescheduled to ${rescheduledTo}.` : ' Reschedule TBD.'),
    category: 'rainouts',
    teams: [g.away, g.home].filter(Boolean),
    url: '/schedule.html',
    excludeToken: localStorage.getItem('dvsl-notif-token') || undefined,
  }),
}).catch(e => console.warn('PPD push failed:', e));
```

**File:** `admin.html:6207-6218` — bulk rainout-the-day variant (loops one push per game)

Same payload shape as above; loops with no rescheduledTo.

### 5.5 — Schedule change (`schedule`)

**File:** `captain.html:3068-3081` (captain edits a game)

```js
if (g && summary && summary !== 'no visible field changes') {
  fetch('/api/send-notification', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': 'dvsl-push-2026-rkj3849f' },
    body: JSON.stringify({
      title: `Schedule update: ${teamsLabel}`,
      body: `${after.date} ${after.time} @ ${after.field} — ${summary}`,
      category: 'schedule',
      teams: [g.away, g.home].filter(Boolean),
      url: '/schedule.html',
      excludeToken: localStorage.getItem('dvsl-notif-token') || undefined,
    }),
  }).catch(e => console.warn('Schedule push failed:', e));
}
```

**Guard:** only fires if `summary` shows a real schedule-facing change (not internal field tweaks).

**File:** `admin.html:8385-8398` — `sendSchedulePush` helper

```js
window.sendSchedulePush = function({ title, body, teams }) {
  if (!Array.isArray(teams) || !teams.length) return;
  return fetch('/api/send-notification', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': PUSH_ADMIN_SECRET },
    body: JSON.stringify({
      title, body,
      category: 'schedule',
      teams,
      url: '/schedule.html',
      excludeToken: localStorage.getItem('dvsl-notif-token') || undefined,
    }),
  }).catch(e => console.warn('Schedule push failed:', e));
};
```

### 5.6 — Team chat message (`team_chat`)

**File:** `captain.html:5817-5829` (canonical, shown above in section 2)

Key fields: `category: 'team_chat'`, `team:` (singular), `sourceId: msgRef.id` for delete-cascade, `url: /team-chat.html?team=...`.

**File:** `profile.html:4832-4843` (legacy / older player-side captain implementation)

```js
fetch('/api/send-notification', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': PUSH_SECRET },
  body: JSON.stringify({
    title: (MY_TEAM.short || MY_TEAM.name) + ' · Captain',
    body: text.length > 100 ? text.slice(0,100) + '…' : text,
    category: 'team_chat',
    teams: [MY_TEAM.id],
    url: '/profile.html#chat',
    excludeToken: localStorage.getItem('dvsl-notif-token') || undefined,
  }),
}).catch(() => {});
```

Older signature uses `teams:[id]` (array) and lacks `sourceId`. **Port the captain.html version**.

**File:** `profile.html:4890-4900` — captain availability reminder (also uses team_chat)

```js
const resp = await fetch('/api/send-notification', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': PUSH_SECRET },
  body: JSON.stringify({
    title, body,
    category: 'team_chat',
    teams: [MY_TEAM.id],
    // Route straight to the availability tab since that's the CTA.
    url: '/profile.html#attendance',
    excludeToken: localStorage.getItem('dvsl-notif-token') || undefined,
  }),
});
```

### 5.7 — Captains chat message (`captains_chat`)

**File:** `captain.html:5882-5892` (canonical, shown above in section 3)

Key fields: `category: 'captains_chat'`, NO team filter, `sourceId: msgRef.id`.

**File:** `profile.html:4956-4969` — legacy player-side path

```js
fetch('/api/send-notification', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': PUSH_SECRET },
  body: JSON.stringify({
    title: 'Captains · ' + (MY_TEAM.short || MY_TEAM.name),
    body: text.length > 100 ? text.slice(0,100) + '…' : text,
    // Must match the category every other path uses (admin.html,
    // captain.html, notifications.html, inbox.html, profile.html init).
    // Was 'captain_chat' (singular) — which matched zero subscribers,
    // so captain-chat pushes from profile.html were silently dropped.
    category: 'captains_chat',
    url: '/profile.html#captains-chat',
    excludeToken: localStorage.getItem('dvsl-notif-token') || undefined,
  }),
}).catch(() => {});
```

**KEY INLINE COMMENT — historical bug:** "Was `captain_chat` (singular) — which matched zero subscribers." Watch for this in your port. Use `captains_chat` (plural) everywhere.

### 5.8 — Photo posted (`photos`)

**File:** `profile.html:2845-2858` — `_playerSendPhotoPush`

```js
function _playerSendPhotoPush({ title, body, teamId }) {
  if (!teamId) return;
  return fetch('/api/send-notification', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': PUSH_SECRET },
    body: JSON.stringify({
      title, body,
      category: 'photos',
      team: teamId,
      url: '/profile.html#photos',
      excludeToken: localStorage.getItem('dvsl-notif-token') || undefined,
    }),
  }).catch(e => console.warn('Photo push failed:', e));
}
```

`team: teamId` (singular). No teams[]. No sourceId currently.

### 5.9 — Admin announcement (`announcements` — generic admin form)

**File:** `admin.html:8676-8687` — `sendPushNotification` (full form shown above in section 4)

The category is whatever the admin picks from the dropdown. Default is `announcements`. Optional `imageDataUrl` for photo-attached pushes. `adminOnly: true` only when category === 'admin'.

### 5.10 — Live scoring updates (`live`)

**File:** `index.html:5125-5133` — actually this is the new-signup admin notification, not live scoring. Live scoring fires from `scorer.html` — let me note this discrepancy.

```js
// New signup notification (admin alert from public registration page)
await fetch('/api/send-notification', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': window.LEAGUE_CONFIG.push.adminSecret },
  body: JSON.stringify({
    title: `🔔 New signup: ${name}`,
    body: `${teamName} · #${numVal || '?'} ${pos || ''} · ${email || 'no email'}`.trim(),
    category: 'admin', adminOnly: true, url: '/admin.html',
  }),
});
```

**Live scoring pushes:** the `live` category exists in the prefs UI but I didn't find a wired-up trigger in the current source. Possibly TODO or removed. Search `scorer.html` for `category: 'live'` if you want the canonical impl. For LE port: include `live` in the categories list (UI consistency) but mark it as future-wired. Don't ship a fake trigger.

### 5.11 — Pregame ping (`pregame`)

**File:** `api/pregame-reminder.js` — Vercel cron, runs every 15 min

```js
// Vercel Serverless Function — /api/pregame-reminder.js
// Scheduled cron (see vercel.json): runs every 15 minutes and pushes a
// one-hour-heads-up notification to subscribers of both teams for each
// game starting in the next ~60 minutes. Uses a `pregame_reminder_sent`
// flag on the game doc to ensure exactly-once delivery per game.

const WINDOW_START = now + 45 * 60 * 1000;   // 45 min from now
const WINDOW_END   = now + 75 * 60 * 1000;   // 75 min from now
// 30-minute window centered on 60 min out. Cron runs every 15 min so any
// scheduled game will fall inside at least one window before it starts.

for (const g of games) {
  if (g.pregame_reminder_sent) continue;
  if (g.done || g.rained_out) continue;
  const startMs = gameStartMs(g);
  if (!startMs) continue;
  if (startMs < WINDOW_START || startMs > WINDOW_END) continue;

  const title = `⚾ Game in 1 hour: ${shortName(g.away)} @ ${shortName(g.home)}`;
  const parts = [];
  if (g.time) parts.push(g.time);
  if (g.field) parts.push(g.field);
  const body = parts.join(' · ') || 'Game starts soon';

  try {
    const r = await fetch(process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}/api/send-notification`
      : 'http://localhost:3000/api/send-notification', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(ADMIN_SECRET ? { 'X-Admin-Secret': ADMIN_SECRET } : {}),
      },
      body: JSON.stringify({
        title, body,
        category: 'pregame',
        teams: [g.away, g.home].filter(Boolean),
        url: '/schedule.html',
      }),
    });
    // Mark as sent so we don't re-ping. Fire-and-forget; if this fails
    // we'll send a duplicate on the next cron, which is a minor cost.
    await markSent({ projectId: PROJECT_ID, accessToken, gameId: g.id });
  } catch(e) { /* ... */ }
}
```

**Auth:** cron requires `Authorization: Bearer ${CRON_SECRET}` header (Vercel cron sends this automatically). Falls back to `X-Admin-Secret` for manual triggers. Fails closed if neither is set.

**Idempotency:** `g.pregame_reminder_sent` flag — set to `true` on the game doc after successful push. Once-per-game guarantee.

**Game time parsing:** prefers `date_iso` + `time_24` (machine format), falls back to parsing `date` + `time` (display format).

For LE multi-tenant: scope cron to iterate per-tenant. Either run one cron per tenant or do `for each league in /leagues, run the same logic`.

---

## 6. REAL-TIME CHAT CAVEATS — Inline comments worth quoting

### Why `onSnapshot` not polling
No explicit comment, but the pattern is uniform across all chat surfaces. Justified by: low message volume (a few per day per chat), free-tier read budget is plenty, no need to handle reconnection logic ourselves.

### Why `asc + limit(100)` for team chat (and `asc + limitToLast(200)` for captains chat)

From `profile.html:4920`:
> "v97: asc + limitToLast so we use the existing asc index (no new index required)."

From `captain.html:5733`:
> `orderBy('timestamp', 'asc'), limit(100)` — top 100 oldest, in chrono order. Render order matches source order.

**Trade-off:** with 100-msg limit, very active chats lose old messages from the listener. Not a problem in practice (DVSL captains chat has ~500 lifetime messages, team chat much less).

### Message ordering / dedup

No explicit dedup logic — relies on `serverTimestamp()` being monotonic. The `id` in the rendered `CHAT_CACHE` map is the Firestore doc id, which is unique. No client-generated ids.

### Scroll-to-bottom

After every render: `el.scrollTop = el.scrollHeight;` (captain.html:5676).

No "smart scroll" (don't auto-scroll if user has scrolled up to read history). DVSL just always scrolls to bottom.

### Badge / unread count

Uses `localStorage` per user-email key:
```js
localStorage.setItem('lastRead_teamchat_' + currentUser.email, Date.now());
localStorage.setItem('lastRead_captchat_' + currentUser.email, Date.now());
```

Unread = messages newer than `lastRead` AND not authored by `currentUser.email`.

Badge clears on tab activation. No server-side unread tracking.

### Edit support

**Not implemented.** No edit button anywhere. Messages are immutable once sent.

### Delete support

Yes, two patterns:
- **Self-delete:** any user can delete their own messages (mine === true)
- **Captain-moderate:** in team chat, captains can delete anyone's message (`canModerateOthers` flag at captain.html:5614)
- **Captains chat:** anyone can only delete their own — even the commissioner can't moderate others' captain-chat messages

Delete cascade to push history via `/api/delete-by-source` (described above).

### Typing indicators

**Not implemented.** No DVSL chat has typing indicators. Comment-free omission.

### Email fallback

Both chats also fire EmailJS sends if `EMAILJS_ENABLED`. For LE: skip email entirely or wire to a per-tenant email provider.

### Reset / nuke

Captain-only. Two-confirm flow. 400-doc batches to stay under Firestore's 500-op writeBatch limit.

```js
let remaining = snap.docs.slice();
while (remaining.length) {
  const chunk = remaining.splice(0, 400);
  const batch = writeBatch(db);
  chunk.forEach(d => batch.delete(d.ref));
  await batch.commit();
}
```

---

## 7. Multi-Tenant Critical Requirements (LE adds)

For every Firestore collection in this spec:

- **`/availability/{docId}`** — add `leagueId` field. Doc ID becomes `${leagueId}_${team_id}_${game_id}_${player_id}`. Every query gets `where('leagueId','==', leagueId)`.
- **`/team_messages/{docId}`** — add `leagueId`. Auto-generated doc IDs are fine. Listener query: `where('leagueId','==', leagueId), where('team_id','==', myTeamId)`.
- **`/captain_chat/{docId}`** — add `leagueId`. Listener query: `where('leagueId','==', leagueId)` (no team filter — league-wide within tenant).
- **`/games/{docId}`** — already discussed in main schema. Pregame cron must scope iteration by leagueId.

For every send-notification call:
- Server stamps `leagueId` from caller's verified ID token claim
- Caller never sets it
- All 11 trigger payloads above must thread `leagueId` through to `/api/send-notification` (server reads from claim, not body)

For the rules test suite, add:
- Cross-tenant team_messages read blocked
- Cross-tenant availability read blocked
- Captain in SFBL can't delete a KCSL team_messages doc
- Captain in SFBL can read their own captain_chat but not KCSL's

---

## 8. Verification Checklist

Before declaring attendance + chat + triggers done:

- [ ] `/availability` doc shape matches: `{game_id, player_id, player_name, team_id, status, updated_at, leagueId}`
- [ ] Doc ID for availability: `${leagueId}_${team_id}_${game_id}_${player_id}`
- [ ] Toggle-off behavior: tap selected status → delete doc, clear from local state
- [ ] Three views (my / team / edit) working
- [ ] `captainRemindWaiting` computes excludePlayerIds from responded set
- [ ] Push uses `category: 'team_chat'` (gated server-side on authed_teams)
- [ ] Team chat doc shape includes: text, author_email, author_name, is_captain, team_id, team_name, team_color, timestamp, leagueId
- [ ] Captains chat doc shape includes: text, author_email, team_id, team_name, team_short, team_color, timestamp, leagueId
- [ ] Real-time listener: `onSnapshot` + `orderBy('timestamp','asc')` + `limit(100)` for team, `limitToLast(200)` for captains
- [ ] Render path: captain.html:5604 logic — handles old + new author_name shapes, sender label varies team-chat vs captains-chat
- [ ] Badge logic uses `localStorage.getItem('lastRead_<chat>_<email>')` — cleared on tab activation
- [ ] Self-delete + captain-moderate-others (team chat only)
- [ ] Delete cascades to `pending_nav` via `/api/delete-by-source` POST with `sourceId`
- [ ] Reset-chat batches at 400 docs/batch
- [ ] `sendTeamMsg` push uses `team:` (singular) and `sourceId: msgRef.id`
- [ ] `sendCaptMsg` push uses NO team filter and `sourceId: msgRef.id`
- [ ] All 11 trigger payloads ported with exact title/body templates and category names
- [ ] Pregame cron runs every 15 min, 30-min window centered on 60 min before game time, idempotent via `pregame_reminder_sent` flag
- [ ] Pregame cron iterates per-tenant in LE
- [ ] `captain_chat` is plural, not `captain_chat` singular (the historical bug)
- [ ] `/api/delete-by-source` endpoint exists for delete-cascade
- [ ] Cross-tenant rules tests cover availability + team_messages + captain_chat
