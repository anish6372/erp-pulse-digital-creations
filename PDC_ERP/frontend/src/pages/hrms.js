import { state } from '../lib/state.js';
import { $, esc, status } from '../lib/dom.js';
import { openUserModal } from '../components/modals.js';

export function renderHRMS() {
  if (state.me.role !== 'Admin') return;
  const { boot } = state;
  $('page-hrms').innerHTML = `<div class="title"><h1>HRMS</h1><p>Every employee master record is editable by Admin.</p></div><div class="card"><div class="sectionHead"><h3>Employee Master</h3><button class="btn" id="addEmployeeBtn">+ Add Employee</button></div><div class="tableWrap"><table class="table"><thead><tr><th>Name</th><th>Employee ID</th><th>Department</th><th>Designation</th><th>Joining</th><th>Salary</th><th>Targets</th><th>Status</th><th>Edit</th></tr></thead><tbody>${boot.users
    .map(
      (u) =>
        `<tr><td>${esc(u.name)}</td><td>${esc(u.employee_code)}</td><td>${esc(u.department)}</td><td>${esc(u.designation)}</td><td>${esc(u.joining_date)}</td><td>₹${Number(
          u.monthly_salary || 0
        ).toLocaleString('en-IN')}</td><td>${u.monthly_target_tasks} tasks / ${u.monthly_target_hours}h</td><td>${status(u.active ? 'Active' : 'Inactive')}</td><td><button class="btn alt" data-edit-user="${
          u.id
        }">Edit</button></td></tr>`
    )
    .join('')}</tbody></table></div></div>`;
  $('addEmployeeBtn').onclick = () => openUserModal();
  $('page-hrms')
    .querySelectorAll('[data-edit-user]')
    .forEach((b) => (b.onclick = () => openUserModal(Number(b.dataset.editUser))));
}
