import { api } from '../lib/api.js';
import { state } from '../lib/state.js';
import { $, esc, status, externalUrl } from '../lib/dom.js';
import { icon } from '../lib/icons.js';

let cache = [];

export async function renderDeliverables() {
  const admin = state.me.role === 'Admin';
  $('page-deliverables').innerHTML = `<div class="title"><h1>Deliverables</h1><p>${
    admin ? 'Every completed task, with the Drive links and attachments submitted for it.' : 'Your completed tasks and the links you submitted for each.'
  }</p></div>
  <div class="card">
    <div class="sectionHead"><div><h3>Completed Work</h3><div class="mini" id="deliverablesCount"></div></div></div>
    <div class="filters">
      <input id="deliverablesSearch" placeholder="Search by task, client${admin ? ' or employee' : ''}..." style="min-width:260px" />
    </div>
    <div id="deliverablesBody"></div>
  </div>`;
  $('deliverablesSearch').addEventListener('input', renderList);
  await loadDeliverables();
}

async function loadDeliverables() {
  try {
    const d = await api('/api/deliverables');
    cache = d.tasks || [];
  } catch (e) {
    cache = [];
    $('deliverablesBody').innerHTML = `<div class="empty">Could not load deliverables: ${esc(e.message)}</div>`;
    return;
  }
  renderList();
}

function linkChip(href, label) {
  return `<a class="btn alt" href="${esc(href)}" target="_blank" rel="noopener">${icon('link')}<span>${esc(label)}</span></a>`;
}

function renderList() {
  const admin = state.me.role === 'Admin';
  const q = ($('deliverablesSearch')?.value || '').trim().toLowerCase();
  const rows = q
    ? cache.filter((t) => [t.title, t.client_name, t.client_short, t.assignee_name].filter(Boolean).some((s) => s.toLowerCase().includes(q)))
    : cache;

  $('deliverablesCount').textContent = `${rows.length} completed task${rows.length === 1 ? '' : 's'}`;

  $('deliverablesBody').innerHTML = rows.length
    ? rows
        .map(
          (t) => `<div class="card" style="margin-bottom:12px;background:#f8f9fb">
        <div class="sectionHead">
          <div>
            <h3 style="font-size:14px">${esc(t.title)}</h3>
            <div class="mini">${esc(t.client_short || t.client_name || 'Internal')}${admin ? ' &bull; ' + esc(t.assignee_name) : ''} &bull; completed ${esc(
            t.completed_at || t.due_date
          )}</div>
          </div>
          ${status('Done')}
        </div>
        ${
          t.reports.length
            ? t.reports
                .map(
                  (r) => `<div class="statline" style="flex-direction:column;align-items:flex-start;gap:7px;padding:10px 0">
              <div class="mini wrap">${esc(r.work_text)} &bull; ${r.hours}h &bull; ${esc(r.work_date)}</div>
              <div class="pnl">
                ${r.work_drive_link ? linkChip(externalUrl(r.work_drive_link), 'Work Drive') : ''}
                ${r.poster_drive_link ? linkChip(externalUrl(r.poster_drive_link), 'Poster') : ''}
                ${r.attachment_path ? linkChip(r.attachment_path, r.attachment_name || 'Attachment') : ''}
                ${!r.work_drive_link && !r.poster_drive_link && !r.attachment_path ? '<span class="mini">No links attached to this submission.</span>' : ''}
              </div>
            </div>`
                )
                .join('')
            : '<div class="empty">No work report was submitted against this task.</div>'
        }
      </div>`
        )
        .join('')
    : `<div class="empty">${q ? 'No completed tasks match your search.' : 'No completed tasks yet.'}</div>`;
}
