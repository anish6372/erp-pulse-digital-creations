import { api } from '../lib/api.js';
import { state } from '../lib/state.js';
import { $, esc, dateNow, status, kpi, toast, openModal, closeModal } from '../lib/dom.js';
import { refresh } from '../router.js';

// Against a standard 8-hour workday: full day met, falling short, or well short.
function dayHoursBadge(h) {
  const cls = h >= 8 ? 'green' : h >= 6 ? 'yellow' : h > 0 ? 'red' : 'gray';
  return `<span class="badge ${cls}">${h.toFixed(1)}h</span>`;
}

export async function renderAttendance() {
  const { me } = state;
  const m = dateNow().slice(0, 7);
  const [d, w] = await Promise.all([api('/api/attendance?month=' + m), api('/api/work/time?month=' + m)]);
  // /api/work/time already existed and was fully built (it even aggregates correctly for
  // either one employee or the whole team), but no page ever actually called it - the real
  // hours worked were tracked and computed, just never shown anywhere.
  const hoursByUser = {};
  (w.data || []).forEach((r) => (hoursByUser[r.user_id] = r.h));
  let cards = '';
  for (const x of d.data) {
    const target = state.boot.users.find((u) => u.id === x.user_id)?.monthly_target_hours || 0;
    const logged = hoursByUser[x.user_id] || 0;
    const pct = target ? Math.round((logged / target) * 100) : 0;
    const days =
      x.rows
        .map(
          (r) =>
            `<tr><td>${esc(r.date)}</td><td>${
              me.role === 'Admin'
                ? `<select data-attendance-id="${r.id}"><option ${r.status === 'Present' ? 'selected' : ''}>Present</option><option ${
                    r.status === 'Absent' ? 'selected' : ''
                  }>Absent</option><option ${r.status === 'Late / Half Day' ? 'selected' : ''}>Late / Half Day</option><option ${
                    r.status === 'Half Day' ? 'selected' : ''
                  }>Half Day</option><option ${r.status === 'Leave' ? 'selected' : ''}>Leave</option></select>`
                : status(r.status)
            }</td><td>${esc(r.first_login || '—')}</td><td>${dayHoursBadge(r.hours_logged || 0)}</td><td>${
              r.login_count
                ? `<button class="btn alt" style="padding:3px 9px;font-size:11px" data-day-sessions="${x.user_id}|${r.date}">${r.login_count}&times;</button>`
                : '<span class="mini">—</span>'
            }</td>${me.role === 'Admin' ? '<td class="mini">editable</td>' : ''}</tr>`
        )
        .join('') || '<tr><td colspan="6" class="empty">No records.</td></tr>';
    cards += `<div class="card" style="margin-bottom:12px"><div class="sectionHead"><div><h3>${esc(x.name)} <span class="mini">${esc(
      x.employee_code
    )}</span></h3></div><div class="pnl">${
      me.role === 'Admin' ? `<button class="btn alt" data-add-record="${x.user_id}">+ Add Record</button>` : ''
    }${status('Present')} <span class="mini">${x.summary.present} present • ${x.summary.absent} absent • ${x.summary.half_day} half • ${
      x.summary.full_leave + x.summary.half_leave
    } leave</span></div></div><div class="grid g5">${kpi('Working Days', x.summary.working_days)}${kpi('Present', x.summary.present)}${kpi('Absent', x.summary.absent)}${kpi(
      'Leave',
      x.summary.full_leave
    )}${kpi('Half Day', x.summary.half_day)}${kpi('Attendance %', x.summary.attendance_pct + '%')}${kpi(
      'Hours Logged',
      logged.toFixed(1) + 'h',
      target ? `${pct}% of ${target}h target` : 'no target set'
    )}</div><div class="tableWrap" style="margin-top:10px"><table class="table"><thead><tr><th>Date</th><th>Status</th><th>First Login</th><th>Hours Worked</th><th>Logins</th>${
      me.role === 'Admin' ? '<th>Edit</th>' : ''
    }</tr></thead><tbody>${days}</tbody></table></div></div>`;
  }
  $('page-attendance').innerHTML = `<div class="title"><h1>${
    me.role === 'Admin' ? 'Attendance Management' : 'My Attendance'
  }</h1><p>Attendance is marked once per day on first login. Hours Worked is the actual login-to-logout time that day, against an 8-hour day.</p></div>${cards}`;
  $('page-attendance')
    .querySelectorAll('select[data-attendance-id]')
    .forEach((sel) => (sel.onchange = () => editAttendance(Number(sel.dataset.attendanceId), sel.value)));
  $('page-attendance')
    .querySelectorAll('[data-day-sessions]')
    .forEach((b) => {
      const [userId, date] = b.dataset.daySessions.split('|');
      b.onclick = () => showDaySessions(Number(userId), date);
    });
  $('page-attendance')
    .querySelectorAll('[data-add-record]')
    .forEach((b) => (b.onclick = () => openAddRecordModal(Number(b.dataset.addRecord), m)));
}

// Backfills a day that has no record at all - a row only ever gets created automatically
// on that person's first login, so any day they never logged in (joined mid-month, before
// this feature existed, etc.) has nothing to edit until added directly.
function openAddRecordModal(userId, month) {
  const user = state.boot.users.find((u) => u.id === userId);
  openModal(
    `Add attendance record${user ? ' — ' + user.name : ''}`,
    `<form id="addAttForm"><div class="fgrid">
      <div class="field"><label>Date</label><input id="aa1" type="date" min="${month}-01" max="${dateNow()}" value="${month}-01" required></div>
      <div class="field"><label>Status</label><select id="aa2"><option>Present</option><option>Absent</option><option>Late / Half Day</option><option>Half Day</option><option>Leave</option></select></div>
    </div><button class="btn" style="margin-top:10px">Add</button></form>`
  );
  $('addAttForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/api/attendance', { method: 'POST', body: JSON.stringify({ user_id: userId, date: $('aa1').value, status: $('aa2').value }) });
      closeModal();
      toast('Attendance record added');
      await refresh();
    } catch (err) {
      toast(err.message || 'Could not add record');
    }
  };
}

// Every login/logout that day, not just the first - mainly so the 15-minute idle
// auto-logout's repeated login cycles are actually visible, not hidden behind one count.
async function showDaySessions(userId, date) {
  try {
    const d = await api(`/api/attendance/sessions?user_id=${userId}&date=${date}`);
    const fmt = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : null);
    const rows = d.rows
      .map((r, i) => {
        const out = fmt(r.logout_at);
        return `<tr><td>${i + 1}</td><td>${fmt(r.login_at)}</td><td>${out || '<span class="badge green">Still logged in</span>'}</td></tr>`;
      })
      .join('');
    openModal(
      `Logins on ${date}`,
      `<table class="table"><thead><tr><th>#</th><th>Logged in</th><th>Logged out</th></tr></thead><tbody>${rows}</tbody></table>
       <div class="mini" style="margin-top:8px">Each re-login here is usually the 15-minute inactivity auto-logout, not a new day of work.</div>`
    );
  } catch (e) {
    toast(e.message || 'Could not load login sessions');
  }
}

async function editAttendance(id, statusValue) {
  try {
    await api('/api/attendance/' + id, { method: 'PUT', body: JSON.stringify({ status: statusValue }) });
    toast('Attendance updated');
    await refresh();
  } catch (e) {
    toast(e.message || 'Attendance update failed');
  }
}
