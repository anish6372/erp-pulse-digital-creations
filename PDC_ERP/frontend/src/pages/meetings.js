import { api } from '../lib/api.js';
import { state } from '../lib/state.js';
import { $, esc, toast } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { openMeetingModal } from '../components/modals.js';

export async function renderMeetings() {
  const admin = state.me.role === 'Admin';
  $('page-meetings').innerHTML = `<div class="title"><h1>Meetings</h1><p>${
    admin ? 'Schedule meetings and share a join link with the whole team.' : 'Upcoming and past company meetings.'
  }</p></div><div class="card"><div class="sectionHead"><div><h3>Scheduled Meetings</h3><div class="mini" id="meetingCount"></div></div>${
    admin ? '<button class="btn" id="scheduleMeetingBtn">' + icon('plus') + '<span>Schedule Meeting</span></button>' : ''
  }</div><div id="meetingsBody"></div></div>`;
  if (admin) $('scheduleMeetingBtn').onclick = () => openMeetingModal();
  await loadMeetings();
}

async function loadMeetings() {
  const admin = state.me.role === 'Admin';
  let data;
  try {
    data = await api('/api/meetings');
  } catch (e) {
    $('meetingsBody').innerHTML = `<div class="empty">Could not load meetings: ${esc(e.message)}</div>`;
    return;
  }
  const rows = data.meetings || [];
  const nowTs = Date.now();
  const upcoming = rows.filter((m) => new Date(m.scheduled_at).getTime() >= nowTs).sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
  const past = rows.filter((m) => new Date(m.scheduled_at).getTime() < nowTs).sort((a, b) => new Date(b.scheduled_at) - new Date(a.scheduled_at));
  $('meetingCount').textContent = `${upcoming.length} upcoming`;

  const card = (m, isPast) => `<div class="meeting-card ${isPast ? 'past' : ''}">
    <div class="meeting-main">
      <div class="meeting-icon">${icon('meetings')}</div>
      <div>
        <b>${esc(m.title)}</b>
        <div class="mini">${esc(m.description || 'No description')}</div>
        <div class="mini">Hosted by ${esc(m.host_name)} &bull; ${new Date(m.scheduled_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} &bull; ${m.duration_minutes} min</div>
      </div>
    </div>
    <div class="pnl">
      ${!isPast ? `<a class="btn success" href="${esc(m.meeting_link)}" target="_blank" rel="noopener">${icon('link')}<span>Join</span></a>` : `<span class="badge gray">Ended</span>`}
      ${admin ? `<button class="btn alt" data-edit-meeting="${m.id}">Edit</button><button class="btn danger" data-cancel-meeting="${m.id}">Cancel</button>` : ''}
    </div>
  </div>`;

  $('meetingsBody').innerHTML = `
    <div class="sectionHead" style="margin-top:4px"><h3 style="font-size:13px">Upcoming</h3></div>
    ${upcoming.length ? upcoming.map((m) => card(m, false)).join('') : '<div class="empty">No upcoming meetings.</div>'}
    <div class="sectionHead" style="margin-top:14px"><h3 style="font-size:13px">Past</h3></div>
    ${past.length ? past.slice(0, 10).map((m) => card(m, true)).join('') : '<div class="empty">No past meetings yet.</div>'}
  `;

  if (admin) {
    $('meetingsBody')
      .querySelectorAll('[data-edit-meeting]')
      .forEach((b) => (b.onclick = () => openMeetingModal(Number(b.dataset.editMeeting), rows.find((x) => x.id === Number(b.dataset.editMeeting)))));
    $('meetingsBody')
      .querySelectorAll('[data-cancel-meeting]')
      .forEach((b) => (b.onclick = () => cancelMeeting(Number(b.dataset.cancelMeeting))));
  }
}

async function cancelMeeting(id) {
  if (!confirm('Cancel this meeting? Everyone will be notified.')) return;
  try {
    await api('/api/meetings/' + id, { method: 'PUT', body: JSON.stringify({ status: 'Cancelled' }) });
    toast('Meeting cancelled');
    await loadMeetings();
  } catch (e) {
    toast(e.message || 'Could not cancel meeting');
  }
}

export { loadMeetings };
