import { api } from '../lib/api.js';
import { state } from '../lib/state.js';
import { $, esc, dateNow, status, kpi, toast } from '../lib/dom.js';
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
            }</td><td>${esc(r.first_login || '—')}</td><td>${dayHoursBadge(r.hours_logged || 0)}</td>${
              me.role === 'Admin' ? '<td class="mini">editable</td>' : ''
            }</tr>`
        )
        .join('') || '<tr><td colspan="5" class="empty">No records.</td></tr>';
    cards += `<div class="card" style="margin-bottom:12px"><div class="sectionHead"><div><h3>${esc(x.name)} <span class="mini">${esc(
      x.employee_code
    )}</span></h3></div><div class="pnl">${status('Present')} <span class="mini">${x.summary.present} present • ${x.summary.absent} absent • ${x.summary.half_day} half • ${
      x.summary.full_leave + x.summary.half_leave
    } leave</span></div></div><div class="grid g5">${kpi('Working Days', x.summary.working_days)}${kpi('Present', x.summary.present)}${kpi('Absent', x.summary.absent)}${kpi(
      'Leave',
      x.summary.full_leave
    )}${kpi('Half Day', x.summary.half_day)}${kpi('Attendance %', x.summary.attendance_pct + '%')}${kpi(
      'Hours Logged',
      logged.toFixed(1) + 'h',
      target ? `${pct}% of ${target}h target` : 'no target set'
    )}</div><div class="tableWrap" style="margin-top:10px"><table class="table"><thead><tr><th>Date</th><th>Status</th><th>First Login</th><th>Hours Worked</th>${
      me.role === 'Admin' ? '<th>Edit</th>' : ''
    }</tr></thead><tbody>${days}</tbody></table></div></div>`;
  }
  $('page-attendance').innerHTML = `<div class="title"><h1>${
    me.role === 'Admin' ? 'Attendance Management' : 'My Attendance'
  }</h1><p>Attendance is marked once per day on first login. Hours Worked is the actual login-to-logout time that day, against an 8-hour day.</p></div>${cards}`;
  $('page-attendance')
    .querySelectorAll('select[data-attendance-id]')
    .forEach((sel) => (sel.onchange = () => editAttendance(Number(sel.dataset.attendanceId), sel.value)));
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
