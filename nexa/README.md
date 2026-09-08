# NEXA — Extended Build

A real, runnable implementation covering most of the NEXA spec end to end against a real
SQLite database — no mocked success states. Every button calls a real API endpoint or a
real Socket.io event and shows the real result.

## What's actually implemented

**Auth & Security**
- Signup/login/logout, bcrypt password hashing, JWT access + rotating refresh tokens
- Real TOTP-based 2FA (setup → scan/enter secret → enable → required on next login), tested
  with an actual generated authenticator code, not a stub
- Account deactivate / reactivate-on-login, and delete-with-grace-period / cancel
- Rate limiting on all API routes (tighter on auth)

**Social graph**
- Follow/unfollow, block, mute (content-silencing), restrict, close friends
- Profile pages with a relationship action menu (mute/restrict/block/report)

**Content**
- Posts, comments, likes (duplicate-safe), captions parsed for real @mentions (→
  notifications) and #hashtags (→ searchable)
- Saved posts and saved reels
- Stories: 24h-expiring text/image, audience control (everyone/followers/close friends),
  per-viewer tracking, author-only viewer list
- Reels: video-URL-based (no upload/transcode pipeline — see note below), likes, comments,
  hashtags/mentions
- Notes: one active 24h note per user, audience control, likes, replies that go through the
  same message-request logic as normal DMs
- Following feed + a simple engagement-ranked "For You" feed, both cursor-paginated and
  block/mute-aware

**Messaging**
- The mandatory message-request gate: messaging someone with no accepted conversation
  creates a request (Accept/Delete/Block/Report), not a message
- One-to-one and group conversations, chat themes
- Message reactions, edit, delete (soft), pin/unpin, forward
- Realtime delivery over Socket.io

**Calls**
- Real WebRTC signaling over Socket.io: invite → ring (with a 45s auto-timeout to
  "missed") → accept/decline → SDP offer/answer + ICE candidate relay → end → call history
- Voice and video, with mute/camera toggle in the call UI
- **Caveat:** STUN-only (`stun:stun.l.google.com:19302`), no TURN server. This reliably
  works on the same network or localhost but may fail to connect across restrictive NATs
  in a real multi-network deployment — that would need a TURN server, which requires
  hosting/credentials this environment can't provide.

**Games**
- Real, server-authoritative Tic-Tac-Toe and Connect Four (pluggable engine architecture
  in `gameEngine.js`) — every move is validated server-side, turn order enforced, win/draw
  detection server-side, realtime state sync over Socket.io
- Room creation, invite codes, ready-up flow, forfeit-on-disconnect

**Search & Moderation**
- Search for users and hashtags; tap a hashtag to see everything tagged with it
- Report content/users (backend + UI); reports are stored for moderation review

**Codex (AI assistant panel)**
- A real, narrow, allowlisted action registry — every action calls a real endpoint:
  message, follow/unfollow, navigate, start a call, and the **Universal App Launcher**
- **Universal App Launcher**: resolves app names/aliases (e.g. "spotify", "ff", "maps") to
  either a real web URL it opens in a new tab (Spotify, YouTube, WhatsApp Web, Google Maps,
  Discord, Telegram, Instagram, Amazon Music, lichess.org for Chess), or an honest refusal
  for apps with no web equivalent (Free Fire, Minecraft, Camera, Gallery) — **this is a web
  app and cannot launch native OS apps**, and Codex says so rather than faking it.

## What's still not implemented, and why

- **Google OAuth / SMS OTP / email delivery** — the code paths for a "sign in with Google"
  button or SMS-based OTP would need real registered API credentials with Google/a
  SMS/email provider that only you can obtain; there's nothing to build here without them.
- **Native OS app launching** — structurally impossible from a web app; see the Universal
  App Launcher note above for what's honestly possible instead.
- **A real media upload/CDN/transcode pipeline** — posts/reels use direct URLs; actual
  file upload, compression, thumbnailing, and adaptive bitrate streaming need real object
  storage and a media processing service.
- **The other 6 games** (Chess, Carrom, Bike Race, Checkers, Ludo, Snake-style) — the
  pluggable engine architecture in `gameEngine.js` makes adding one mostly a matter of
  writing `init`/`applyMove` functions like the two that exist.
- **Group video calls** — current call signaling is 1:1 only.
- **Production infra** — no real CDN, no observability/logging pipeline, no CI/CD.

## Running it locally

Requires Node.js 18+ (Node 20/22 LTS recommended — very new Node versions may lack
prebuilt binaries for `better-sqlite3` and require a C++ build toolchain).

```bash
# 1. Backend
cd backend
npm install
npm run seed     # creates demo users: rahul, priya, arjun (password: password123)
                  # also seeds the Tic-Tac-Toe/Connect Four catalog and the app registry
npm start        # listens on http://localhost:4000

# 2. Frontend (in a second terminal)
cd frontend
npm install
npm run dev      # opens on http://localhost:5173, proxies /api and /socket.io to :4000
```

Then open http://localhost:5173 and log in as `rahul`, `priya`, or `arjun` (password
`password123`), or sign up a new account.

Things worth trying:
- **Message request flow**: message a user you've never spoken to — it becomes a request
  until they accept it (open a second browser/incognito window as another demo user).
- **Calls**: once two users have a conversation, use the 📞/🎥 buttons in the chat header —
  works great in two tabs on the same machine (grant mic/camera permission in each).
- **Games**: create a Tic-Tac-Toe or Connect Four room, join with the invite code from
  another account, and play — every move is validated server-side.
- **Codex**: try "follow priya", "call rahul", or "open spotify" — the last one actually
  opens open.spotify.com in a new tab.
- **2FA**: enable it from Account Settings, scan the secret into any authenticator app,
  and confirm it's required on your next login.

## Notes on the database

SQLite file lives at `backend/nexa.db`. Delete it and re-run `npm run seed` to reset.
Schema is in `backend/src/schema.sql` — foreign keys, uniqueness constraints, and indexes
for the access patterns actually used (feed queries, conversation lookups, follower lists,
game room lookups, hashtag search).
