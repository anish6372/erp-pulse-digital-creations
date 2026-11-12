import { api } from '../lib/api.js';
import { state } from '../lib/state.js';
import { $, esc, dateNow, initials, status, kpi, toast, animateCountUps, externalUrl } from '../lib/dom.js';
import { refresh, renderPage } from '../router.js';
import { openReportModal, openLeaveModal } from '../components/modals.js';
import { donutChart, barSpark, segDonut, multiLine } from '../lib/charts.js';
import { icon } from '../lib/icons.js';

const STATUS_ORDER = ['Not Started', 'In Progress', 'Blocked', 'Done'];

function taskPipelineCard(tasks) {
  const counts = STATUS_ORDER.map((s) => tasks.filter((t) => t.status === s).length);
  const total = tasks.length;
  const done = counts[3];
  const pct = total ? (done / total) * 100 : 0;
  return `<div class="card"><div class="sectionHead"><div><h3>Task Pipeline</h3><div class="mini">${total} total tasks</div></div></div><div class="pipeline-row"><div class="pipeline-donut">${donutChart(
    pct,
    { label: 'Done' }
  )}</div><div class="pipeline-bars">${barSpark(counts, { labels: ['Todo', 'Doing', 'Blocked', 'Done'], width: 260, height: 100 })}</div></div></div>`;
}

async function nextUpcomingMeeting() {
  try {
    const d = await api('/api/meetings');
    const upcoming = (d.meetings || [])
      .filter((m) => new Date(m.scheduled_at).getTime() >= Date.now())
      .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
    return upcoming[0] || null;
  } catch (e) {
    return null;
  }
}

function nextMeetingCard(m) {
  if (!m)
    return `<div class="card"><div class="sectionHead"><h3>Next Meeting</h3></div><div class="empty">No upcoming meetings.</div></div>`;
  return `<div class="card next-meeting-card">
    <div class="sectionHead"><h3>Next Meeting</h3><span class="mini">${new Date(m.scheduled_at).toLocaleString('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
    })}</span></div>
    <div class="meeting-main"><div class="meeting-icon">${icon('meetings')}</div><div><b>${esc(m.title)}</b><div class="mini">Hosted by ${esc(m.host_name)} &bull; ${
    m.duration_minutes
  } min</div></div></div>
    <a class="btn success" style="margin-top:10px;width:100%" href="${esc(externalUrl(m.meeting_link))}" target="_blank" rel="noopener">${icon('link')}<span>Join Meeting</span></a>
  </div>`;
}

const C = { blue: '#2563eb', green: '#16a34a', amber: '#f59e0b', red: '#ef4444', purple: '#8b5cf6', slate: '#94a3b8' };

function trend(cur, prev) {
  if (!prev) return cur ? `<span class="trend up">&uarr; new</span> <span class="mini">vs last month</span>` : `<span class="mini">no data last month</span>`;
  const pct = ((cur - prev) / prev) * 100;
  const cls = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
  const arrow = pct > 0 ? '&uarr;' : pct < 0 ? '&darr;' : '&rarr;';
  return `<span class="trend ${cls}">${arrow} ${Math.abs(pct).toFixed(1)}%</span> <span class="mini">vs last month</span>`;
}

function statCard(label, value, foot, iconName, tint) {
  return `<div class="card stat-card"><span class="stat-ic t-${tint}">${icon(iconName)}</span><div class="stat-body"><div class="stat-label">${esc(label)}</div><div class="stat-val">${value}</div><div class="stat-foot">${foot}</div></div></div>`;
}

function legendRows(rows, total) {
  return rows
    .map(
      (r) =>
        `<div class="lg-row"><i style="background:${r.color}"></i><span>${esc(r.label)}</span><b>${r.value}</b><em>${total ? ((r.value / total) * 100).toFixed(1) : '0.0'}%</em></div>`
    )
    .join('');
}

const timeAgo = (iso) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  if (m < 1440) return Math.round(m / 60) + 'h ago';
  return Math.round(m / 1440) + 'd ago';
};

function activityText(a) {
  const verb = { CREATE: 'created', UPDATE: 'updated', DELETE: 'deleted', SUBMIT: 'submitted', CONVERT: 'converted', CLOSE: 'closed' }[a.action] || a.action.toLowerCase().replace(/_/g, ' ');
  const what = String(a.entity_type || '').replace(/_/g, ' ');
  return `${verb} ${what}${a.meta ? ': ' + a.meta : ''}`;
}

