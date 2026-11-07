import { api } from '../lib/api.js';
import { state } from '../lib/state.js';
import { $, esc, status } from '../lib/dom.js';
import { refresh } from '../router.js';
import { openTaskModal } from '../components/modals.js';

export function renderTasks() {
  const { me, boot } = state;
  const admin = me.role === 'Admin';
  $('page-tasks').innerHTML = `<div class="title"><h1>${admin ? 'Tasks & Assignments' : 'My Tasks'}</h1><p>${
    admin ? 'Assign and manage all work.' : 'Only tasks assigned to you are shown.'
  }</p></div><div class="card"><div class="sectionHead"><h3>Task Board</h3>${admin ? '<button class="btn" id="assignTaskBtn">+ Assign Task</button>' : ''}</div><div class="filters"><select id="tsFilter"><option value="">All Status</option><option>Not Started</option><option>In Progress</option><option>Blocked</option><option>Done</option></select></div><div id="taskRows"></div></div>`;
  if (admin) $('assignTaskBtn').onclick = openTaskModal;
  $('tsFilter').onchange = renderTaskRows;
  renderTaskRows();
}

function renderTaskRows() {
  const { me, boot } = state;
  const sf = $('tsFilter')?.value || '';
  const rows = boot.tasks.filter((t) => !sf || t.status === sf);
  $('taskRows').innerHTML = rows.length
    ? `<table class="table"><thead><tr><th>Task</th><th>Client</th><th>Owner</th><th>Priority</th><th>Due</th><th>Status</th><th>Action</th></tr></thead><tbody>${rows
        .map(
          (t) =>
            `<tr><td><b>${esc(t.title)}</b><div class="mini wrap">${esc(t.description)}</div></td><td>${esc(t.client_short || '—')}</td><td>${esc(
              t.assignee_name
            )}</td><td>${status(t.priority)}</td><td>${esc(t.due_date)}</td><td>${status(t.status)}</td><td><select data-task-id="${t.id}"><option ${
              t.status === 'Not Started' ? 'selected' : ''
            }>Not Started</option><option ${t.status === 'In Progress' ? 'selected' : ''}>In Progress</option><option ${
              t.status === 'Blocked' ? 'selected' : ''
            }>Blocked</option><option ${t.status === 'Done' ? 'selected' : ''}>Done</option></select></td></tr>`
        )
        .join('')}</tbody></table>`
    : '<div class="empty">No tasks found.</div>';
  $('taskRows')
    .querySelectorAll('select[data-task-id]')
    .forEach((sel) => (sel.onchange = () => updateTaskStatus(Number(sel.dataset.taskId), sel.value)));
}

async function updateTaskStatus(id, statusValue) {
  const t = state.boot.tasks.find((x) => x.id === id);
  if (!t) return;
  await api('/api/tasks/' + id, { method: 'PUT', body: JSON.stringify({ ...t, status: statusValue, assignee_id: t.assignee_id, client_id: t.client_id }) });
  await refresh();
}
