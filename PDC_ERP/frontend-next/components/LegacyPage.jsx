'use client';
import { useEffect } from 'react';
import { animateCountUps, $ } from '../legacy/lib/dom.js';
import { useApp } from './AuthContext';

// Bridge for screens that have not been rewritten as React components yet: mounts the
// section the old imperative module expects, runs its render function, and reports back.
const LOADERS = {
  dashboard: async () => (await import('../legacy/pages/dashboard.js')).renderDashboard(),
  tasks: async () => (await import('../legacy/pages/tasks.js')).renderTasks(),
  work: async () => (await import('../legacy/pages/work.js')).renderWork(),
  deliverables: async () => (await import('../legacy/pages/deliverables.js')).renderDeliverables(),
  attendance: async () => (await import('../legacy/pages/attendance.js')).renderAttendance(),
  leaves: async () => (await import('../legacy/pages/leaves.js')).renderLeaves(),
  chat: async () => (await import('../legacy/pages/chat.js')).renderChat(),
  meetings: async () => (await import('../legacy/pages/meetings.js')).renderMeetings(),
  payroll: async () => (await import('../legacy/pages/payroll.js')).renderPayroll(),
  hrms: async () => (await import('../legacy/pages/hrms.js')).renderHRMS(),
  onboarding: async () => (await import('../legacy/pages/onboarding.js')).loadOnboarding(),
  ats: async () => (await import('../legacy/pages/ats.js')).loadATS(),
  team: async () => (await import('../legacy/pages/team.js')).renderTeam(),
  clients: async () => (await import('../legacy/pages/clients.js')).renderClients(),
  marketing: async () => (await import('../legacy/pages/marketing.js')).renderMarketing(),
  leads: async () => (await import('../legacy/pages/leads.js')).renderLeads(),
  prospect: async () => (await import('../legacy/pages/prospect.js')).renderProspect(),
  content: async () => (await import('../legacy/pages/content.js')).renderContent(),
  reports: async () => (await import('../legacy/pages/clientReport.js')).renderClientReport(),
  settings: async () => (await import('../legacy/pages/settings.js')).renderSettings(),
};

export const hasLegacy = (page) => page in LOADERS;

export default function LegacyPage({ page }) {
  const { version, markRendered } = useApp();
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await LOADERS[page]();
      } catch (e) {
        const el = $('page-' + page);
        if (el && alive) el.innerHTML = `<div class="card"><div class="err">Could not load this page: ${String(e.message || e)}</div></div>`;
      }
      if (!alive) return;
      const el = $('page-' + page);
      if (el) animateCountUps(el);
      markRendered(page);
    })();
    return () => {
      alive = false;
    };
  }, [page, version, markRendered]);
  return <section id={'page-' + page} className="page active" />;
}
