import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

function genInviteCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export function roomDTO(room) {
  const players = db.prepare(`
    SELECT gp.*, u.username, u.display_name, u.avatar_color FROM game_players gp
    JOIN users u ON u.id = gp.user_id
    WHERE gp.room_id = ? AND gp.left_at IS NULL ORDER BY gp.slot ASC
  `).all(room.id);
  return {
    id: room.id,
    gameId: room.game_id,
    hostId: room.host_id,
    inviteCode: room.invite_code,
    capacity: room.capacity,
    status: room.status,
    state: JSON.parse(room.state || '{}'),
    players: players.map(p => ({
      slot: p.slot, ready: !!p.ready,
      user: { id: p.user_id, username: p.username, displayName: p.display_name, avatarColor: p.avatar_color },
    })),
    createdAt: room.created_at, startedAt: room.started_at, endedAt: room.ended_at,
  };
}

router.get('/', (_req, res) => {
  const games = db.prepare("SELECT * FROM games WHERE status = 'active'").all();
  res.json({ games: games.map(g => ({ id: g.id, name: g.name, category: g.category, minPlayers: g.min_players, maxPlayers: g.max_players })) });
});


router.get('/rooms/mine', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT r.* FROM game_rooms r JOIN game_players gp ON gp.room_id = r.id
    WHERE gp.user_id = ? AND gp.left_at IS NULL AND r.status != 'finished'
    ORDER BY r.created_at DESC
  `).all(req.userId);
  res.json({ rooms: rows.map(roomDTO) });
});

router.post('/rooms', requireAuth, (req, res) => {
  const { gameId } = req.body || {};
  const game = db.prepare('SELECT * FROM games WHERE id = ? AND status = ?').get(gameId, 'active');
  if (!game) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'That game is not available.' } });

  const roomId = uuid();
  let code = genInviteCode();
  while (db.prepare('SELECT 1 FROM game_rooms WHERE invite_code = ?').get(code)) code = genInviteCode();

  const tx = db.transaction(() => {
    db.prepare('INSERT INTO game_rooms (id, game_id, host_id, invite_code, capacity, state) VALUES (?, ?, ?, ?, ?, ?)')
      .run(roomId, game.id, req.userId, code, game.max_players, JSON.stringify({}));
    db.prepare('INSERT INTO game_players (room_id, user_id, slot) VALUES (?, ?, 0)').run(roomId, req.userId);
  });
  tx();

  const room = db.prepare('SELECT * FROM game_rooms WHERE id = ?').get(roomId);
  res.status(201).json({ room: roomDTO(room) });
});

router.post('/rooms/join', requireAuth, (req, res) => {
  const { inviteCode } = req.body || {};
  const room = db.prepare('SELECT * FROM game_rooms WHERE invite_code = ?').get(String(inviteCode || '').toUpperCase().trim());
  if (!room) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No room with that code.' } });
  if (room.status !== 'waiting') return res.status(409).json({ error: { code: 'ROOM_UNAVAILABLE', message: 'This room already started or ended.' } });

  const existing = db.prepare('SELECT * FROM game_players WHERE room_id = ? AND user_id = ?').get(room.id, req.userId);
  if (existing) return res.json({ room: roomDTO(room) });

  const activeCount = db.prepare('SELECT COUNT(*) c FROM game_players WHERE room_id = ? AND left_at IS NULL').get(room.id).c;
  if (activeCount >= room.capacity) return res.status(409).json({ error: { code: 'ROOM_FULL', message: 'This room is full.' } });

  const usedSlots = db.prepare('SELECT slot FROM game_players WHERE room_id = ? AND left_at IS NULL').all(room.id).map(r => r.slot);
  let slot = 0;
  while (usedSlots.includes(slot)) slot++;

  db.prepare('INSERT INTO game_players (room_id, user_id, slot) VALUES (?, ?, ?)').run(room.id, req.userId, slot);
  const updated = db.prepare('SELECT * FROM game_rooms WHERE id = ?').get(room.id);
  const dto = roomDTO(updated);
  req.app.get('io')?.to(`game:${room.id}`).emit('game:state', dto);
  res.json({ room: dto });
});

router.get('/rooms/:id', requireAuth, (req, res) => {
  const room = db.prepare('SELECT * FROM game_rooms WHERE id = ?').get(req.params.id);
  if (!room) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Room not found.' } });
  const isPlayer = db.prepare('SELECT 1 FROM game_players WHERE room_id = ? AND user_id = ?').get(room.id, req.userId);
  if (!isPlayer) return res.status(403).json({ error: { code: 'FORBIDDEN', message: "You're not in this game room." } });
  res.json({ room: roomDTO(room) });
});

export default router;
