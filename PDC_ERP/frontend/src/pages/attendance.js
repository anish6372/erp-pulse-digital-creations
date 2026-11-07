import { api } from '../lib/api.js';
import { state } from '../lib/state.js';
import { $, esc, dateNow, status, kpi, toast } from '../lib/dom.js';
import { refresh } from '../router.js';

export async function renderAttendance() {
  const { me } = state;
  const m = dateNow().slice(0, 7);
  const d = await api('/api/attendance?month=' + m);
  let cards = '';
  for (const x of d.data) {
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
            }</td><td>${esc(r.first_login || '—')}</td>${me.role === 'Admin' ? '<td class="mini">editable</td>' : ''}</tr>`
        )
        .join('') || '<tr><td colspan="4" class="empty">No records.</td></tr>';
    cards += `<div class="card" style="margin-bottom:12px"><div class="sectionHead"><div><h3>${esc(x.name)} <span class="mini">${esc(
      x.employee_code
    )}</span></h3></div><div class="pnl">${status('Present')} <span class="mini">${x.summary.present} present • ${x.summary.absent} absent • ${x.summary.half_day} half • ${
      x.summary.full_leave + x.summary.half_leave
    } leave</span></div></div><div class="grid g5">${kpi('Working Days', x.summary.working_days)}${kpi('Present', x.summary.present)}${kpi('Absent', x.summary.absent)}${kpi(
      'Leave',
      x.summary.full_leave
    )}${kpi('Half Day', x.summary.half_day)}${kpi('Attendance %', x.summary.attendance_pct + '%')}</div><div class="tableWrap" style="margin-top:10px"><table class="table"><thead><tr><th>Date</th><th>Status</th><th>First Login</th>${
      me.role === 'Admin' ? '<th>Edit</th>' : ''
    }</tr></thead><tbody>${days}</tbody></table></div></div>`;
  }
  $('page-attendance').innerHTML = `<div class="title"><h1>${
    me.role === 'Admin' ? 'Attendance Management' : 'My Attendance'
  }</h1><p>Attendance is marked once per day on first login. Login/logout sessions remain separate.</p></div>${cards}`;
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
