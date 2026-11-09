import { state } from '../lib/state.js';
import { $, esc, status } from '../lib/dom.js';
import { openClientModal, removeClient } from '../components/modals.js';

let showInactive = false;

export function renderClients() {
  if (state.me.role !== 'Admin') return;
  const { boot } = state;
  const inactiveCount = boot.clients.filter((c) => !c.active).length;
  const rows = boot.clients.filter((c) => c.active || showInactive);
  $('page-clients').innerHTML = `<div class="title"><h1>Clients</h1><p>Editable client master for tasks and work reports.</p></div><div class="card"><div class="sectionHead"><h3>Client List</h3><div class="pnl">${
    inactiveCount ? `<button class="btn alt" id="toggleInactiveClientsBtn">${showInactive ? 'Hide' : 'Show'} ${inactiveCount} removed</button>` : ''
  }<button class="btn" id="addClientBtn">+ Add Client</button></div></div><table class="table"><thead><tr><th>Name</th><th>Short Name</th><th>Business Type</th><th>Contact</th><th>Status</th><th></th></tr></thead><tbody>${rows
    .map(
      (c) =>
        `<tr><td>${esc(c.name)}</td><td>${esc(c.short_name)}</td><td>${esc(c.business_type || '—')}</td><td>${esc(c.contact_person || c.phone || c.email || '—')}</td><td>${status(
          c.active ? 'Active' : 'Inactive'
        )}</td><td class="pnl"><button class="btn alt" data-edit-client="${c.id}">Edit</button><button class="btn danger" data-remove-client="${c.id}">Remove</button></td></tr>`
    )
    .join('')}</tbody></table></div>`;
  $('addClientBtn').onclick = () => openClientModal();
  if ($('toggleInactiveClientsBtn'))
    $('toggleInactiveClientsBtn').onclick = () => {
      showInactive = !showInactive;
      renderClients();
    };
  $('page-clients')
    .querySelectorAll('[data-edit-client]')
    .forEach((b) => (b.onclick = () => openClientModal(Number(b.dataset.editClient))));
  $('page-clients')
    .querySelectorAll('[data-remove-client]')
    .forEach((b) => (b.onclick = () => removeClient(Number(b.dataset.removeClient))));
}
