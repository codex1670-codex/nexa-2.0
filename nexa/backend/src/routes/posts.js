import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import db from '../db.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import { isRestricted } from './users.js';
import { processMentionsAndHashtags } from '../content.js';

const router = Router();

function postDTO(row, viewerId) {
  const likeCount = db.prepare('SELECT COUNT(*) c FROM likes WHERE post_id = ?').get(row.id).c;
  const commentCount = db.prepare('SELECT COUNT(*) c FROM comments WHERE post_id = ? AND deleted_at IS NULL').get(row.id).c;
  const likedByMe = viewerId ? !!db.prepare('SELECT 1 FROM likes WHERE post_id = ? AND user_id = ?').get(row.id, viewerId) : false;
  const savedByMe = viewerId ? !!db.prepare('SELECT 1 FROM saved_posts WHERE post_id = ? AND user_id = ?').get(row.id, viewerId) : false;
  const author = db.prepare('SELECT id, username, display_name, avatar_color FROM users WHERE id = ?').get(row.user_id);
  return {
    id: row.id,
    caption: row.caption,
    imageUrl: row.image_url,
    createdAt: row.created_at,
    likeCount, commentCount, likedByMe, savedByMe,
    author: author ? { id: author.id, username: author.username, displayName: author.display_name, avatarColor: author.avatar_color } : null,
  };
}

router.post('/', requireAuth, (req, res) => {
  const { caption, imageUrl } = req.body || {};
  const cap = typeof caption === 'string' ? caption.slice(0, 2200) : '';
  if (!cap.trim() && !imageUrl) {
    return res.status(400).json({ error: { code: 'EMPTY_POST', message: 'Add a caption or an image to post.' } });
  }
  const id = uuid();
  db.prepare('INSERT INTO posts (id, user_id, caption, image_url) VALUES (?, ?, ?, ?)')
    .run(id, req.userId, cap, typeof imageUrl === 'string' ? imageUrl.slice(0, 2000) : null);
  processMentionsAndHashtags({ text: cap, sourceType: 'post', sourceId: id, actorId: req.userId, io: req.app.get('io') });
  const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
  res.status(201).json({ post: postDTO(row, req.userId) });
});

router.get('/:id', optionalAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM posts WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Post not found.' } });
  res.json({ post: postDTO(row, req.userId) });
});

router.delete('/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Post not found.' } });
  if (row.user_id !== req.userId) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You can only delete your own posts.' } });
  db.prepare("UPDATE posts SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(row.id);
  res.json({ ok: true });
});

router.post('/:id/like', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM posts WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Post not found.' } });
  db.prepare('INSERT OR IGNORE INTO likes (user_id, post_id) VALUES (?, ?)').run(req.userId, row.id);
  if (row.user_id !== req.userId) {
    db.prepare('INSERT INTO notifications (id, recipient_id, actor_id, type, target_id) VALUES (?, ?, ?, ?, ?)')
      .run(uuid(), row.user_id, req.userId, 'like', row.id);
    req.app.get('io')?.to(`user:${row.user_id}`).emit('notification:new', { type: 'like' });
  }
  res.json({ post: postDTO(row, req.userId) });
});

router.delete('/:id/like', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM posts WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Post not found.' } });
  db.prepare('DELETE FROM likes WHERE user_id = ? AND post_id = ?').run(req.userId, row.id);
  res.json({ post: postDTO(row, req.userId) });
});

router.get('/:id/comments', optionalAuth, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!post) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Post not found.' } });
  const rows = db.prepare(`
    SELECT c.*, u.username, u.display_name, u.avatar_color FROM comments c
    JOIN users u ON u.id = c.user_id
    WHERE c.post_id = ? AND c.deleted_at IS NULL ORDER BY c.created_at ASC LIMIT 200
  `).all(post.id);
  // A commenter restricted by the post's author is only visible to themselves and the author.
  const visible = rows.filter(r => {
    if (!isRestricted(post.user_id, r.user_id)) return true;
    return req.userId === post.user_id || req.userId === r.user_id;
  });
  res.json({
    comments: visible.map(r => ({
      id: r.id, text: r.text, createdAt: r.created_at,
      author: { id: r.user_id, username: r.username, displayName: r.display_name, avatarColor: r.avatar_color },
    })),
  });
});

router.post('/:id/comments', requireAuth, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!post) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Post not found.' } });
  const { text } = req.body || {};
  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: { code: 'EMPTY_COMMENT', message: 'Write something to comment.' } });
  }
  const id = uuid();
  db.prepare('INSERT INTO comments (id, post_id, user_id, text) VALUES (?, ?, ?, ?)')
    .run(id, post.id, req.userId, text.trim().slice(0, 1000));
  processMentionsAndHashtags({ text: text.trim(), sourceType: 'comment', sourceId: id, actorId: req.userId, io: req.app.get('io') });
  if (post.user_id !== req.userId) {
    db.prepare('INSERT INTO notifications (id, recipient_id, actor_id, type, target_id) VALUES (?, ?, ?, ?, ?)')
      .run(uuid(), post.user_id, req.userId, 'comment', post.id);
    req.app.get('io')?.to(`user:${post.user_id}`).emit('notification:new', { type: 'comment' });
  }
  const author = db.prepare('SELECT username, display_name, avatar_color FROM users WHERE id = ?').get(req.userId);
  res.status(201).json({
    comment: { id, text: text.trim().slice(0, 1000), createdAt: new Date().toISOString(),
      author: { id: req.userId, username: author.username, displayName: author.display_name, avatarColor: author.avatar_color } },
  });
});

router.post('/:id/save', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM posts WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Post not found.' } });
  db.prepare('INSERT OR IGNORE INTO saved_posts (user_id, post_id) VALUES (?, ?)').run(req.userId, row.id);
  res.json({ ok: true, saved: true });
});

router.delete('/:id/save', requireAuth, (req, res) => {
  db.prepare('DELETE FROM saved_posts WHERE user_id = ? AND post_id = ?').run(req.userId, req.params.id);
  res.json({ ok: true, saved: false });
});

router.get('/saved/mine', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT p.* FROM saved_posts sp JOIN posts p ON p.id = sp.post_id
    WHERE sp.user_id = ? AND p.deleted_at IS NULL ORDER BY sp.created_at DESC
  `).all(req.userId);
  res.json({ posts: rows.map(r => postDTO(r, req.userId)) });
});

export { postDTO, processMentionsAndHashtags };
export default router;
