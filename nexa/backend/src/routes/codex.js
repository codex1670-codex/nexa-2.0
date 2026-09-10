import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveIntent, isConfigured } from '../llm.js';
import { sendDirectMessage } from './messages.js';
import { isBlocked } from './users.js';
import { createRoom, joinRoomByCode, roomDTO } from './games.js';

const router = Router();

// The complete allowlisted action registry Codex may choose from. Nothing outside this
// list can ever be executed, regardless of what the model outputs — the switch below only
// recognizes these exact names, and every branch re-validates authorization server-side.
const TOOLS = [
  { name: 'send_message', description: 'Send a direct message to a NEXA user by username.',
    input_schema: { type: 'object', properties: { username: { type: 'string' }, text: { type: 'string' } }, required: ['username', 'text'] } },
  { name: 'follow_user', description: 'Follow a NEXA user by username.',
    input_schema: { type: 'object', properties: { username: { type: 'string' } }, required: ['username'] } },
  { name: 'unfollow_user', description: 'Unfollow a NEXA user by username.',
    input_schema: { type: 'object', properties: { username: { type: 'string' } }, required: ['username'] } },
  { name: 'navigate', description: 'Move the user to a different screen inside NEXA.',
    input_schema: { type: 'object', properties: { screen: { type: 'string', enum: ['feed', 'messages', 'profile', 'notifications', 'reels', 'games', 'search'] }, username: { type: 'string', description: 'only for profile/messages screens' } }, required: ['screen'] } },
  { name: 'start_call', description: 'Start a voice or video call with a user you already have a conversation with.',
    input_schema: { type: 'object', properties: { username: { type: 'string' }, video: { type: 'boolean' } }, required: ['username'] } },
  { name: 'open_app', description: 'Open an external app/website by name (e.g. Spotify, YouTube, Maps, WhatsApp), optionally with a search term.',
    input_schema: { type: 'object', properties: { appName: { type: 'string' }, searchFor: { type: 'string' } }, required: ['appName'] } },
  { name: 'create_note', description: "Post to the user's Note (shown above Messages), which expires in 24h.",
    input_schema: { type: 'object', properties: { text: { type: 'string' }, emoji: { type: 'string' } }, required: ['text'] } },
  { name: 'create_story', description: 'Post a text Story that expires in 24h.',
    input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'search', description: 'Search NEXA for a user or hashtag.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'invite_to_game', description: 'Create a new game room and send the invite to a friend by username.',
    input_schema: { type: 'object', properties: { gameId: { type: 'string', enum: ['tic-tac-toe', 'connect-four', 'checkers'] }, username: { type: 'string' } }, required: ['gameId', 'username'] } },
  { name: 'join_game', description: 'Join an existing game room using an invite code.',
    input_schema: { type: 'object', properties: { inviteCode: { type: 'string' } }, required: ['inviteCode'] } },
];

