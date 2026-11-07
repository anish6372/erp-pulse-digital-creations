import { state } from '../lib/state.js';
import { $, esc, initials, status } from '../lib/dom.js';
import { openUserModal } from '../components/modals.js';

export function renderTeam() {
  if (state.me.role !== 'Admin') return;
  const { boot } = state;
  $('page-team').innerHTML = `<div class="title"><h1>Team</h1><p>Roles, status and live workload.</p></div><div class="grid g3">${boot.users
    .map(
      (u) =>
        `<div class="card"><div class="row"><div class="avatar">${initials(u.name)}</div><div><b>${esc(u.name)}</b><div class="mini">${esc(u.designation || u.role)} • ${esc(
          u.department
        )}</div></div></div><div class="statline"><span>Status</span>${status(u.active ? 'Active' : 'Inactive')}</div><div class="statline"><span>Salary</span><b>₹${Number(
          u.monthly_salary || 0
        ).toLocaleString('en-IN')}</b></div><div class="statline"><span>Targets</span><span>${u.monthly_target_tasks} tasks / ${
          u.monthly_target_hours
        }h</span></div><button class="btn alt" style="margin-top:10px" data-edit-member="${u.id}">Edit Member</button></div>`
    )
    .join('')}</div>`;
  $('page-team')
    .querySelectorAll('[data-edit-member]')
    .forEach((b) => (b.onclick = () => openUserModal(Number(b.dataset.editMember))));
}
