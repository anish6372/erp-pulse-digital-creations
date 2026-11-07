import { state } from '../lib/state.js';
import { $, esc, status } from '../lib/dom.js';
import { openClientModal } from '../components/modals.js';

export function renderClients() {
  if (state.me.role !== 'Admin') return;
  const { boot } = state;
  $('page-clients').innerHTML = `<div class="title"><h1>Clients</h1><p>Editable client master for tasks and work reports.</p></div><div class="card"><div class="sectionHead"><h3>Client List</h3><button class="btn" id="addClientBtn">+ Add Client</button></div><table class="table"><thead><tr><th>Name</th><th>Short Name</th><th>Status</th></tr></thead><tbody>${boot.clients
    .map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.short_name)}</td><td>${status(c.active ? 'Active' : 'Inactive')}</td></tr>`)
    .join('')}</tbody></table></div>`;
  $('addClientBtn').onclick = openClientModal;
}
