import { api } from '../lib/api.js';
import { $, esc, openModal, closeModal, toast } from '../lib/dom.js';
import { state } from '../lib/state.js';
import { renderPage } from '../router.js';
import { openChat, openGroupChat } from './chat.js';

let lastUnreadNotifications = Number(sessionStorage.getItem('pdc_last_unread') || '0');

export async function updateNotifications() {
  const n = await api('/api/notifications');
  $('chatBadge').textContent = n.unread_messages || 0;
  n.unread_messages ? $('chatBadge').classList.remove('hidden') : $('chatBadge').classList.add('hidden');
  $('notifBadge').textContent = n.unread_notifications || 0;
  n.unread_notifications ? $('notifBadge').classList.remove('hidden') : $('notifBadge').classList.add('hidden');
  if ((n.unread_notifications || 0) > lastUnreadNotifications && lastUnreadNotifications >= 0 && n.rows?.[0]) {
    toast('\u{1F514} ' + n.rows[0].title);
  }
  lastUnreadNotifications = n.unread_notifications || 0;
  sessionStorage.setItem('pdc_last_unread', String(lastUnreadNotifications));
  return n;
}

export async function openNotifications() {
  const n = await api('/api/notifications');
  const rows = n.rows || [];
  openModal(
    'Notifications',
    `<div class="sectionHead"><h3>Recent Notifications</h3><button class="btn alt" id="markAllReadBtn">Mark all read</button></div>${
      rows.length
        ? rows
            .map(
              (x) =>
                `<div class="notice ${x.read_at ? '' : 'warn'}" style="cursor:pointer" data-notif-id="${x.id}"><b>${esc(x.title)}</b><div style="margin-top:4px">${esc(
                  x.body
                )}</div><div class="mini" style="margin-top:4px">${new Date(x.created_at).toLocaleString('en-IN')}</div></div>`
            )
            .join('')
        : '<div class="empty">No notifications.</div>'
    }`
  );
  $('markAllReadBtn').onclick = markAllNotifications;
  document.querySelectorAll('[data-notif-id]').forEach((el) => {
    const n = rows.find((x) => x.id === Number(el.dataset.notifId));
    el.onclick = () => handleNotificationClick(n);
  });
  await updateNotifications();
}

async function handleNotificationClick(n) {
  if (!n) return;
  await api('/api/notifications/' + n.id, { method: 'PUT' });
  // A message notification takes you straight to that conversation instead of just
  // marking itself read and reopening the same notifications list.
  if (n.type === 'chat_message' && n.entity_type === 'user' && n.entity_id) {
    closeModal();
    state.chatMode = 'direct';
    await renderPage('chat');
    await openChat(n.entity_id);
  } else if (n.type === 'group_message' && n.entity_type === 'chat_group' && n.entity_id) {
    closeModal();
    state.chatMode = 'group';
    await renderPage('chat');
    await openGroupChat(n.entity_id);
  } else {
    await updateNotifications();
    await openNotifications();
  }
}

async function markAllNotifications() {
  await api('/api/notifications/read-all', { method: 'PUT' });
  await updateNotifications();
  await openNotifications();
}
