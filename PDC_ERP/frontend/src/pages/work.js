import { state } from '../lib/state.js';
import { $, esc } from '../lib/dom.js';
import { openReportModal } from '../components/modals.js';

export function renderWork() {
  const { me, boot } = state;
  const admin = me.role === 'Admin';
  const rows = boot.reports;
  $('page-work').innerHTML = `<div class="title"><h1>${admin ? 'Daily Work Reports' : 'Submit Work'}</h1><p>${
    admin ? 'All employee work submissions and evidence.' : 'Submit your completed work with Drive links or attachments.'
  }</p></div><div class="card"><div class="sectionHead"><h3>${admin ? 'Work History' : 'My Work Submissions'}</h3>${
    !admin ? '<button class="btn" id="submitWorkBtn2">+ Submit Work</button>' : ''
  }</div>${
    rows.length
      ? `<table class="table"><thead><tr><th>Date</th><th>Employee</th><th>Client</th><th>Task</th><th>Hours</th><th>Work</th><th>Links</th></tr></thead><tbody>${rows
          .map(
            (r) =>
              `<tr><td>${esc(r.work_date)}</td><td>${esc(r.user_name || me.name)}</td><td>${esc(r.client_short || '—')}</td><td>${esc(r.task_title || '—')}</td><td>${
                r.hours
              }</td><td class="wrap">${esc(r.work_text)}</td><td>${r.work_drive_link ? `<a href="${esc(r.work_drive_link)}" target="_blank">Work Drive</a>` : ''} ${
                r.poster_drive_link ? `<a href="${esc(r.poster_drive_link)}" target="_blank">Poster</a>` : ''
              } ${r.attachment_path ? `<a href="${esc(r.attachment_path)}" target="_blank">Attachment</a>` : ''}</td></tr>`
          )
          .join('')}</tbody></table>`
      : '<div class="empty">No work submitted yet.</div>'
  }</div>`;
  if (!admin) $('submitWorkBtn2').onclick = openReportModal;
}
