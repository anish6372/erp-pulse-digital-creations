import { io } from 'socket.io-client';
import { state } from './state.js';

let socket = null;

export function connectSocket() {
  if (socket) return socket;
  socket = io('/', { auth: { token: state.token }, transports: ['websocket', 'polling'] });

  socket.on('presence:snapshot', (ids) => {
    state.onlineUsers = new Set(ids);
    document.dispatchEvent(new CustomEvent('presence:changed'));
  });
  socket.on('presence:update', ({ userId, online, last_seen }) => {
    if (online) state.onlineUsers.add(userId);
    else {
      state.onlineUsers.delete(userId);
      if (last_seen) state.lastSeen[userId] = last_seen;
    }
    document.dispatchEvent(new CustomEvent('presence:changed'));
  });

  return socket;
}

export function getSocket() {
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.close();
    socket = null;
  }
  state.onlineUsers = new Set();
}
