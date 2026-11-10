import { api } from './lib/api.js';
import { state, setToken } from './lib/state.js';
import { $, animateCountUps, initials } from './lib/dom.js';
import { icon } from './lib/icons.js';
import { connectSocket, disconnectSocket } from './lib/socket.js';
import { renderDashboard } from './pages/dashboard.js';
import { renderTasks } from './pages/tasks.js';
import { renderWork } from './pages/work.js';
import { renderAttendance } from './pages/attendance.js';
import { renderLeaves } from './pages/leaves.js';
import { renderChat } from './pages/chat.js';
import { renderPayroll } from './pages/payroll.js';
import { renderHRMS } from './pages/hrms.js';
import { renderATS, loadATS } from './pages/ats.js';
import { loadOnboarding } from './pages/onboarding.js';
import { renderTeam } from './pages/team.js';
import { renderClients } from './pages/clients.js';
import { renderSettings } from './pages/settings.js';
import { updateNotifications } from './pages/notifications.js';
import { renderMeetings } from './pages/meetings.js';
import { renderDeliverables } from './pages/deliverables.js';
import { renderMarketing } from './pages/marketing.js';
import { renderLeads } from './pages/leads.js';
import { renderContent } from './pages/content.js';
import { renderClientReport } from './pages/clientReport.js';

// The menu is two levels: a rail of sections, and the screens inside the chosen section.
// Each item is [page id, icon, label].
const ADMIN_SECTIONS = [
  { id: 'home', label: 'Home', icon: 'dashboard', items: [['dashboard', 'dashboard', 'Dashboard']] },
  {
    id: 'workspace',
    label: 'Workspace',
    icon: 'briefcase',
    items: [
      ['marketing', 'at', 'Social'],
      ['content', 'film', 'Content'],
      ['tasks', 'tasks', 'Tasks'],
      ['work', 'work', 'Daily Work'],
      ['deliverables', 'deliverables', 'Deliverables'],
      ['meetings', 'meetings', 'Meetings'],
      ['chat', 'chat', 'Chat'],
    ],
  },
  {
    id: 'growth',
    label: 'Growth',
    icon: 'marketing',
    items: [
      ['leads', 'target', 'Leads'],
      ['reports', 'report', 'Client reports'],
    ],
  },
  {
    id: 'company',
    label: 'Company',
    icon: 'building',
    items: [
      ['team', 'team', 'Team'],
      ['clients', 'clients', 'Clients'],
      ['hrms', 'hrms', 'HRMS'],
      ['onboarding', 'onboarding', 'Onboarding'],
      ['ats', 'ats', 'ATS'],
      ['payroll', 'payroll', 'Payroll'],
    ],
  },
  {
    id: 'me',
    label: 'Me',
    icon: 'user',
    items: [
      ['attendance', 'attendance', 'Attendance'],
      ['leaves', 'leaves', 'Leave Requests'],
    ],
  },
  { id: 'settings', label: 'Settings', icon: 'settings', items: [['settings', 'settings', 'Settings']] },
];

const EMPLOYEE_SECTIONS = [
  { id: 'home', label: 'Home', icon: 'dashboard', items: [['dashboard', 'dashboard', 'My Dashboard']] },
  {
    id: 'workspace',
    label: 'Workspace',
    icon: 'briefcase',
    items: [
      ['content', 'film', 'My Content'],
      ['tasks', 'tasks', 'My Tasks'],
      ['work', 'work', 'Submit Work'],
      ['deliverables', 'deliverables', 'Deliverables'],
      ['meetings', 'meetings', 'Meetings'],
      ['chat', 'chat', 'Chat'],
    ],
  },
  {
    id: 'me',
    label: 'Me',
    icon: 'user',
    items: [
      ['attendance', 'attendance', 'My Attendance'],
      ['leaves', 'leaves', 'My Leave'],
      ['settings', 'settings', 'My Profile'],
    ],
  },
];

// Leads is Admin's by default, but Digital Marketing runs it day to day - inject a Growth
// section for them specifically, rather than opening it to every employee.
const sections = () => {
  if (state.me.role === 'Admin') return ADMIN_SECTIONS;
  const isDigitalMarketing = String(state.me.department || '').toLowerCase() === 'digital marketing';
  if (!isDigitalMarketing) return EMPLOYEE_SECTIONS;
  return [
    ...EMPLOYEE_SECTIONS.slice(0, 2),
    { id: 'growth', label: 'Growth', icon: 'marketing', items: [['leads', 'target', 'Leads']] },
    ...EMPLOYEE_SECTIONS.slice(2),
  ];
};
const sectionOf = (page) => sections().find((s) => s.items.some((i) => i[0] === page)) || sections()[0];


