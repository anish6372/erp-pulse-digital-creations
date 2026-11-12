// Compliance (Admin only): a do-not-contact list, DPDP/GDPR-style data subject requests
// (access / erasure) against our own leads and candidates, and an activity trail - the
// guardrails for the Prospect Analyzer / Leads outreach work.
import { api } from '../lib/api.js';
import { state } from '../lib/state.js';
import { $, esc, toast, confirmDialog } from '../lib/dom.js';
import { icon } from '../lib/icons.js';

const RULES = [
  'A person reviews and sends every first outreach message - nothing goes out automatically.',
  'The do-not-contact list is checked before a lead or prospect is contacted.',
  'An access or erasure request is fulfilled the same day it is logged here.',
  'Erasure removes a contact\'s name, phone and email from leads/candidates, but keeps the business record and a do-not-contact entry so they are never reached again.',
  'Every add, delete, access and erasure action here is written to the activity log below.',
];

let dnc = [];
let requests = [];
let activity = [];
let lastResult = null;

export async function renderCompliance() {
  if (state.me.role !== 'Admin') return;
  await loadAll();
  paint();
}

async function loadAll() {
  try {
    const [d, r, a] = await Promise.all([api('/api/compliance/dnc'), api('/api/compliance/data-requests'), api('/api/compliance/activity')]);
    dnc = d.rows || [];
    requests = r.rows || [];
    activity = a.rows || [];
  } catch (e) {
    dnc = [];
    requests = [];
    activity = [];
  }
}

function paint() {
  $('page-compliance').innerHTML = `<div class="title"><h1>Compliance</h1><p>Do-not-contact list, data subject requests (DPDP Act / GDPR style), and a record of who did what.</p></div>
  <div class="grid g2" style="align-items:start">
    <div>
      <div class="card" style="margin-bottom:14px">
        <h3 style="margin-bottom:10px">Data Request</h3>
        <form id="drForm" class="row" style="gap:8px;flex-wrap:wrap">
          <select id="drKind"><option value="access">Access - show what we hold</option><option value="delete">Erasure - delete and never contact</option></select>
          <input id="drValue" placeholder="Email or phone" required style="flex:1;min-width:200px">
          <button class="btn">${icon('search')}<span>Run</span></button>
        </form>
        <div id="drOut" style="margin-top:12px">${lastResult ? resultHtml(lastResult) : ''}</div>
        ${requests.length ? `<div class="mini" style="margin-top:12px">Recent requests</div><div class="scroll-x" style="margin-top:4px">${requestsTable()}</div>` : ''}
      </div>
      <div class="card">
        <h3 style="margin-bottom:10px">Do-Not-Contact List</h3>
        <form id="dncForm" class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:10px">
          <select id="dncType"><option value="email">email</option><option value="phone">phone</option><option value="domain">domain</option><option value="instagram">instagram</option></select>
          <input id="dncValue" placeholder="Value" required style="flex:1;min-width:150px">
          <input id="dncReason" placeholder="Reason (optional)" style="flex:1;min-width:150px">
          <button class="btn">${icon('plus')}<span>Add</span></button>
        </form>
        ${dncTable()}
      </div>
    </div>
    <div>
      <div class="card" style="margin-bottom:14px">
        <h3 style="margin-bottom:8px">Built-in Rules</h3>
        <ul style="margin:0;padding-left:18px">${RULES.map((r) => `<li class="mini" style="margin-bottom:6px;color:var(--ink)">${esc(r)}</li>`).join('')}</ul>
      </div>
      <div class="card">
        <h3 style="margin-bottom:8px">Activity</h3>
        ${activity.length ? activity.slice(0, 20).map((x) => activityRow(x)).join('') : '<div class="empty">Nothing logged yet.</div>'}
      </div>
    </div>
  </div>`;

  $('drForm').addEventListener('submit', submitDataRequest);
  $('dncForm').addEventListener('submit', submitDnc);
  wireDncDeletes();
}

function activityRow(x) {
  const verb = { CREATE: 'added', DELETE: 'removed', ACCESS: 'ran an access request for', UPDATE: 'updated' }[x.action] || x.action.toLowerCase();
  return `<div class="statline" style="display:block;padding:7px 0;border-bottom:1px solid var(--line)"><div class="mini">${new Date(x.created_at).toLocaleString('en-IN')} &middot; ${esc(x.actor || 'System')}</div><div>${verb} ${esc(x.entity_type.replace('_', ' '))}${x.meta ? ' - ' + esc(x.meta) : ''}</div></div>`;
}

