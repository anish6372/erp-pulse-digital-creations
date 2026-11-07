import { api } from '../lib/api.js';
import { state } from '../lib/state.js';
import { $, esc, status, toast } from '../lib/dom.js';
import { refresh, renderPage } from '../router.js';
import { openLeaveModal } from '../components/modals.js';

export function renderLeaves() {
  const { me, boot } = state;
  const rows = boot.leaves;
  const admin = me.role === 'Admin';
  $('page-leaves').innerHTML = `<div class="title"><h1>${admin ? 'Leave & Half-Day Requests' : 'My Leave Requests'}</h1><p>${
    admin ? 'Approve/reject requests from one management panel.' : 'Submit and track your requests.'
  }</p></div><div class="card"><div class="sectionHead"><h3>${admin ? 'Notifications & History' : 'My Requests'}</h3>${
    !admin ? '<button class="btn" id="requestLeaveBtn2">+ Request Leave</button>' : ''
  }</div>${
    rows.length
      ? `<table class="table"><thead><tr><th>Date</th><th>Employee</th><th>Type</th><th>Reason</th><th>Status</th>${
          admin ? '<th>Action</th>' : ''
        }</tr></thead><tbody>${rows
          .map(
            (l) =>
              `<tr><td>${esc(l.leave_date)}</td><td>${esc(l.user_name || me.name)}</td><td>${esc(l.leave_type)}</td><td class="wrap">${esc(l.reason)}</td><td>${status(
                l.status
              )}</td>${
                admin
                  ? `<td>${
                      l.status === 'Pending'
                        ? `<button class="btn success" data-approve="${l.id}">Approve</button> <button class="btn danger" data-reject="${l.id}">Reject</button>`
                        : '—'
                    }</td>`
                  : ''
              }</tr>`
          )
          .join('')}</tbody></table>`
      : '<div class="empty">No leave requests.</div>'
  }</div>`;
  if (!admin) $('requestLeaveBtn2').onclick = openLeaveModal;
  $('page-leaves')
    .querySelectorAll('[data-approve]')
    .forEach((b) => (b.onclick = () => reviewLeave(Number(b.dataset.approve), 'Approved')));
  $('page-leaves')
    .querySelectorAll('[data-reject]')
    .forEach((b) => (b.onclick = () => reviewLeave(Number(b.dataset.reject), 'Rejected')));
}

async function reviewLeave(id, s) {
  await api('/api/leaves/' + id, { method: 'PUT', body: JSON.stringify({ status: s }) });
  toast('Leave ' + s.toLowerCase());
  await refresh();
  renderPage('leaves');
}
