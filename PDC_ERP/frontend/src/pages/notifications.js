import { api } from '../lib/api.js';
import { $, esc, openModal, toast } from '../lib/dom.js';

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
  document.querySelectorAll('[data-notif-id]').forEach((el) => (el.onclick = () => markNotification(Number(el.dataset.notifId))));
  await updateNotifications();
}

async function markNotification(id) {
  await api('/api/notifications/' + id, { method: 'PUT' });
  await updateNotifications();
  await openNotifications();
}

async function markAllNotifications() {
  await api('/api/notifications/read-all', { method: 'PUT' });
  await updateNotifications();
  await openNotifications();
}
