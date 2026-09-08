import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { isBlocked } from './users.js';
import { sendDirectMessage } from './messages.js';
import { processMentionsAndHashtags } from '../content.js';

const router = Router();
const NOTE_TTL_HOURS = 24;
const MOODS = ['none', 'happy', 'chilling', 'busy', 'celebrating', 'thinking'];

function isCloseFriend(ownerId, viewerId) {
  return !!db.prepare('SELECT 1 FROM close_friends WHERE owner_id = ? AND friend_id = ?').get(ownerId, viewerId);
}

function noteDTO(row) {
  const likeCount = db.prepare('SELECT COUNT(*) c FROM note_likes WHERE note_id = ?').get(row.id).c;
  const author = db.prepare('SELECT id, username, display_name, avatar_color FROM users WHERE id = ?').get(row.user_id);
  return {
    id: row.id, text: row.text, emoji: row.emoji, mood: row.mood, audience: row.audience,
    createdAt: row.created_at, expiresAt: row.expires_at, likeCount,
    author: { id: author.id, username: author.username, displayName: author.display_name, avatarColor: author.avatar_color },
  };
}

router.get('/moods', (_req, res) => res.json({ moods: MOODS }));

router.post('/', requireAuth, (req, res) => {
  const { text, emoji, mood, audience } = req.body || {};
  const cleanText = typeof text === 'string' ? text.trim().slice(0, 60) : '';
  if (!cleanText && !emoji) {
    return res.status(400).json({ error: { code: 'EMPTY_NOTE', message: 'Add some text or an emoji for your note.' } });
  }
  const validAudience = ['everyone', 'followers', 'close_friends', 'no_one'].includes(audience) ? audience : 'followers';
  const id = uuid();
  const expiresAt = new Date(Date.now() + NOTE_TTL_HOURS * 3600 * 1000).toISOString();

  db.prepare(`
    INSERT INTO notes (id, user_id, text, emoji, mood, audience, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      id = excluded.id, text = excluded.text, emoji = excluded.emoji, mood = excluded.mood,
      audience = excluded.audience, created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), expires_at = excluded.expires_at
  `).run(id, req.userId, cleanText, emoji || null, MOODS.includes(mood) ? mood : null, validAudience, expiresAt);

  const row = db.prepare('SELECT * FROM notes WHERE user_id = ?').get(req.userId);
  processMentionsAndHashtags({ text: cleanText, sourceType: 'note', sourceId: row.id, actorId: req.userId, io: req.app.get('io') });
  res.status(201).json({ note: noteDTO(row) });
});

router.delete('/mine', requireAuth, (req, res) => {
  db.prepare('DELETE FROM notes WHERE user_id = ?').run(req.userId);
  res.json({ ok: true });
});

// Notes from people I follow (plus my own), respecting audience + block + expiry.
router.get('/feed', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT n.* FROM notes n
    WHERE n.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND (
        n.user_id = ?
        OR n.user_id IN (SELECT followed_id FROM follows WHERE follower_id = ?)
      )
      AND n.user_id NOT IN (
        SELECT blocked_id FROM blocks WHERE blocker_id = ?
        UNION SELECT blocker_id FROM blocks WHERE blocked_id = ?
      )
    ORDER BY n.created_at DESC
  `).all(req.userId, req.userId, req.userId, req.userId);

  const visible = rows.filter(r => {
    if (r.user_id === req.userId) return true;
    if (r.audience === 'no_one') return false;
    if (r.audience === 'close_friends') return isCloseFriend(r.user_id, req.userId);
    return true; // 'everyone' or 'followers' — viewer already passed the follow-graph filter above
  });

  res.json({ notes: visible.map(noteDTO) });
});

router.post('/:id/like', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Note not found.' } });
  db.prepare('INSERT OR IGNORE INTO note_likes (note_id, user_id) VALUES (?, ?)').run(row.id, req.userId);
  res.json({ note: noteDTO(row) });
});

router.delete('/:id/like', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Note not found.' } });
  db.prepare('DELETE FROM note_likes WHERE note_id = ? AND user_id = ?').run(row.id, req.userId);
  res.json({ note: noteDTO(row) });
});

// Replying to a note sends a real direct message to the note's author,
// going through the exact same message-request gate as any other message.
router.post('/:id/reply', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Note not found.' } });
  const author = db.prepare('SELECT username FROM users WHERE id = ?').get(row.user_id);
  if (isBlocked(req.userId, row.user_id)) {
    return res.status(403).json({ error: { code: 'BLOCKED', message: "You can't reply to this note." } });
  }
  const { text } = req.body || {};
  const result = sendDirectMessage({ fromUserId: req.userId, toUsername: author.username, text, io: req.app.get('io') });
  if (result.httpStatus < 400) {
    db.prepare("INSERT INTO notifications (id, recipient_id, actor_id, type, target_id) VALUES (?, ?, ?, 'note_reply', ?)")
      .run(uuid(), row.user_id, req.userId, row.id);
    req.app.get('io')?.to(`user:${row.user_id}`).emit('notification:new', { type: 'note_reply' });
  }
  res.status(result.httpStatus).json(result.body);
});

export default router;
