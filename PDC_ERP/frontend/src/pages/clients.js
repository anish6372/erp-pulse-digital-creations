import { state } from '../lib/state.js';
import { $, esc, status } from '../lib/dom.js';
import { openClientModal, removeClient } from '../components/modals.js';

export function renderClients() {
  if (state.me.role !== 'Admin') return;
  const { boot } = state;
  $('page-clients').innerHTML = `<div class="title"><h1>Clients</h1><p>Editable client master for tasks and work reports.</p></div><div class="card"><div class="sectionHead"><h3>Client List</h3><button class="btn" id="addClientBtn">+ Add Client</button></div><table class="table"><thead><tr><th>Name</th><th>Short Name</th><th>Business Type</th><th>Contact</th><th>Status</th><th></th></tr></thead><tbody>${boot.clients
    .map(
      (c) =>
        `<tr><td>${esc(c.name)}</td><td>${esc(c.short_name)}</td><td>${esc(c.business_type || '—')}</td><td>${esc(c.contact_person || c.phone || c.email || '—')}</td><td>${status(
          c.active ? 'Active' : 'Inactive'
        )}</td><td class="pnl"><button class="btn alt" data-edit-client="${c.id}">Edit</button><button class="btn danger" data-remove-client="${c.id}">Remove</button></td></tr>`
    )
    .join('')}</tbody></table></div>`;
  $('addClientBtn').onclick = () => openClientModal();
  $('page-clients')
    .querySelectorAll('[data-edit-client]')
    .forEach((b) => (b.onclick = () => openClientModal(Number(b.dataset.editClient))));
  $('page-clients')
    .querySelectorAll('[data-remove-client]')
    .forEach((b) => (b.onclick = () => removeClient(Number(b.dataset.removeClient))));
}
