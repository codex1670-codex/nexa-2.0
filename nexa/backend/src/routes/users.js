import { Router } from 'express';
import db from '../db.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import { v4 as uuid } from 'uuid';
import { generateText } from '../llm.js';

const router = Router();

function isBlocked(a, b) {
  return !!db.prepare('SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)')
    .get(a, b, b, a);
}

function profileFor(user, viewerId) {
  const followerCount = db.prepare('SELECT COUNT(*) c FROM follows WHERE followed_id = ?').get(user.id).c;
  const followingCount = db.prepare('SELECT COUNT(*) c FROM follows WHERE follower_id = ?').get(user.id).c;
  const postCount = db.prepare('SELECT COUNT(*) c FROM posts WHERE user_id = ? AND deleted_at IS NULL').get(user.id).c;
  const isFollowing = viewerId ? !!db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followed_id = ?').get(viewerId, user.id) : false;
  const isSelf = viewerId === user.id;
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    bio: user.bio,
    avatarColor: user.avatar_color,
    followerCount, followingCount, postCount,
    isFollowing, isSelf,
  };
}

router.get('/:username', optionalAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(req.params.username);
  if (!user || user.account_status !== 'active') {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found.' } });
  }
  if (req.userId && isBlocked(req.userId, user.id)) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found.' } });
  }
  res.json({ user: profileFor(user, req.userId) });
});

router.patch('/me', requireAuth, (req, res) => {
  const { displayName, bio } = req.body || {};
  const fields = [];
  const values = [];
  if (typeof displayName === 'string' && displayName.trim()) { fields.push('display_name = ?'); values.push(displayName.trim().slice(0, 60)); }
  if (typeof bio === 'string') { fields.push('bio = ?'); values.push(bio.slice(0, 300)); }
  if (!fields.length) return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Nothing to update.' } });
  values.push(req.userId);
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  res.json({ user: profileFor(user, req.userId) });
});

// Codex bio actions: Write / Improve / Professional / Shorter / Translate.
// Uses a real LLM call (requires ANTHROPIC_API_KEY) — returns an honest 503 if not
// configured rather than faking a canned rewrite. Never auto-saves; the user reviews
// the suggestion and saves via PATCH /users/me themselves.
router.post('/me/bio/ai', requireAuth, async (req, res) => {
  const { action, currentBio, targetLanguage } = req.body || {};
  const valid = ['write', 'improve', 'professional', 'shorter', 'translate'];
  if (!valid.includes(action)) {
    return res.status(400).json({ error: { code: 'INVALID_ACTION', message: `action must be one of: ${valid.join(', ')}` } });
  }
  const bio = typeof currentBio === 'string' ? currentBio.slice(0, 300) : '';

  const prompts = {
    write: 'Write a short, appealing social media bio (max 2 sentences, under 150 characters) for a new user. Keep it generic and friendly since no details were given. Return ONLY the bio text, nothing else.',
    improve: `Improve this social media bio while keeping its meaning and personality (under 150 characters). Return ONLY the improved bio text, nothing else.\n\nBio: "${bio}"`,
    professional: `Rewrite this social media bio in a more professional tone (under 150 characters). Return ONLY the rewritten bio text, nothing else.\n\nBio: "${bio}"`,
    shorter: `Shorten this social media bio while keeping its key meaning (under 80 characters). Return ONLY the shortened bio text, nothing else.\n\nBio: "${bio}"`,
    translate: `Translate this social media bio into ${targetLanguage || 'Spanish'} (under 150 characters). Return ONLY the translated bio text, nothing else.\n\nBio: "${bio}"`,
  };
  if ((action === 'improve' || action === 'professional' || action === 'shorter' || action === 'translate') && !bio.trim()) {
    return res.status(400).json({ error: { code: 'EMPTY_BIO', message: 'Write a bio first, then I can help improve it.' } });
  }

  const result = await generateText({ system: 'You write concise, natural social media bios. Never use quotation marks in your output.', prompt: prompts[action], maxTokens: 120 });
  if (!result.ok) {
    if (result.reason === 'not_configured') {
      return res.status(503).json({ error: { code: 'AI_NOT_CONFIGURED', message: 'AI bio tools need an ANTHROPIC_API_KEY set on the server — see the README.' } });
    }
    return res.status(502).json({ error: { code: 'AI_ERROR', message: 'The AI service failed. Please try again.' } });
  }
  // Validate generated content before it's ever shown/saved, per spec: hard length cap, strip quotes.
  const clean = result.text.replace(/^["']|["']$/g, '').slice(0, 300);
  res.json({ suggestion: clean });
});

router.post('/:username/follow', requireAuth, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE username = ?').get(req.params.username);
  if (!target) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found.' } });
  if (target.id === req.userId) return res.status(400).json({ error: { code: 'INVALID_ACTION', message: "You can't follow yourself." } });
  if (isBlocked(req.userId, target.id)) return res.status(403).json({ error: { code: 'BLOCKED', message: 'Unable to follow this user.' } });

  db.prepare('INSERT OR IGNORE INTO follows (follower_id, followed_id) VALUES (?, ?)').run(req.userId, target.id);
  db.prepare('INSERT INTO notifications (id, recipient_id, actor_id, type) VALUES (?, ?, ?, ?)')
    .run(uuid(), target.id, req.userId, 'follow');
  req.app.get('io')?.to(`user:${target.id}`).emit('notification:new', { type: 'follow' });

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(target.id);
  res.json({ user: profileFor(updated, req.userId) });
});

router.delete('/:username/follow', requireAuth, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE username = ?').get(req.params.username);
  if (!target) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found.' } });
  db.prepare('DELETE FROM follows WHERE follower_id = ? AND followed_id = ?').run(req.userId, target.id);
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(target.id);
  res.json({ user: profileFor(updated, req.userId) });
});

