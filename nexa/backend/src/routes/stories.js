import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { processMentionsAndHashtags } from '../content.js';

const router = Router();
const STORY_TTL_HOURS = 24;

function isCloseFriend(ownerId, viewerId) {
  return !!db.prepare('SELECT 1 FROM close_friends WHERE owner_id = ? AND friend_id = ?').get(ownerId, viewerId);
}

function storyDTO(row, viewerId) {
  const viewCount = db.prepare('SELECT COUNT(*) c FROM story_views WHERE story_id = ?').get(row.id).c;
  const viewedByMe = viewerId ? !!db.prepare('SELECT 1 FROM story_views WHERE story_id = ? AND viewer_id = ?').get(row.id, viewerId) : false;
  return {
    id: row.id, mediaType: row.media_type, content: row.content, background: row.background,
    audience: row.audience, createdAt: row.created_at, expiresAt: row.expires_at,
    viewCount, viewedByMe,
  };
}

router.post('/', requireAuth, (req, res) => {
  const { mediaType, content, background, audience } = req.body || {};
  const type = mediaType === 'image' ? 'image' : 'text';
  const cleanContent = typeof content === 'string' ? content.trim().slice(0, type === 'text' ? 200 : 2000) : '';
  if (!cleanContent) {
    return res.status(400).json({ error: { code: 'EMPTY_STORY', message: type === 'image' ? 'Provide an image URL.' : 'Write something for your story.' } });
  }
  const validAudience = ['everyone', 'followers', 'close_friends'].includes(audience) ? audience : 'everyone';
  const id = uuid();
  const expiresAt = new Date(Date.now() + STORY_TTL_HOURS * 3600 * 1000).toISOString();

  db.prepare(`
    INSERT INTO stories (id, user_id, media_type, content, background, audience, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.userId, type, cleanContent, typeof background === 'string' ? background.slice(0, 20) : '#7C5CFF', validAudience, expiresAt);

  const row = db.prepare('SELECT * FROM stories WHERE id = ?').get(id);
  if (type === 'text') processMentionsAndHashtags({ text: cleanContent, sourceType: 'story', sourceId: id, actorId: req.userId, io: req.app.get('io') });
  res.status(201).json({ story: storyDTO(row, req.userId) });
});

// Active stories from people I follow (plus mine), grouped by author, respecting audience + block.
router.get('/feed', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT s.*, u.username, u.display_name, u.avatar_color FROM stories s
    JOIN users u ON u.id = s.user_id
    WHERE s.deleted_at IS NULL
      AND s.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND (
        s.user_id = ?
        OR s.user_id IN (SELECT followed_id FROM follows WHERE follower_id = ?)
      )
      AND s.user_id NOT IN (
        SELECT blocked_id FROM blocks WHERE blocker_id = ?
        UNION SELECT blocker_id FROM blocks WHERE blocked_id = ?
      )
    ORDER BY s.created_at ASC
  `).all(req.userId, req.userId, req.userId, req.userId);

  const visible = rows.filter(r => {
    if (r.user_id === req.userId) return true;
    if (r.audience === 'close_friends') return isCloseFriend(r.user_id, req.userId);
    return true;
  });

  const byAuthor = new Map();
  for (const r of visible) {
    if (!byAuthor.has(r.user_id)) {
      byAuthor.set(r.user_id, {
        author: { id: r.user_id, username: r.username, displayName: r.display_name, avatarColor: r.avatar_color },
        stories: [],
      });
    }
    byAuthor.get(r.user_id).stories.push(storyDTO(r, req.userId));
  }
  // put my own group first
  const groups = [...byAuthor.values()];
  groups.sort((a, b) => (a.author.id === req.userId ? -1 : b.author.id === req.userId ? 1 : 0));

  res.json({ groups });
});

router.get('/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM stories WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Story not found or expired.' } });
  if (row.user_id !== req.userId) {
    db.prepare('INSERT OR IGNORE INTO story_views (story_id, viewer_id) VALUES (?, ?)').run(row.id, req.userId);
  }
  res.json({ story: storyDTO(row, req.userId) });
});

router.get('/:id/viewers', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM stories WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Story not found.' } });
  if (row.user_id !== req.userId) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only the author can see viewers.' } });
  const viewers = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.avatar_color, sv.viewed_at FROM story_views sv
    JOIN users u ON u.id = sv.viewer_id WHERE sv.story_id = ? ORDER BY sv.viewed_at DESC
  `).all(row.id);
  res.json({ viewers: viewers.map(v => ({ id: v.id, username: v.username, displayName: v.display_name, avatarColor: v.avatar_color, viewedAt: v.viewed_at })) });
});

router.delete('/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM stories WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Story not found.' } });
  if (row.user_id !== req.userId) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You can only delete your own stories.' } });
  db.prepare("UPDATE stories SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(row.id);
  res.json({ ok: true });
});

export default router;
