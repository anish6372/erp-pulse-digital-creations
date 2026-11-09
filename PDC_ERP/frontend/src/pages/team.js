import { api } from '../lib/api.js';
import { state } from '../lib/state.js';
import { $, esc, initials, status, toast, confirmDialog } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { openUserModal } from '../components/modals.js';
import { refresh } from '../router.js';

export function renderTeam() {
  if (state.me.role !== 'Admin') return;
  const { boot } = state;
  $('page-team').innerHTML = `<div class="title"><h1>Team</h1><p>Roles, status and live workload.</p></div>
  <div class="sectionHead"><div></div><button class="btn" id="addMemberBtn">${icon('plus')}<span>Add Member</span></button></div>
  <div class="grid g3">${boot.users
    .map(
      (u) =>
        `<div class="card"><div class="row"><div class="avatar">${initials(u.name)}</div><div><b>${esc(u.name)}</b><div class="mini">${esc(u.designation || u.role)} • ${esc(
          u.department
        )}</div></div></div><div class="statline"><span>Status</span>${status(u.active ? 'Active' : 'Inactive')}</div><div class="statline"><span>Salary</span><b>₹${Number(
          u.monthly_salary || 0
        ).toLocaleString('en-IN')}</b></div><div class="statline"><span>Targets</span><span>${u.monthly_target_tasks} tasks / ${
          u.monthly_target_hours
        }h</span></div><div class="row" style="margin-top:10px;gap:8px"><button class="btn alt" style="flex:1" data-edit-member="${u.id}">Edit Member</button>${
          u.id !== state.me.id ? `<button class="btn danger" data-remove-member="${u.id}" title="Deactivate this employee">${icon('trash')}</button>` : ''
        }</div></div>`
    )
    .join('')}</div>`;
  $('addMemberBtn').onclick = () => openUserModal();
  $('page-team')
    .querySelectorAll('[data-edit-member]')
    .forEach((b) => (b.onclick = () => openUserModal(Number(b.dataset.editMember))));
  $('page-team')
    .querySelectorAll('[data-remove-member]')
    .forEach((b) => (b.onclick = () => removeMember(Number(b.dataset.removeMember))));
}

async function removeMember(id) {
  const u = state.boot.users.find((x) => x.id === id);
  const ok = await confirmDialog(
    `Remove ${u?.name || 'this employee'} from the active team?\n\nThis deactivates their account - their task, payroll and attendance history is kept, not deleted. You can reactivate them later by editing their record.`,
    { title: 'Remove Employee', confirmText: 'Remove' }
  );
  if (!ok) return;
  try {
    await api('/api/users/' + id, { method: 'DELETE' });
    toast('Employee deactivated');
    await refresh();
  } catch (e) {
    toast(e.message || 'Could not remove employee');
  }
}
