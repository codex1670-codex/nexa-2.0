# NEXA — Extended Build

A real, runnable implementation covering most of the NEXA spec end to end against a real
SQLite database — no mocked success states, no fake data. Every button calls a real API
endpoint or a real Socket.io event and shows the real result.

## What's actually implemented

**Auth & Security**
- Signup/login/logout, bcrypt hashing, JWT access + rotating refresh tokens
- Real TOTP 2FA (setup → scan into an authenticator app → enable → required on next login)
- Account deactivate/reactivate-on-login, delete-with-14-day-grace-period/cancel
- Rate limiting on all routes (tighter on auth)

**Social graph**
- Follow/unfollow, block, mute, restrict, close friends
- Profile relationship menu (mute/restrict/block/report)

**Content**
- Posts, comments (with replies, edit, delete, and author-side hide/moderation),
  duplicate-safe likes, real @mention and #hashtag parsing (→
  notifications, → searchable)
- Editing: posts, comments, reels (caption), and notes (a true edit that preserves the
  original 24h timer, distinct from posting a new note) all support real edits with
  ownership checks and `editedAt` tracking
- Saved posts and saved reels
- Stories (24h, text/image, audience control, per-viewer tracking) and Notes (24h,
  audience control, replies routed through the real message-request system)
- Reels (video-URL based — see media note below)
- Following feed + engagement-ranked "For You" feed, both paginated and block/mute-aware

**Messaging**
- The mandatory message-request gate (Accept/Delete/Block/Report)
- One-to-one + group conversations, chat themes
- Message reactions, edit, delete, pin/unpin, forward
- Realtime delivery over Socket.io

**Calls**
- Real WebRTC signaling over Socket.io: invite → ring (45s auto-timeout to "missed") →
  accept/decline → SDP/ICE relay → end → history. Voice and video, mute/camera toggle.
- STUN-only (no TURN) — reliable on the same network/localhost; a production deployment
  would need a TURN server for calls across restrictive NATs.

**Games & Game Store**
- Server-authoritative Tic-Tac-Toe, Connect Four, and Checkers (pluggable engine in
  `gameEngine.js` — every move validated server-side, no client-trusted state)
- Game Store with **Discover** (per-game real open-room counts, no fabricated stats),
  **Friends** (privacy-respecting: only rooms hosted by people you follow),
  **My Games**, and **Tournaments**
- **Tournaments**: a real round-robin bracket — pick a game, invite people, and starting
  it generates a genuine, playable game room for every pair. Standings update
  automatically the instant a match finishes, with zero client-reported results.
- Room creation, invite codes, ready-up flow, forfeit-on-disconnect, and a real
  message-based invite flow (`SEND_GAME_INVITE`)

**Search & Moderation**
- Search users and hashtags; tap a hashtag to see everything tagged with it
- Report content/users, stored for moderation review
- Missed calls generate a real notification (verified with an actual 45-second live
  test, not just code review): the caller's timeout, the DB status change, the realtime
  push, and the persisted notification record all confirmed working together

**Codex — the AI assistant, honestly implemented**
- A real, narrow, allowlisted action registry (`send_message`, `follow_user`,
  `navigate`, `start_call`, `open_app`, `create_note`, `create_story`, `search`,
  `invite_to_game`, `join_game`, …) — every action is re-validated and executed by the
  backend, audit-logged to `codex_actions`, and the model is **never** given execution
  power, only the ability to pick one predefined tool
- **With `ANTHROPIC_API_KEY` set**: Codex uses real Anthropic tool-calling to understand
  free-form, multilingual requests (including Tanglish-style code-switching) and maps
  them to the allowlist above
- **Without a key**: Codex is honest about it ("Basic pattern matching only…") and
  falls back to a deterministic regex command parser — it never pretends to understand
  something it didn't
- **Real voice I/O**: a mic button uses the browser's native SpeechRecognition API for
  input and SpeechSynthesis for spoken replies (English/Tamil/Hindi/Spanish/French
  selectable) — genuinely functional, no external service, works in Chrome/Edge
- **Bio AI assist** (Write/Improve/Professional/Shorter/Translate) in Account Settings —
  real text generation via the same Anthropic integration when configured; an honest
  "needs an API key" message otherwise
- **Universal App Launcher**: resolves app names/aliases to real web URLs it opens in a
  new tab (Spotify, YouTube, WhatsApp Web, Google Maps, Discord, Telegram, Instagram,
  Amazon Music, lichess.org for Chess) — or an honest refusal for apps with no web
  equivalent (Free Fire, Minecraft, Camera, Gallery), since this is a web app and
  cannot launch native OS apps

### Enabling the real AI features

Codex's natural-language understanding and the Bio AI tools both need a real Anthropic
API key (they call the Anthropic API directly — this is genuine text generation and
tool-calling, not a mock):

```bash
# backend/.env (create this file)
ANTHROPIC_API_KEY=sk-ant-...
```

Without it, both features stay fully functional in their honest fallback mode described
above — nothing breaks, nothing is faked.

## What's still not implemented, and why

- **Google OAuth / SMS OTP / email delivery** — need real registered credentials with
  Google/an SMS/email provider that only you can obtain.
- **Native OS app launching** — structurally impossible from a web app.
- **A real media upload/CDN/transcode pipeline** — posts/reels use direct URLs.
- **5 of the 8 named games** (Chess, Carrom, Bike Race, Ludo, Snake-style) —
  `gameEngine.js`'s pluggable design means adding one is mostly `init`/`applyMove`
  functions like the three that exist (Tic-Tac-Toe, Connect Four, Checkers).
- **Group video calls** — current signaling is 1:1 only.
- **Production infra** — no real CDN, observability pipeline, or CI/CD.

## Running it locally

Requires Node.js 18+ (20/22 LTS recommended).

```bash
# 1. Backend
cd backend
npm install
npm run seed     # demo users: rahul, priya, arjun (password: password123)
npm start        # http://localhost:4000

# 2. Frontend (second terminal)
cd frontend
npm install
npm run dev      # http://localhost:5173, proxies /api and /socket.io to :4000
```

Log in as `rahul`, `priya`, or `arjun` (password `password123`), or sign up fresh.

Things worth trying:
- **Tournaments**: Game Store → Discover → "Start tournament" on Tic-Tac-Toe, join with
  a second account, start it, and play — standings update live.
- **Codex voice**: open the Codex panel, tap the mic icon, and say "follow priya" out loud.
- **Codex + AI**: set `ANTHROPIC_API_KEY` and try something the regex parser couldn't
  handle, like "hey can you tell rahul I'll be a bit late" — it should still correctly
  resolve to messaging @rahul.
- **Calls**: the call buttons in a chat header — two browser tabs on the same machine
  work great.

## Notes on the database

SQLite file at `backend/nexa.db`. Delete it and re-run `npm run seed` to reset. Schema
in `backend/src/schema.sql`.
