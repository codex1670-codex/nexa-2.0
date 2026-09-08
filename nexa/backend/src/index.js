import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';

import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import postRoutes from './routes/posts.js';
import feedRoutes from './routes/feed.js';
import messageRoutes from './routes/messages.js';
import notificationRoutes from './routes/notifications.js';
import noteRoutes from './routes/notes.js';
import storyRoutes from './routes/stories.js';
import reelRoutes from './routes/reels.js';
import gameRoutes from './routes/games.js';
import reportRoutes from './routes/reports.js';
import searchRoutes from './routes/search.js';
import appRoutes from './routes/apps.js';
import callRoutes from './routes/calls.js';
import { registerGameHandlers } from './gameEngine.js';
import { registerCallHandlers } from './callEngine.js';
import { ACCESS_SECRET } from './middleware/auth.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Rate limiting: tighter on auth (brute-force protection), looser but present on general API.
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait a few minutes and try again.' } } });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' } } });

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'nexa-backend', time: new Date().toISOString() }));

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/users', apiLimiter, userRoutes);
app.use('/api/posts', apiLimiter, postRoutes);
app.use('/api/feed', apiLimiter, feedRoutes);
app.use('/api/messages', apiLimiter, messageRoutes);
app.use('/api/notifications', apiLimiter, notificationRoutes);
app.use('/api/notes', apiLimiter, noteRoutes);
app.use('/api/stories', apiLimiter, storyRoutes);
app.use('/api/reels', apiLimiter, reelRoutes);
app.use('/api/games', apiLimiter, gameRoutes);
app.use('/api/reports', apiLimiter, reportRoutes);
app.use('/api/search', apiLimiter, searchRoutes);
app.use('/api/apps', apiLimiter, appRoutes);
app.use('/api/calls', apiLimiter, callRoutes);

// 404 for unknown API routes
app.use('/api', (_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found.' } }));

// Centralized error handler: never leak stack traces to clients.
app.use((err, _req, res, _next) => {
  console.error('[nexa] unhandled error:', err);
  res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Something went wrong. Please try again.' } });
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
app.set('io', io);

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    const payload = jwt.verify(token, ACCESS_SECRET);
    socket.userId = payload.sub;
    next();
  } catch {
    next(new Error('unauthorized'));
  }
});

io.on('connection', (socket) => {
  socket.join(`user:${socket.userId}`);
  socket.on('typing', ({ conversationId }) => {
    socket.to(`conversation:${conversationId}`).emit('typing', { userId: socket.userId, conversationId });
  });
  socket.on('conversation:join', ({ conversationId }) => {
    socket.join(`conversation:${conversationId}`);
  });
  registerGameHandlers(io, socket);
  registerCallHandlers(io, socket);
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`NEXA backend listening on http://localhost:${PORT}`);
});