function adminDashboardHtml(x, ov, nextMeeting) {
  const { me, boot } = state;
  const tasks = boot.tasks;
  const today = dateNow();
  const hr = new Date().getHours();
  const greet = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
  const monthLabel = new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const m = ov.month;
  const pm = ov.prev_month;

  const by = (st) => tasks.filter((t) => t.status === st).length;
  const taskSeg = [
    { label: 'Done', value: by('Done'), color: C.green },
    { label: 'In Progress', value: by('In Progress'), color: C.blue },
    { label: 'Not Started', value: by('Not Started'), color: C.amber },
    { label: 'Blocked', value: by('Blocked'), color: C.red },
  ];
  const attColor = { Present: C.green, 'Late / Half Day': C.amber, 'Half Day': C.amber, Leave: C.purple, Absent: C.red };
  const marked = ov.attendance.reduce((a, r) => a + r.n, 0);
  const attSeg = [
    ...ov.attendance.map((r) => ({ label: r.status, value: r.n, color: attColor[r.status] || C.slate })),
    ...(x.active - marked > 0 ? [{ label: 'Not marked', value: x.active - marked, color: C.slate }] : []),
  ];

  const stageColor = { New: C.slate, Contacted: C.blue, 'Call done': C.blue, Pitched: C.purple, 'Demo done': C.purple, Done: C.green, 'Proposal sent': C.amber, Won: C.green, Lost: C.red };
  const leadTotal = ov.lead_stages.reduce((a, r) => a + r.n, 0);
  const pipeValue = ov.lead_stages.filter((r) => r.stage !== 'Lost' && r.stage !== 'Won' && r.stage !== 'Done').reduce((a, r) => a + r.value, 0);
  const leadSeg = ov.lead_stages.map((r) => ({ label: r.stage, value: r.n, color: stageColor[r.stage] || C.slate }));

  const prio = (p) => `<span class="prio ${String(p || 'Medium').toLowerCase()}">${esc(p || 'Medium')}</span>`;
  const openTasks = tasks.filter((t) => t.status !== 'Done').slice(0, 5);

  const days = ov.series.map((d) => new Date(d.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }));
  const chart = multiLine(
    [
      { name: 'Created', color: C.blue, values: ov.series.map((d) => d.created) },
      { name: 'Completed', color: C.amber, values: ov.series.map((d) => d.completed) },
    ],
    days
  );

  return `<div class="dash2">
  <div class="d2-head"><div><h1>${greet}, ${esc((me.name || '').split(' ')[0])}</h1><p>Here&rsquo;s what&rsquo;s happening in your business today.</p></div>
    <div class="d2-actions"><span class="range-pill">${icon('leaves')}<span>${monthLabel}</span></span><button class="btn" id="dashAssignBtn">Assign Task</button><button class="btn alt" id="dashPayrollBtn">Open Payroll</button></div></div>

  <div class="d2-stats">
    ${statCard('Active Employees', x.active, `<span class="mini">${x.present} present today</span>`, 'team', 'blue')}
    ${statCard('Tasks Completed', m.completed, trend(m.completed, pm.completed), 'tasks', 'green')}
    ${statCard('Open Tasks', x.open_tasks, ov.overdue ? `<span class="trend down">${ov.overdue} overdue</span>` : `<span class="trend up">none overdue</span>`, 'briefcase', 'amber')}
    ${statCard('Hours Logged', Math.round(m.hours * 10) / 10, trend(m.hours, pm.hours), 'work', 'purple')}
    ${statCard('Pending Leaves', x.pending_leaves, `<span class="mini">${x.pending_leaves ? 'approval required' : 'all clear'}</span>`, 'leaves', 'red')}
  </div>

  <div class="d2-row r-chart">
    <div class="card"><div class="ch-head"><h3>Tasks Created vs Completed</h3><span class="chip-s">Last 30 days</span></div>
      <div class="ch-legend"><span><i style="background:${C.blue}"></i>Created</span><span><i style="background:${C.amber}"></i>Completed</span></div>${chart}</div>
    <div class="card"><div class="ch-head"><h3>Task Status</h3><button class="chip-s link" data-go="tasks">View all</button></div>
      <div class="dn-row">${segDonut(taskSeg, { center: tasks.length, sub: 'Total' })}<div class="lg">${legendRows(taskSeg, tasks.length)}</div></div></div>
  </div>

  <div class="d2-row r-three">
    <div class="card"><div class="ch-head"><h3>Attendance Today</h3><button class="chip-s link" data-go="attendance">Details</button></div>
      <div class="dn-row">${segDonut(attSeg, { size: 130, stroke: 18, center: x.active, sub: 'Staff' })}<div class="lg">${legendRows(attSeg, x.active)}</div></div></div>
    <div class="card"><div class="ch-head"><h3>Lead Pipeline</h3></div>
      <div class="pipe"><span class="pipe-ic">${icon('target')}</span><div><div class="pipe-n">${leadTotal}</div><div class="mini">Leads in total</div></div></div>
      <div class="mini" style="margin-top:12px">Open pipeline value</div><div class="pipe-v">&#8377;${pipeValue.toLocaleString('en-IN')}<span class="mini"> /mo</span></div>
      <div class="lg" style="margin-top:8px">${legendRows(leadSeg, leadTotal)}</div>
      <button class="btn alt full-w" data-go="leads">View Leads</button></div>
    <div>${nextMeetingCard(nextMeeting)}<div class="card" style="margin-top:14px"><div class="ch-head"><h3>Due Today</h3></div><div class="due-n">${ov.due_today}</div><div class="mini">tasks due today &middot; ${ov.overdue} overdue</div></div></div>
  </div>

  <div class="d2-row r-two">
    <div class="card"><div class="ch-head"><h3>Team Tasks</h3><button class="chip-s link" data-go="tasks">View all</button></div>
      ${
        openTasks
          .map(
            (t) =>
              `<div class="tt-row"><span class="tt-av">${initials(t.assignee_name)}</span><div class="tt-main"><b>${esc(t.title)}</b><span class="mini">${esc(t.assignee_name)} &middot; ${esc(t.client_short || 'Internal')}</span></div><span class="tt-due ${t.due_date < today ? 'late' : ''}">${esc(t.due_date)}</span>${prio(t.priority)}${status(t.status)}</div>`
          )
          .join('') || '<div class="empty">No open tasks.</div>'
      }</div>
    <div class="card"><div class="ch-head"><h3>Recent Activities</h3></div>
      ${
        ov.activity
          .map(
            (a) =>
              `<div class="act-row"><span class="act-dot"></span><div class="act-main"><b>${esc(activityText(a))}</b><span class="mini">by ${esc(a.actor || 'System')}</span></div><span class="mini">${timeAgo(a.created_at)}</span></div>`
          )
          .join('') || '<div class="empty">No activity yet.</div>'
      }</div>
  </div>

  <div class="d2-row r-two">
    <div class="card"><div class="ch-head"><h3>Top Performers</h3><span class="chip-s">${monthLabel}</span></div>
      <div class="tableWrap"><table class="table"><thead><tr><th>Employee</th><th>Role</th><th>Done</th><th>Open</th><th>Hours</th><th>On time</th></tr></thead><tbody>${
        ov.performers
          .map(
            (p) =>
              `<tr><td><div class="row"><span class="tt-av">${initials(p.name)}</span><b>${esc(p.name)}</b></div></td><td>${esc(p.designation || '—')}</td><td>${p.done}</td><td>${p.open}</td><td>${Math.round(p.hours * 10) / 10}</td><td>${
                p.done ? Math.round((p.on_time / p.done) * 100) + '%' : '—'
              }</td></tr>`
          )
          .join('') || '<tr><td colspan="6" class="empty">No data yet.</td></tr>'
      }</tbody></table></div></div>
    <div class="card"><div class="ch-head"><h3>Leave Requests</h3><button class="chip-s link" id="dashLeavesBtn">View all</button></div><div id="dashLeaves"></div></div>
  </div>
</div>`;
}