router.get('/:username/followers', optionalAuth, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE username = ?').get(req.params.username);
  if (!target) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found.' } });
  const list = db.prepare(`
    SELECT u.* FROM follows f JOIN users u ON u.id = f.follower_id
    WHERE f.followed_id = ? ORDER BY f.created_at DESC LIMIT 50
  `).all(target.id);
  res.json({ users: list.map(u => profileFor(u, req.userId)) });
});

router.get('/:username/following', optionalAuth, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE username = ?').get(req.params.username);
  if (!target) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found.' } });
  const list = db.prepare(`
    SELECT u.* FROM follows f JOIN users u ON u.id = f.followed_id
    WHERE f.follower_id = ? ORDER BY f.created_at DESC LIMIT 50
  `).all(target.id);
  res.json({ users: list.map(u => profileFor(u, req.userId)) });
});

router.get('/', requireAuth, (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ users: [] });
  const list = db.prepare(`
    SELECT * FROM users WHERE account_status = 'active' AND (username LIKE ? OR display_name LIKE ?)
    AND id != ? LIMIT 10
  `).all(`%${q}%`, `%${q}%`, req.userId);
  res.json({ users: list.map(u => profileFor(u, req.userId)) });
});

router.get('/me/close-friends', requireAuth, (req, res) => {
  const list = db.prepare(`
    SELECT u.* FROM close_friends cf JOIN users u ON u.id = cf.friend_id
    WHERE cf.owner_id = ? ORDER BY cf.created_at DESC
  `).all(req.userId);
  res.json({ users: list.map(u => profileFor(u, req.userId)) });
});

router.post('/:username/close-friend', requireAuth, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE username = ?').get(req.params.username);
  if (!target) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found.' } });
  if (target.id === req.userId) return res.status(400).json({ error: { code: 'INVALID_ACTION', message: "You can't add yourself." } });
  db.prepare('INSERT OR IGNORE INTO close_friends (owner_id, friend_id) VALUES (?, ?)').run(req.userId, target.id);
  res.json({ ok: true });
});

router.delete('/:username/close-friend', requireAuth, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE username = ?').get(req.params.username);
  if (!target) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found.' } });
  db.prepare('DELETE FROM close_friends WHERE owner_id = ? AND friend_id = ?').run(req.userId, target.id);
  res.json({ ok: true });
});

router.post('/:username/restrict', requireAuth, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE username = ?').get(req.params.username);
  if (!target) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found.' } });
  if (target.id === req.userId) return res.status(400).json({ error: { code: 'INVALID_ACTION', message: "You can't restrict yourself." } });
  db.prepare('INSERT OR IGNORE INTO restricts (owner_id, restricted_id) VALUES (?, ?)').run(req.userId, target.id);
  res.json({ ok: true, restricted: true });
});

router.delete('/:username/restrict', requireAuth, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE username = ?').get(req.params.username);
  if (!target) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found.' } });
  db.prepare('DELETE FROM restricts WHERE owner_id = ? AND restricted_id = ?').run(req.userId, target.id);
  res.json({ ok: true, restricted: false });
});

router.post('/:username/block', requireAuth, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE username = ?').get(req.params.username);
  if (!target) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found.' } });
  if (target.id === req.userId) return res.status(400).json({ error: { code: 'INVALID_ACTION', message: "You can't block yourself." } });
  db.prepare('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?, ?)').run(req.userId, target.id);
  db.prepare('DELETE FROM follows WHERE (follower_id = ? AND followed_id = ?) OR (follower_id = ? AND followed_id = ?)')
    .run(req.userId, target.id, target.id, req.userId);
  res.json({ ok: true, blocked: true });
});

router.delete('/:username/block', requireAuth, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE username = ?').get(req.params.username);
  if (!target) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found.' } });
  db.prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?').run(req.userId, target.id);
  res.json({ ok: true, blocked: false });
});

function isRestricted(ownerId, restrictedId) {
  return !!db.prepare('SELECT 1 FROM restricts WHERE owner_id = ? AND restricted_id = ?').get(ownerId, restrictedId);
}

router.post('/:username/mute', requireAuth, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE username = ?').get(req.params.username);
  if (!target) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found.' } });
  if (target.id === req.userId) return res.status(400).json({ error: { code: 'INVALID_ACTION', message: "You can't mute yourself." } });
  db.prepare('INSERT OR IGNORE INTO mutes (muter_id, muted_id) VALUES (?, ?)').run(req.userId, target.id);
  res.json({ ok: true, muted: true });
});

router.delete('/:username/mute', requireAuth, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE username = ?').get(req.params.username);
  if (!target) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found.' } });
  db.prepare('DELETE FROM mutes WHERE muter_id = ? AND muted_id = ?').run(req.userId, target.id);
  res.json({ ok: true, muted: false });
});

function isMuted(muterId, mutedId) {
  return !!db.prepare('SELECT 1 FROM mutes WHERE muter_id = ? AND muted_id = ?').get(muterId, mutedId);
}

export { profileFor, isBlocked, isRestricted, isMuted };
export default router;
