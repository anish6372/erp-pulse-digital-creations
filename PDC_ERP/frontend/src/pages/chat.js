import { api } from '../lib/api.js';
import { state } from '../lib/state.js';
import { $, esc, initials } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { getSocket } from '../lib/socket.js';
import { updateNotifications } from './notifications.js';
import { openGroupModal } from '../components/modals.js';

let groups = [];
let typingUsers = new Map(); // key: userId or 'group:<id>:<userId>' -> name
let typingTimers = new Map();
let socketWired = false;
let composeTypingActive = false;
let composeTypingTimer = null;

function timeAgo(iso) {
  if (!iso) return 'never';
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

function presenceLine(userId) {
  const online = state.onlineUsers.has(userId);
  const lastSeen = state.lastSeen[userId];
  return { online, text: online ? 'Online' : lastSeen ? `Last seen ${timeAgo(lastSeen)}` : 'Offline' };
}

export async function renderChat() {
  wireSocketListeners();
  await refreshGroupList(false);
  renderShell();
}

function renderShell() {
  const { me } = state;
  $('page-chat').innerHTML = `<div class="title"><h1>Company Chat</h1><p>Direct messages and group conversations, live.</p></div>
  <div class="card chat">
    <div class="chatList">
      <div class="chat-tabs">
        <button class="chat-tab ${state.chatMode === 'direct' ? 'active' : ''}" id="tabDirect">Direct</button>
        <button class="chat-tab ${state.chatMode === 'group' ? 'active' : ''}" id="tabGroups">Groups</button>
        <button class="btn alt chat-newgroup" id="newGroupBtn" title="New group">${icon('plus')}</button>
      </div>
      <div id="chatListItems"></div>
    </div>
    <div class="chatBody" id="chatBody"><div class="empty">Select a conversation to start.</div></div>
  </div>`;
  $('tabDirect').onclick = () => {
    state.chatMode = 'direct';
    renderShell();
  };
  $('tabGroups').onclick = async () => {
    state.chatMode = 'group';
    await refreshGroupList(false);
    renderShell();
  };
  $('newGroupBtn').onclick = openGroupModal;
  renderListItems();
  if (state.chatMode === 'direct' && state.selectedChatId) openChat(state.selectedChatId);
  else if (state.chatMode === 'group' && state.selectedGroupId) openGroupChat(state.selectedGroupId);
}

function renderListItems() {
  const el = $('chatListItems');
  if (!el) return;
  if (state.chatMode === 'direct') {
    const users = state.boot.users.filter((x) => x.active && x.id !== state.me.id);
    el.innerHTML = users
      .map((u) => {
        const p = presenceLine(u.id);
        return `<div class="chatUser ${state.selectedChatId === u.id ? 'sel' : ''}" data-user-id="${u.id}">
          <div class="row"><div class="avatar-wrap"><div class="avatar">${initials(u.name)}</div><span class="presence-dot ${p.online ? 'online' : ''}"></span></div>
          <div><b>${esc(u.name)}</b><div class="mini">${esc(p.text)}</div></div></div>
        </div>`;
      })
      .join('');
    el.querySelectorAll('[data-user-id]').forEach((e) => (e.onclick = () => openChat(Number(e.dataset.userId))));
  } else {
    el.innerHTML = groups.length
      ? groups
          .map(
            (g) => `<div class="chatUser ${state.selectedGroupId === g.id ? 'sel' : ''}" data-group-id="${g.id}">
        <div class="row"><div class="avatar group-avatar">${icon('groupchat')}</div>
        <div><b>${esc(g.name)}</b><div class="mini">${g.members.length} members${g.last_message ? ' &bull; ' + esc(g.last_message.slice(0, 28)) : ''}</div></div></div>
        ${g.unread ? `<span class="badge red group-unread">${g.unread}</span>` : ''}
      </div>`
          )
          .join('')
      : '<div class="empty">No groups yet. Create one above.</div>';
    el.querySelectorAll('[data-group-id]').forEach((e) => (e.onclick = () => openGroupChat(Number(e.dataset.groupId))));
  }
}

export async function refreshGroupList(rerender = true) {
  try {
    const d = await api('/api/chat/groups');
    groups = d.groups || [];
  } catch (e) {
    groups = [];
  }
  if (rerender && $('chatListItems')) renderListItems();
}

async function openChat(id) {
  state.chatMode = 'direct';
  state.selectedChatId = id;
  const d = await api('/api/chat?with_id=' + id);
  const other = d.user;
  const p = presenceLine(id);
  const body = d.messages
    .map((m) => `<div class="bubble ${m.sender_id === state.me.id ? 'mine' : ''}">${esc(m.body)}<small>${new Date(m.created_at).toLocaleString('en-IN')}</small></div>`)
    .join('');
  $('chatBody').innerHTML = `<div class="sectionHead"><h3>${esc(other.name)} <span class="presence-pill ${p.online ? 'online' : ''}">${esc(p.text)}</span></h3></div>
    <div class="messages" id="messages">${body || '<div class="empty">No messages yet.</div>'}</div>
    <div class="typing-line" id="typingLine"></div>
    <form id="chatForm" class="row" style="margin-top:8px"><input id="chatInput" placeholder="Type a message..." style="flex:1;padding:10px;border:1px solid var(--line);border-radius:10px" required autocomplete="off"><button class="btn">${icon(
      'send'
    )}<span>Send</span></button></form>`;
  $('messages').scrollTop = $('messages').scrollHeight;
  $('chatForm').addEventListener('submit', sendDirectMessage);
  wireComposeTyping($('chatInput'), { toUserId: id });
  document.querySelectorAll('.chatUser[data-user-id]').forEach((e) => e.classList.toggle('sel', Number(e.dataset.userId) === id));
}

async function sendDirectMessage(e) {
  e.preventDefault();
  const body = $('chatInput').value.trim();
  if (!body) return;
  $('chatInput').value = '';
  stopComposeTyping({ toUserId: state.selectedChatId });
  await api('/api/chat', { method: 'POST', body: JSON.stringify({ receiver_id: state.selectedChatId, body }) });
  await openChat(state.selectedChatId);
  await updateNotifications();
}

export async function openGroupChat(id) {
  state.chatMode = 'group';
  state.selectedGroupId = id;
  const socket = getSocket();
  if (socket) socket.emit('group:join', id);
  const d = await api('/api/chat/groups/' + id + '/messages');
  const body = d.messages
    .map(
      (m) =>
        `<div class="bubble ${m.sender_id === state.me.id ? 'mine' : ''}">${m.sender_id !== state.me.id ? `<div class="bubble-sender">${esc(m.sender_name)}</div>` : ''}${esc(
          m.body
        )}<small>${new Date(m.created_at).toLocaleString('en-IN')}</small></div>`
    )
    .join('');
  $('chatBody').innerHTML = `<div class="sectionHead"><h3>${esc(d.group.name)} <span class="mini">${d.members.length} members</span></h3></div>
    <div class="messages" id="messages">${body || '<div class="empty">No messages yet.</div>'}</div>
    <div class="typing-line" id="typingLine"></div>
    <form id="chatForm" class="row" style="margin-top:8px"><input id="chatInput" placeholder="Message the group..." style="flex:1;padding:10px;border:1px solid var(--line);border-radius:10px" required autocomplete="off"><button class="btn">${icon(
      'send'
    )}<span>Send</span></button></form>`;
  $('messages').scrollTop = $('messages').scrollHeight;
  $('chatForm').addEventListener('submit', (e) => sendGroupMessage(e, id));
  wireComposeTyping($('chatInput'), { groupId: id });
  document.querySelectorAll('.chatUser[data-group-id]').forEach((e) => e.classList.toggle('sel', Number(e.dataset.groupId) === id));
  await refreshGroupList();
}

async function sendGroupMessage(e, groupId) {
  e.preventDefault();
  const body = $('chatInput').value.trim();
  if (!body) return;
  $('chatInput').value = '';
  stopComposeTyping({ groupId });
  await api('/api/chat/groups/' + groupId + '/messages', { method: 'POST', body: JSON.stringify({ body }) });
  await openGroupChat(groupId);
}

function wireComposeTyping(inputEl, target) {
  if (!inputEl) return;
  inputEl.addEventListener('input', () => {
    const socket = getSocket();
    if (!socket) return;
    if (!composeTypingActive) {
      composeTypingActive = true;
      socket.emit('typing:start', target);
    }
    clearTimeout(composeTypingTimer);
    composeTypingTimer = setTimeout(() => stopComposeTyping(target), 1500);
  });
}

function stopComposeTyping(target) {
  const socket = getSocket();
  clearTimeout(composeTypingTimer);
  if (composeTypingActive && socket) socket.emit('typing:stop', target);
  composeTypingActive = false;
}

function appendBubble(container, className, innerHtml) {
  const emptyState = container.querySelector('.empty');
  if (emptyState) emptyState.remove();
  const bubble = document.createElement('div');
  bubble.className = className;
  bubble.innerHTML = innerHtml;
  container.appendChild(bubble);
  container.scrollTop = container.scrollHeight;
}

function setTypingIndicator(text) {
  const el = $('typingLine');
  if (el) el.textContent = text;
}

function recomputeTypingLine() {
  const names = Array.from(typingUsers.values());
  if (!names.length) return setTypingIndicator('');
  setTypingIndicator(`${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} typing…`);
}

function wireSocketListeners() {
  if (socketWired) return;
  const socket = getSocket();
  if (!socket) return;
  socketWired = true;

  socket.on('message:new', async (m) => {
    const involvesOpenChat =
      state.chatMode === 'direct' &&
      ((m.sender_id === state.selectedChatId && m.receiver_id === state.me.id) || (m.receiver_id === state.selectedChatId && m.sender_id === state.me.id));
    if (involvesOpenChat && $('messages')) {
      appendBubble($('messages'), 'bubble' + (m.sender_id === state.me.id ? ' mine' : ''), `${esc(m.body)}<small>${new Date(m.created_at).toLocaleString('en-IN')}</small>`);
      if (m.sender_id !== state.me.id) api('/api/chat?with_id=' + m.sender_id).catch(() => {});
    }
    await updateNotifications();
  });

  socket.on('group:message:new', async (m) => {
    const involvesOpenGroup = state.chatMode === 'group' && m.group_id === state.selectedGroupId;
    if (involvesOpenGroup && $('messages')) {
      appendBubble(
        $('messages'),
        'bubble' + (m.sender_id === state.me.id ? ' mine' : ''),
        `${m.sender_id !== state.me.id ? `<div class="bubble-sender">${esc(m.sender_name)}</div>` : ''}${esc(m.body)}<small>${new Date(m.created_at).toLocaleString('en-IN')}</small>`
      );
      api('/api/chat/groups/' + m.group_id + '/messages').catch(() => {});
    } else if (state.currentPage === 'chat') {
      await refreshGroupList(state.chatMode === 'group');
    }
    await updateNotifications();
  });

  socket.on('group:created', () => {
    if (state.currentPage === 'chat') refreshGroupList(state.chatMode === 'group');
  });

  socket.on('typing', ({ fromUserId, fromName, groupId }) => {
    const key = groupId ? `group:${groupId}:${fromUserId}` : `user:${fromUserId}`;
    const relevant = groupId ? state.chatMode === 'group' && state.selectedGroupId === groupId : state.chatMode === 'direct' && state.selectedChatId === fromUserId;
    if (!relevant) return;
    typingUsers.set(key, fromName);
    clearTimeout(typingTimers.get(key));
    typingTimers.set(
      key,
      setTimeout(() => {
        typingUsers.delete(key);
        recomputeTypingLine();
      }, 3000)
    );
    recomputeTypingLine();
  });

  socket.on('typing:stop', ({ fromUserId, groupId }) => {
    const key = groupId ? `group:${groupId}:${fromUserId}` : `user:${fromUserId}`;
    typingUsers.delete(key);
    clearTimeout(typingTimers.get(key));
    recomputeTypingLine();
  });

  document.addEventListener('presence:changed', () => {
    if (state.currentPage === 'chat') {
      renderListItems();
      if (state.chatMode === 'direct' && state.selectedChatId) {
        const p = presenceLine(state.selectedChatId);
        const pill = document.querySelector('.presence-pill');
        if (pill) {
          pill.textContent = p.text;
          pill.classList.toggle('online', p.online);
        }
      }
    }
  });
}