export async function renderDashboard() {
  const { me, boot } = state;
  const admin = me.role === 'Admin';
  if (admin) {
    const [x, ov, nextMeeting] = await Promise.all([api('/api/admin/dashboard'), api('/api/admin/overview'), nextUpcomingMeeting()]);
    $('page-dashboard').innerHTML = adminDashboardHtml(x, ov, nextMeeting);
    $('dashAssignBtn').onclick = () => renderPage('tasks');
    $('dashPayrollBtn').onclick = () => renderPage('payroll');
    $('dashLeavesBtn').onclick = () => renderPage('leaves');
    document.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => renderPage(b.dataset.go)));
    await renderDashLeaves();
  } else {
    const att = (await api('/api/attendance?month=' + dateNow().slice(0, 7))).data.find((x) => x.user_id === me.id);
    // Attendance rows are sorted ascending (1st of the month first) for the Attendance
    // page's own display - this must look today's row up by its actual date, not assume
    // position 0 is today, which only happened to be true under the old newest-first order.
    const todayRow = att?.rows?.find((r) => r.date === dateNow());
    const w = await api('/api/work/status');
    const open = boot.tasks.filter((t) => t.assignee_id === me.id && t.status !== 'Done');
    const done = boot.tasks.filter((t) => t.assignee_id === me.id && t.status === 'Done').length;
    const report = boot.reports.filter((r) => r.work_date === dateNow()).length;
    const nextMeeting = await nextUpcomingMeeting();
    $('page-dashboard').innerHTML = `<div class="title"><h1>Welcome, ${esc(me.name)}</h1><p>Everything you need to manage your day is here.</p></div><div class="grid g5">${kpi(
      'Today',
      status(todayRow?.status || 'Absent'),
      'attendance',
      icon('attendance')
    )}${kpi('First Login', todayRow?.first_login || '—', 'today', icon('work'))}${kpi('Work', w.on ? 'ON' : 'OFF', w.session?.task_title || 'ready', icon('work'))}${kpi(
      'Open Tasks',
      open.length,
      'assigned',
      icon('tasks')
    )}${kpi('Done', done, 'completed', icon('tasks'))}</div><div class="grid g2" style="margin-top:14px"><div class="card"><div class="sectionHead"><h3>My Tasks</h3><button class="btn alt" id="dashOpenTasksBtn">Open</button></div>${
      open
        .slice(0, 8)
        .map(
          (t) =>
            `<div class="statline"><span><b>${esc(t.title)}</b><span class="mini"> • ${esc(t.client_short || 'Internal')} • due ${esc(t.due_date)}</span></span>${status(t.status)}</div>`
        )
        .join('') || '<div class="empty">No open tasks assigned.</div>'
    }</div><div class="card"><div class="sectionHead"><h3>Quick Actions</h3></div><div class="pnl"><select id="workTaskSelect" style="min-width:220px;padding:10px;border:1px solid var(--line);border-radius:10px"><option value="">Select task</option>${open
      .map((t) => `<option value="${t.id}">${esc(t.title)}</option>`)
      .join('')}</select><button class="btn success" id="workOnBtn">WORK ON</button><button class="btn danger" id="workOffBtn">WORK OFF</button><button class="btn" id="submitWorkBtn">Submit Work</button><button class="btn alt" id="requestLeaveBtn">Request Leave</button><button class="btn alt" id="messageBtn">Message</button></div><div class="notice ok" style="margin-top:12px">Today's reports submitted: ${report}</div></div></div><div class="grid g2" style="margin-top:14px">${nextMeetingCard(nextMeeting)}${taskPipelineCard(
      boot.tasks.filter((t) => t.assignee_id === me.id)
    )}</div>`;
    $('dashOpenTasksBtn').onclick = () => renderPage('tasks');
    $('workOnBtn').onclick = () => toggleWork(true);
    $('workOffBtn').onclick = () => toggleWork(false);
    $('submitWorkBtn').onclick = () => openReportModal();
    $('requestLeaveBtn').onclick = () => openLeaveModal();
    $('messageBtn').onclick = () => renderPage('chat');
  }
  animateCountUps($('page-dashboard'));
}

