import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import db from '../db.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import { processMentionsAndHashtags } from '../content.js';

const router = Router();

function reelDTO(row, viewerId) {
  const likeCount = db.prepare('SELECT COUNT(*) c FROM reel_likes WHERE reel_id = ?').get(row.id).c;
  const commentCount = db.prepare('SELECT COUNT(*) c FROM reel_comments WHERE reel_id = ? AND deleted_at IS NULL').get(row.id).c;
  const likedByMe = viewerId ? !!db.prepare('SELECT 1 FROM reel_likes WHERE reel_id = ? AND user_id = ?').get(row.id, viewerId) : false;
  const author = db.prepare('SELECT id, username, display_name, avatar_color FROM users WHERE id = ?').get(row.user_id);
  return {
    id: row.id, videoUrl: row.video_url, caption: row.caption, createdAt: row.created_at,
    likeCount, commentCount, likedByMe,
    author: author ? { id: author.id, username: author.username, displayName: author.display_name, avatarColor: author.avatar_color } : null,
  };
}

const URL_RE = /^https?:\/\/.+\.(mp4|webm|mov)(\?.*)?$/i;

router.post('/', requireAuth, (req, res) => {
  const { videoUrl, caption } = req.body || {};
  if (typeof videoUrl !== 'string' || !URL_RE.test(videoUrl.trim())) {
    return res.status(400).json({
      error: { code: 'INVALID_VIDEO_URL', message: 'Provide a direct link to an already-hosted .mp4/.webm/.mov file — this slice has no upload/transcode pipeline.' },
    });
  }
  const id = uuid();
  db.prepare('INSERT INTO reels (id, user_id, video_url, caption) VALUES (?, ?, ?, ?)')
    .run(id, req.userId, videoUrl.trim().slice(0, 2000), typeof caption === 'string' ? caption.slice(0, 2200) : '');
  processMentionsAndHashtags({ text: caption, sourceType: 'reel', sourceId: id, actorId: req.userId, io: req.app.get('io') });
  const row = db.prepare('SELECT * FROM reels WHERE id = ?').get(id);
  res.status(201).json({ reel: reelDTO(row, req.userId) });
});

router.get('/feed', optionalAuth, (req, res) => {
  const cursor = req.query.cursor || '9999-12-31T23:59:59.999Z';
  const blocked = req.userId
    ? db.prepare('SELECT blocked_id AS id FROM blocks WHERE blocker_id = ? UNION SELECT blocker_id AS id FROM blocks WHERE blocked_id = ?').all(req.userId, req.userId).map(r => r.id)
    : [];
  const placeholders = blocked.length ? blocked.map(() => '?').join(',') : null;
  const rows = db.prepare(`
    SELECT * FROM reels WHERE deleted_at IS NULL AND created_at < ?
    ${placeholders ? `AND user_id NOT IN (${placeholders})` : ''}
    ORDER BY created_at DESC LIMIT 11
  `).all(cursor, ...(blocked.length ? blocked : []));
  const hasMore = rows.length > 10;
  const page = rows.slice(0, 10);
  res.json({ reels: page.map(r => reelDTO(r, req.userId)), nextCursor: hasMore ? page[page.length - 1].created_at : null });
});

router.delete('/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM reels WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Reel not found.' } });
  if (row.user_id !== req.userId) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You can only delete your own reels.' } });
  db.prepare("UPDATE reels SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(row.id);
  res.json({ ok: true });
});

router.post('/:id/like', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM reels WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Reel not found.' } });
  db.prepare('INSERT OR IGNORE INTO reel_likes (user_id, reel_id) VALUES (?, ?)').run(req.userId, row.id);
  if (row.user_id !== req.userId) {
    db.prepare("INSERT INTO notifications (id, recipient_id, actor_id, type, target_id) VALUES (?, ?, ?, 'reel_like', ?)").run(uuid(), row.user_id, req.userId, row.id);
    req.app.get('io')?.to(`user:${row.user_id}`).emit('notification:new', { type: 'reel_like' });
  }
  res.json({ reel: reelDTO(row, req.userId) });
});

router.delete('/:id/like', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM reels WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Reel not found.' } });
  db.prepare('DELETE FROM reel_likes WHERE user_id = ? AND reel_id = ?').run(req.userId, row.id);
  res.json({ reel: reelDTO(row, req.userId) });
});

router.get('/:id/comments', optionalAuth, (req, res) => {
  const reel = db.prepare('SELECT * FROM reels WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!reel) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Reel not found.' } });
  const rows = db.prepare(`
    SELECT c.*, u.username, u.display_name, u.avatar_color FROM reel_comments c
    JOIN users u ON u.id = c.user_id WHERE c.reel_id = ? AND c.deleted_at IS NULL ORDER BY c.created_at ASC LIMIT 200
  `).all(reel.id);
  res.json({ comments: rows.map(r => ({ id: r.id, text: r.text, createdAt: r.created_at, author: { id: r.user_id, username: r.username, displayName: r.display_name, avatarColor: r.avatar_color } })) });
});

router.post('/:id/comments', requireAuth, (req, res) => {
  const reel = db.prepare('SELECT * FROM reels WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!reel) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Reel not found.' } });
  const { text } = req.body || {};
  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: { code: 'EMPTY_COMMENT', message: 'Write something to comment.' } });
  }
  const id = uuid();
  db.prepare('INSERT INTO reel_comments (id, reel_id, user_id, text) VALUES (?, ?, ?, ?)').run(id, reel.id, req.userId, text.trim().slice(0, 1000));
  if (reel.user_id !== req.userId) {
    db.prepare("INSERT INTO notifications (id, recipient_id, actor_id, type, target_id) VALUES (?, ?, ?, 'reel_comment', ?)").run(uuid(), reel.user_id, req.userId, reel.id);
    req.app.get('io')?.to(`user:${reel.user_id}`).emit('notification:new', { type: 'reel_comment' });
  }
  const author = db.prepare('SELECT username, display_name, avatar_color FROM users WHERE id = ?').get(req.userId);
  res.status(201).json({ comment: { id, text: text.trim().slice(0, 1000), createdAt: new Date().toISOString(), author: { id: req.userId, username: author.username, displayName: author.display_name, avatarColor: author.avatar_color } } });
});

router.post('/:id/save', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM reels WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Reel not found.' } });
  db.prepare('INSERT OR IGNORE INTO saved_reels (user_id, reel_id) VALUES (?, ?)').run(req.userId, row.id);
  res.json({ ok: true, saved: true });
});

router.delete('/:id/save', requireAuth, (req, res) => {
  db.prepare('DELETE FROM saved_reels WHERE user_id = ? AND reel_id = ?').run(req.userId, req.params.id);
  res.json({ ok: true, saved: false });
});

router.get('/saved/mine', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT r.* FROM saved_reels sr JOIN reels r ON r.id = sr.reel_id
    WHERE sr.user_id = ? AND r.deleted_at IS NULL ORDER BY sr.created_at DESC
  `).all(req.userId);
  res.json({ reels: rows.map(r => reelDTO(r, req.userId)) });
});

export default router;
