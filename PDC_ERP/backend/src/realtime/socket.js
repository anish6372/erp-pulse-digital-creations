const { Server } = require('socket.io');
const { db } = require('../db');
const { hash } = require('../utils/crypto');
const { now } = require('../utils/datetime');
const presence = require('./presence');
const { setIO } = require('./io');

function userBySessionToken(token) {
  if (!token) return null;
  const tokenHash = hash(token);
  const r = db
    .prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1`)
    .get(tokenHash, now());
  return r || null;
}

function initSocket(httpServer, corsOrigins) {
  const io = new Server(httpServer, { cors: { origin: corsOrigins, credentials: false } });
  setIO(io);

  io.use((socket, next) => {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    const user = userBySessionToken(token);
    if (!user) return next(new Error('unauthorized'));
    socket.user = user;
    next();
  });

  io.on('connection', (socket) => {
    const userId = socket.user.id;
    socket.join('user:' + userId);

    const groupIds = db.prepare('SELECT group_id FROM chat_group_members WHERE user_id=?').all(userId).map((r) => r.group_id);
    for (const gid of groupIds) socket.join('group:' + gid);

    const justCameOnline = presence.addSocket(userId, socket.id);
    socket.emit('presence:snapshot', presence.onlineUserIds());
    if (justCameOnline) socket.broadcast.emit('presence:update', { userId, online: true });

    socket.on('typing:start', (data) => {
      const { toUserId, groupId } = data || {};
      if (toUserId) io.to('user:' + toUserId).emit('typing', { fromUserId: userId, fromName: socket.user.name });
      else if (groupId) socket.to('group:' + groupId).emit('typing', { fromUserId: userId, fromName: socket.user.name, groupId });
    });

    socket.on('typing:stop', (data) => {
      const { toUserId, groupId } = data || {};
      if (toUserId) io.to('user:' + toUserId).emit('typing:stop', { fromUserId: userId });
      else if (groupId) socket.to('group:' + groupId).emit('typing:stop', { fromUserId: userId, groupId });
    });

    socket.on('group:join', (groupId) => {
      const member = db.prepare('SELECT 1 FROM chat_group_members WHERE group_id=? AND user_id=?').get(Number(groupId), userId);
      if (member) socket.join('group:' + groupId);
    });

    socket.on('disconnect', () => {
      const justWentOffline = presence.removeSocket(userId, socket.id);
      if (justWentOffline) {
        const ts = now();
        db.prepare('UPDATE users SET last_seen=? WHERE id=?').run(ts, userId);
        io.emit('presence:update', { userId, online: false, last_seen: ts });
      }
    });
  });

  return io;
}

module.exports = { initSocket };