async function renderDashLeaves() {
  const n = await api('/api/notifications');
  const el = $('dashLeaves');
  el.innerHTML = n.pending_leaves.length
    ? n.pending_leaves
        .slice(0, 5)
        .map(
          (l) =>
            `<div class="notice warn"><b>${esc(l.name)}</b> • ${esc(l.leave_type)} • ${esc(l.leave_date)}<div style="margin-top:6px"><button class="btn success" data-approve="${l.id}">Approve</button> <button class="btn danger" data-reject="${l.id}">Reject</button></div></div>`
        )
        .join('')
    : '<div class="notice ok">No pending leave requests.</div>';
  el.querySelectorAll('[data-approve]').forEach((b) => (b.onclick = () => reviewLeave(Number(b.dataset.approve), 'Approved')));
  el.querySelectorAll('[data-reject]').forEach((b) => (b.onclick = () => reviewLeave(Number(b.dataset.reject), 'Rejected')));
}

async function reviewLeave(id, s) {
  await api('/api/leaves/' + id, { method: 'PUT', body: JSON.stringify({ status: s }) });
  toast('Leave ' + s.toLowerCase());
  await refresh();
}

export async function toggleWork(on) {
  let taskId = null;
  if (on) {
    taskId = Number($('workTaskSelect')?.value || 0);
    if (!taskId) {
      toast('Select a task before WORK ON');
      return;
    }
  }
  try {
    await api('/api/work/toggle', { method: 'POST', body: JSON.stringify({ on, task_id: taskId || null }) });
    toast(on ? 'Work started' : 'Work stopped');
    await refresh();
  } catch (e) {
    toast(e.message);
  }
}