const TITLES = (admin) => ({
  dashboard: admin ? 'Dashboard' : 'My Dashboard',
  tasks: admin ? 'Tasks & Assignments' : 'My Tasks',
  work: admin ? 'Daily Work Reports' : 'Submit Work',
  deliverables: 'Deliverables',
  attendance: 'Attendance',
  leaves: admin ? 'Leave Requests' : 'My Leave',
  chat: 'Company Chat',
  meetings: 'Meetings',
  payroll: 'Payroll',
  hrms: 'HRMS',
  onboarding: 'Employee Onboarding',
  ats: 'ATS',
  team: 'Team',
  clients: 'Clients',
  marketing: 'Social',
  leads: 'Leads',
  content: 'Content calendar',
  reports: 'Client report',
  settings: 'Settings',
});

// --- Navigation: a sidebar of collapsible groups + a Ctrl+K command palette ---

// Which groups the user has folded away (remembered per browser).
let closedGroups = new Set();
try {
  closedGroups = new Set(JSON.parse(localStorage.getItem('pdc_nav_closed') || '[]'));
} catch (e) {
  /* storage blocked: groups simply start open */
}
const saveClosed = () => {
  try {
    localStorage.setItem('pdc_nav_closed', JSON.stringify([...closedGroups]));
  } catch (e) {
    /* ignore */
  }
};

function navItem(x) {
  return `<button data-page="${x[0]}" class="sb-item ${x[0] === state.currentPage ? 'active' : ''}" title="${x[2]}">${icon(x[1])}<span class="sb-label">${x[2]}</span></button>`;
}

function renderSidebar() {
  $('nav').innerHTML = sections()
    .map((s) => {
      const open = !closedGroups.has(s.id) || s.items.some((i) => i[0] === state.currentPage);
      return `<div class="sb-group ${open ? 'open' : ''}" data-group="${s.id}">
        <button class="sb-head" data-toggle="${s.id}" title="${s.label}">${icon(s.icon)}<span class="sb-label">${s.label}</span><i class="sb-chev"></i></button>
        <div class="sb-items">${s.items.map(navItem).join('')}</div>
      </div>`;
    })
    .join('');
  $('nav')
    .querySelectorAll('button[data-page]')
    .forEach((b) => (b.onclick = () => {
      closeDrawer();
      renderPage(b.dataset.page);
    }));
  $('nav')
    .querySelectorAll('button[data-toggle]')
    .forEach(
      (b) =>
        (b.onclick = () => {
          // In the slim (icons only) sidebar a group head just opens the sidebar again.
          if ($('side').classList.contains('slim')) return setSlim(false);
          const g = b.parentElement;
          g.classList.toggle('open');
          if (g.classList.contains('open')) closedGroups.delete(b.dataset.toggle);
          else closedGroups.add(b.dataset.toggle);
          saveClosed();
        })
    );
}

export function setSlim(on) {
  $('side').classList.toggle('slim', on);
  document.body.classList.toggle('slim-nav', on);
  try {
    localStorage.setItem('pdc_nav_slim', on ? '1' : '0');
  } catch (e) {
    /* ignore */
  }
}

export function openDrawer() {
  $('side').classList.add('drawer');
  $('shade').classList.add('show');
}

export function closeDrawer() {
  $('side').classList.remove('drawer');
  $('shade').classList.remove('show');
}

// ---- command palette ----
let cmdIndex = 0;
let cmdHits = [];

function cmdRender(q) {
  q = q.trim().toLowerCase();
  cmdHits = sections().flatMap((s) =>
    s.items.filter((i) => !q || i[2].toLowerCase().includes(q) || s.label.toLowerCase().includes(q)).map((i) => ({ i, s }))
  );
  cmdIndex = 0;
  $('cmdList').innerHTML = cmdHits.length
    ? cmdHits
        .map(({ i, s }, n) => `<button class="cmd-item ${n === 0 ? 'on' : ''}" data-n="${n}">${icon(i[1])}<span>${i[2]}</span><em>${s.label}</em></button>`)
        .join('')
    : '<div class="empty">Nothing matches that.</div>';
  $('cmdList')
    .querySelectorAll('.cmd-item')
    .forEach((b) => (b.onclick = () => cmdGo(Number(b.dataset.n))));
}

