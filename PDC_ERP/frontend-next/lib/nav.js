// Sidebar structure: sections of [page id, icon, label]. Same menu as the original app.
export const ADMIN_SECTIONS = [
  { id: 'home', label: 'Home', icon: 'dashboard', items: [['dashboard', 'dashboard', 'Dashboard']] },
  { id: 'workspace', label: 'Workspace', icon: 'briefcase', items: [['marketing', 'at', 'Social'], ['content', 'film', 'Content'], ['tasks', 'tasks', 'Tasks'], ['work', 'work', 'Daily Work'], ['deliverables', 'deliverables', 'Deliverables'], ['meetings', 'meetings', 'Meetings'], ['chat', 'chat', 'Chat']] },
  { id: 'growth', label: 'Growth', icon: 'marketing', items: [['leads', 'target', 'Leads'], ['hunter', 'radar', 'Client Hunter'], ['prospect', 'search', 'Prospect Analyzer'], ['reports', 'report', 'Client reports']] },
  { id: 'company', label: 'Company', icon: 'building', items: [['team', 'team', 'Team'], ['clients', 'clients', 'Clients'], ['hrms', 'hrms', 'HRMS'], ['onboarding', 'onboarding', 'Onboarding'], ['ats', 'ats', 'ATS'], ['payroll', 'payroll', 'Payroll']] },
  { id: 'me', label: 'Me', icon: 'user', items: [['attendance', 'attendance', 'Attendance'], ['leaves', 'leaves', 'Leave Requests']] },
  { id: 'settings', label: 'Settings', icon: 'settings', items: [['settings', 'settings', 'Settings']] },
];

export const EMPLOYEE_SECTIONS = [
  { id: 'home', label: 'Home', icon: 'dashboard', items: [['dashboard', 'dashboard', 'My Dashboard']] },
  { id: 'workspace', label: 'Workspace', icon: 'briefcase', items: [['content', 'film', 'My Content'], ['tasks', 'tasks', 'My Tasks'], ['work', 'work', 'Submit Work'], ['deliverables', 'deliverables', 'Deliverables'], ['meetings', 'meetings', 'Meetings'], ['chat', 'chat', 'Chat']] },
  { id: 'me', label: 'Me', icon: 'user', items: [['attendance', 'attendance', 'My Attendance'], ['leaves', 'leaves', 'My Leave'], ['settings', 'settings', 'My Profile']] },
];

// Leads is Admin's by default, but Sales runs it day to day.
export function sectionsFor(me) {
  if (!me) return [];
  if (me.role === 'Admin') return ADMIN_SECTIONS;
  if (String(me.department || '').toLowerCase() !== 'sales') return EMPLOYEE_SECTIONS;
  return [
    ...EMPLOYEE_SECTIONS.slice(0, 2),
    { id: 'growth', label: 'Growth', icon: 'marketing', items: [['leads', 'target', 'Leads'], ['hunter', 'radar', 'Client Hunter']] },
    ...EMPLOYEE_SECTIONS.slice(2),
  ];
}

export const TITLES = (admin) => ({
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
  hunter: 'Client Hunter',
  prospect: 'Prospect Analyzer',
  content: 'Content calendar',
  reports: 'Client report',
  settings: 'Settings',
});

export const PAGE_IDS = Object.keys(TITLES(true));
