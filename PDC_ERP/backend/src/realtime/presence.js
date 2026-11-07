// In-memory online presence: userId -> Set of connected socket ids.
// A user can have several tabs/devices open; they're "online" while at least one socket is connected.
const online = new Map();

function addSocket(userId, socketId) {
  if (!online.has(userId)) online.set(userId, new Set());
  const set = online.get(userId);
  const justCameOnline = set.size === 0;
  set.add(socketId);
  return justCameOnline;
}

function removeSocket(userId, socketId) {
  const set = online.get(userId);
  if (!set) return false;
  set.delete(socketId);
  if (set.size === 0) {
    online.delete(userId);
    return true;
  }
  return false;
}

function isOnline(userId) {
  return online.has(userId);
}

function onlineUserIds() {
  return Array.from(online.keys());
}

module.exports = { addSocket, removeSocket, isOnline, onlineUserIds };