function cmdMove(d) {
  if (!cmdHits.length) return;
  cmdIndex = (cmdIndex + d + cmdHits.length) % cmdHits.length;
  $('cmdList')
    .querySelectorAll('.cmd-item')
    .forEach((b, n) => {
      b.classList.toggle('on', n === cmdIndex);
      if (n === cmdIndex) b.scrollIntoView({ block: 'nearest' });
    });
}

function cmdGo(n) {
  const hit = cmdHits[n];
  if (!hit) return;
  closeCmd();
  renderPage(hit.i[0]);
}

export function openCmd() {
  $('cmd').classList.remove('hidden');
  $('cmdInput').value = '';
  cmdRender('');
  $('cmdInput').focus();
}

export function closeCmd() {
  $('cmd').classList.add('hidden');
}

export function buildNav() {
  $('userPill').textContent = state.me.role;
  $('sbName').textContent = state.me.name;
  $('sbAvatar').textContent = initials(state.me.name);
  $('cmdIcon').innerHTML = icon('search');
  $('cmdFieldIcon').innerHTML = icon('search');
  $('cmdBtn').onclick = openCmd;
  $('cmdInput').oninput = (e) => cmdRender(e.target.value);
  $('cmdInput').onkeydown = (e) => {
    if (e.key === 'ArrowDown') (e.preventDefault(), cmdMove(1));
    else if (e.key === 'ArrowUp') (e.preventDefault(), cmdMove(-1));
    else if (e.key === 'Enter') cmdGo(cmdIndex);
    else if (e.key === 'Escape') closeCmd();
  };
  $('cmd').onclick = (e) => {
    if (e.target.id === 'cmd') closeCmd();
  };
  renderSidebar();
}

export function activatePage(p) {
  document.querySelectorAll('.page').forEach((x) => x.classList.remove('active'));
  $('page-' + p).classList.add('active');
  state.currentPage = p;
  const sec = sectionOf(p);
  renderSidebar();
  const title = TITLES(state.me.role === 'Admin')[p] || p;
  $('topTitle').textContent = title;
  $('topCrumb').textContent = sec.label;
  document.title = title + ' · PDC ERP';
  window.scrollTo({ top: 0 });
}

export async function renderPage(p) {
  activatePage(p);
  if (p === 'dashboard') await renderDashboard();
  if (p === 'tasks') renderTasks();
  if (p === 'work') renderWork();
  if (p === 'deliverables') await renderDeliverables();
  if (p === 'attendance') await renderAttendance();
  if (p === 'leaves') renderLeaves();
  if (p === 'chat') await renderChat();
  if (p === 'meetings') await renderMeetings();
  if (p === 'payroll') await renderPayroll();
  if (p === 'hrms') renderHRMS();
  if (p === 'onboarding') await loadOnboarding();
  if (p === 'ats') await loadATS();
  if (p === 'team') renderTeam();
  if (p === 'clients') renderClients();
  if (p === 'marketing') await renderMarketing();
  if (p === 'leads') await renderLeads();
  if (p === 'content') await renderContent();
  if (p === 'reports') await renderClientReport();
  if (p === 'settings') renderSettings();
  animateCountUps($('page-' + p));
}

export async function bootApp() {
  const d = await api('/api/bootstrap');
  state.boot = d;
  state.me = d.user;
  $('login').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('userPill').textContent = state.me.name + ' • ' + state.me.role;
  document.body.classList.add('app');
  try { if (localStorage.getItem('pdc_nav_slim') === '1') setSlim(true); } catch (e) { /* ignore */ }
  try { if (localStorage.getItem('pdc_theme') === 'dark') document.body.classList.add('dark'); } catch (e) { /* storage blocked */ }
  $('todayLabel').textContent = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(new Date());
  buildNav();
  await renderPage('dashboard');
  startPoll();
  connectSocket();
}

export async function refresh() {
  const d = await api('/api/bootstrap');
  state.boot = d;
  state.me = d.user;
  await renderPage(state.currentPage);
  await updateNotifications();
}

export function startPoll() {
  clearInterval(state.timer);
  let tick = 0;
  state.timer = setInterval(async () => {
    try {
      await updateNotifications();
      // notifications every 5 s; the heavier admin dashboard only every 30 s
      if (++tick % 6 === 0 && state.currentPage === 'dashboard' && state.me.role === 'Admin') await renderDashboard();
    } catch (e) {
      /* ignore transient poll errors */
    }
  }, 5000);
}

export function logout() {
  clearInterval(state.timer);
  disconnectSocket();
  setToken('');
}