function audit({ userId, inputText, actionName, actionInput, status, resultSummary }) {
  db.prepare(`
    INSERT INTO codex_actions (id, user_id, input_text, action_name, action_input, status, result_summary)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(uuid(), userId, inputText, actionName || null, actionInput ? JSON.stringify(actionInput) : null, status, resultSummary || null);
}

router.get('/status', requireAuth, (_req, res) => {
  res.json({ configured: isConfigured() });
});

router.get('/history', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM codex_actions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(req.userId);
  res.json({ actions: rows.map(r => ({ id: r.id, inputText: r.input_text, actionName: r.action_name, status: r.status, resultSummary: r.result_summary, createdAt: r.created_at })) });
});

router.post('/act', requireAuth, async (req, res) => {
  const { text, context } = req.body || {};
  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: { code: 'EMPTY_INPUT', message: 'Say something for Codex to act on.' } });
  }
  const io = req.app.get('io');

  const intent = await resolveIntent({ text: text.trim(), tools: TOOLS, context });
  if (!intent.ok) {
    audit({ userId: req.userId, inputText: text, status: 'ai_unavailable', resultSummary: intent.reason });
    return res.status(503).json({
      handled: false,
      error: { code: 'AI_NOT_CONFIGURED', message: intent.reason === 'not_configured'
        ? 'Codex\'s language understanding needs an ANTHROPIC_API_KEY set on the server.'
        : `Codex's AI service failed: ${intent.message}` },
    });
  }
  if (!intent.action || intent.action.name === 'no_match') {
    audit({ userId: req.userId, inputText: text, status: 'no_match' });
    return res.json({ handled: false, message: "I didn't understand that. Try rephrasing, or type \"help\"." });
  }

  const { name, input } = intent.action;
  try {
    let result;
    switch (name) {
      case 'send_message': {
        if (input.username === req.userId) throw new Error("You can't message yourself.");
        const r = sendDirectMessage({ fromUserId: req.userId, toUsername: input.username, text: input.text, io });
        if (r.httpStatus >= 400) throw new Error(r.body.error.message);
        result = { message: r.body.status === 'sent' ? `Sent to @${input.username}.` : r.body.message, navigate: { screen: 'messages', username: input.username } };
        break;
      }
      case 'follow_user':
      case 'unfollow_user': {
        const target = db.prepare('SELECT * FROM users WHERE username = ?').get(input.username);
        if (!target) throw new Error('User not found.');
        if (name === 'follow_user') {
          if (isBlocked(req.userId, target.id)) throw new Error('Unable to follow this user.');
          db.prepare('INSERT OR IGNORE INTO follows (follower_id, followed_id) VALUES (?, ?)').run(req.userId, target.id);
          db.prepare("INSERT INTO notifications (id, recipient_id, actor_id, type) VALUES (?, ?, ?, 'follow')").run(uuid(), target.id, req.userId);
        } else {
          db.prepare('DELETE FROM follows WHERE follower_id = ? AND followed_id = ?').run(req.userId, target.id);
        }
        result = { message: `${name === 'follow_user' ? 'Followed' : 'Unfollowed'} @${input.username}.`, navigate: { screen: 'profile', username: input.username } };
        break;
      }
      case 'navigate': {
        result = { message: `Opening ${input.screen}.`, navigate: { screen: input.screen, username: input.username } };
        break;
      }
      case 'start_call': {
        const target = db.prepare('SELECT * FROM users WHERE username = ?').get(input.username);
        if (!target) throw new Error('User not found.');
        if (isBlocked(req.userId, target.id)) throw new Error("You can't call this user.");
        const convo = db.prepare(`
          SELECT c.id FROM conversations c
          JOIN conversation_participants a ON a.conversation_id = c.id AND a.user_id = ?
          JOIN conversation_participants b ON b.conversation_id = c.id AND b.user_id = ?
          WHERE c.type = 'direct' LIMIT 1
        `).get(req.userId, target.id);
        if (!convo) throw new Error(`You don't have a conversation with @${input.username} yet, so I can't start a call. Message them first.`);
        result = { message: `Starting a ${input.video ? 'video' : 'voice'} call with @${input.username}…`, navigate: { screen: 'messages', username: input.username }, startCall: { conversationId: convo.id, type: input.video ? 'video' : 'voice' } };
        break;
      }
      case 'open_app': {
        const normalized = input.appName.toLowerCase();
        let app = db.prepare(`
          SELECT ar.* FROM app_registry ar LEFT JOIN app_aliases aa ON aa.app_id = ar.id
          WHERE LOWER(ar.display_name) = ? OR aa.alias = ? LIMIT 1
        `).get(normalized, normalized);
        if (!app) app = db.prepare(`
          SELECT ar.* FROM app_registry ar LEFT JOIN app_aliases aa ON aa.app_id = ar.id
          WHERE LOWER(ar.display_name) LIKE ? OR aa.alias LIKE ? LIMIT 1
        `).get(`%${normalized}%`, `%${normalized}%`);
        if (!app) throw new Error(`I don't have "${input.appName}" in the app catalog for this build.`);
        if (app.native_only) throw new Error(`${app.display_name} doesn't have a web version I can open from a browser — this build can't launch native OS apps.`);
        const url = (input.searchFor && app.search_url_template) ? app.search_url_template.replace('{q}', encodeURIComponent(input.searchFor)) : app.launch_url_web;
        result = { message: `Opening ${app.display_name}${input.searchFor ? ` and searching "${input.searchFor}"` : ''}…`, openUrl: url };
        break;
      }
      case 'create_note': {
        const id = uuid();
        const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
        db.prepare(`
          INSERT INTO notes (id, user_id, text, emoji, audience, expires_at) VALUES (?, ?, ?, ?, 'followers', ?)
          ON CONFLICT(user_id) DO UPDATE SET id = excluded.id, text = excluded.text, emoji = excluded.emoji, created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), expires_at = excluded.expires_at
        `).run(id, req.userId, input.text.slice(0, 60), input.emoji || null, expiresAt);
        result = { message: 'Posted your note.', navigate: { screen: 'messages' } };
        break;
      }
      case 'create_story': {
        const id = uuid();
        const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
        db.prepare(`INSERT INTO stories (id, user_id, media_type, content, audience, expires_at) VALUES (?, ?, 'text', ?, 'everyone', ?)`)
          .run(id, req.userId, input.text.slice(0, 200), expiresAt);
        result = { message: 'Posted your story.', navigate: { screen: 'feed' } };
        break;
      }
      case 'search': {
        result = { message: `Searching for "${input.query}".`, navigate: { screen: 'search', query: input.query } };
        break;
      }
      case 'invite_to_game': {
        const created = createRoom(input.gameId, req.userId);
        if (created.error) throw new Error(created.error);
        const inviteText = `Join my ${created.game.name} game on NEXA — invite code: ${created.room.invite_code}`;
        const r = sendDirectMessage({ fromUserId: req.userId, toUsername: input.username, text: inviteText, io });
        if (r.httpStatus >= 400) throw new Error(r.body.error.message);
        result = { message: `Created a ${created.game.name} room and invited @${input.username}.`, navigate: { screen: 'games' } };
        break;
      }
      case 'join_game': {
        const joined = joinRoomByCode(input.inviteCode, req.userId);
        if (joined.error) throw new Error(joined.error);
        io?.to(`game:${joined.room.id}`).emit('game:state', roomDTO(joined.room));
        result = { message: 'Joined the game room.', navigate: { screen: 'games' } };
        break;
      }
      default:
        throw new Error('Unrecognized action.');
    }
    audit({ userId: req.userId, inputText: text, actionName: name, actionInput: input, status: 'executed', resultSummary: result.message });
    return res.json({ handled: true, ...result });
  } catch (err) {
    audit({ userId: req.userId, inputText: text, actionName: name, actionInput: input, status: 'failed', resultSummary: err.message });
    return res.json({ handled: true, message: err.message, failed: true });
  }
});

export default router;