function dncTable() {
  if (!dnc.length) return '<div class="empty">Nobody is on the list yet.</div>';
  return `<div class="tableWrap"><table class="table"><thead><tr><th>Value</th><th>Type</th><th>Reason</th><th>Added</th><th></th></tr></thead><tbody>${dnc
    .map(
      (d) =>
        `<tr><td>${esc(d.value)}</td><td class="mini">${esc(d.type)}</td><td class="mini">${esc(d.reason || '-')}</td><td class="mini">${new Date(d.created_at).toLocaleDateString('en-IN')}${
          d.added_by_name ? ' by ' + esc(d.added_by_name) : ''
        }</td><td><button class="btn danger" style="padding:3px 9px;font-size:11px" data-del-dnc="${d.id}">${icon('trash')}</button></td></tr>`
    )
    .join('')}</tbody></table></div>`;
}

function requestsTable() {
  return `<div class="tableWrap"><table class="table"><thead><tr><th>Kind</th><th>Contact</th><th>When</th></tr></thead><tbody>${requests
    .slice(0, 8)
    .map((r) => `<tr><td class="mini">${esc(r.kind)}</td><td class="mini">${esc(r.contact_value)}</td><td class="mini">${new Date(r.created_at).toLocaleDateString('en-IN')}</td></tr>`)
    .join('')}</tbody></table></div>`;
}

function resultHtml(r) {
  const leads = r.result?.leads || [];
  const candidates = r.result?.candidates || [];
  const rowsOf = (arr, labelField) =>
    arr.length
      ? arr
          .map((x) => `<div class="statline"><span>${esc(x[labelField] || '-')}</span><span class="mini">${esc(x.phone || '')} ${esc(x.email || '')}</span></div>`)
          .join('')
      : '<div class="mini">None found.</div>';
  return `<div class="notice ${r.kind === 'delete' ? 'warn' : 'ok'}">
    <b>${r.kind === 'delete' ? 'Erasure' : 'Access'} request for ${esc(r.contact_value)}</b>${
    r.kind === 'delete' ? ' - personal fields removed, added to the do-not-contact list.' : ''
  }
    <div style="margin-top:8px"><div class="mini" style="text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Leads</div>${rowsOf(leads, 'business_name')}</div>
    <div style="margin-top:8px"><div class="mini" style="text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Candidates</div>${rowsOf(candidates, 'name')}</div>
  </div>`;
}

async function submitDataRequest(e) {
  e.preventDefault();
  const kind = $('drKind').value;
  const contact_value = $('drValue').value.trim();
  if (!contact_value) return;
  if (kind === 'delete') {
    const ok = await confirmDialog(`Erase all personal data for "${contact_value}"? Their name, phone and email will be removed from leads/candidates and they will be added to the do-not-contact list. This cannot be undone.`, {
      title: 'Erase Personal Data',
      confirmText: 'Erase',
      danger: true,
    });
    if (!ok) return;
  }
  try {
    const r = await api('/api/compliance/data-requests', { method: 'POST', body: JSON.stringify({ kind, contact_value }) });
    lastResult = r;
    toast(kind === 'delete' ? 'Erased and added to the do-not-contact list' : 'Access request completed');
    await loadAll();
    paint();
  } catch (err) {
    toast(err.message || 'Could not run that request');
  }
}

async function submitDnc(e) {
  e.preventDefault();
  const type = $('dncType').value;
  const value = $('dncValue').value.trim();
  const reason = $('dncReason').value.trim();
  if (!value) return;
  try {
    await api('/api/compliance/dnc', { method: 'POST', body: JSON.stringify({ type, value, reason }) });
    toast('Added to the do-not-contact list');
    await loadAll();
    paint();
  } catch (err) {
    toast(err.message || 'Could not add that entry');
  }
}

function wireDncDeletes() {
  $('page-compliance')
    .querySelectorAll('[data-del-dnc]')
    .forEach((b) => {
      b.onclick = async () => {
        const id = Number(b.dataset.delDnc);
        const row = dnc.find((d) => d.id === id);
        const ok = await confirmDialog(`Remove ${row?.value || 'this entry'} from the do-not-contact list?`, { title: 'Remove Entry', confirmText: 'Remove' });
        if (!ok) return;
        try {
          await api('/api/compliance/dnc/' + id, { method: 'DELETE' });
          toast('Removed');
          await loadAll();
          paint();
        } catch (err) {
          toast(err.message || 'Could not remove that entry');
        }
      };
    });
}
