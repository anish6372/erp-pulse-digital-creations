// Minimal hand-drawn line icon set — no external icon font/library.
// 24x24 viewBox, currentColor stroke, consistent weight.
const wrap = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
  dashboard: wrap('<rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/>'),
  attendance: wrap('<circle cx="12" cy="12" r="8.3"/><path d="M12 7.3V12l3.2 2"/>'),
  tasks: wrap('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8.3 12.2l2.5 2.5 5-5.2"/>'),
  work: wrap('<circle cx="12" cy="12" r="8.3"/><path d="M10 8.7v6.6l5.3-3.3z"/>'),
  leaves: wrap('<rect x="3.5" y="5" width="17" height="15" rx="2.2"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/><path d="M8 13.3h2.2M8 16.6h5"/>'),
  payroll: wrap('<circle cx="12" cy="12" r="8.3"/><path d="M9.3 8.6h4a2 2 0 010 4H9.2m0 0H14m-4.7 0l4.7 4.8M9.3 12.6v-4"/>'),
  hrms: wrap('<circle cx="12" cy="8.3" r="3.3"/><path d="M5.3 19.3c0-3.3 3-5.7 6.7-5.7s6.7 2.4 6.7 5.7"/>'),
  onboarding: wrap('<circle cx="9.6" cy="8.3" r="3.3"/><path d="M3.3 19.3c0-3.3 2.9-5.7 6.3-5.7s6.3 2.4 6.3 5.7"/><path d="M19 8.2v5.6M16.2 11h5.6"/>'),
  ats: wrap('<path d="M4 5h16M6.5 5v3.2L11 13v4.8L13 19v-6l4.5-4.8V5"/>'),
  chat: wrap('<path d="M4.5 5.5h15a1.5 1.5 0 011.5 1.5v8.3a1.5 1.5 0 01-1.5 1.5H10l-4.3 3.4v-3.4H4.5A1.5 1.5 0 013 15.3V7a1.5 1.5 0 011.5-1.5z"/>'),
  meetings: wrap('<rect x="3" y="6.5" width="13" height="11" rx="2"/><path d="M16 10.3l5-2.8v9l-5-2.8"/>'),
  groupchat: wrap('<path d="M8 4.5h9a1.5 1.5 0 011.5 1.5v6a1.5 1.5 0 01-1.5 1.5h-1.3v3L13 13.5H8A1.5 1.5 0 016.5 12V6A1.5 1.5 0 018 4.5z"/><path d="M4.8 9.5H4a1.5 1.5 0 00-1.5 1.5v5.5l2.6-2h3.4"/>'),
  briefcase: wrap('<rect x="3.5" y="7.5" width="17" height="12" rx="2.2"/><path d="M9 7.5V6a2 2 0 012-2h2a2 2 0 012 2v1.5M3.5 13h17"/>'),
  building: wrap('<rect x="5" y="3.5" width="14" height="17" rx="1.6"/><path d="M9 8h2M13 8h2M9 12h2M13 12h2M10 20.5v-4h4v4"/>'),
  user: wrap('<circle cx="12" cy="8.3" r="3.6"/><path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6"/>'),
  at: wrap('<circle cx="12" cy="12" r="3.6"/><path d="M15.6 12v1.5a2.4 2.4 0 004.8 0V12a8.4 8.4 0 10-3.3 6.7"/>'),
  search: wrap('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>'),
  moon: wrap('<path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z"/>'),
  sun: wrap('<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4"/>'),
  target: wrap('<circle cx="12" cy="12" r="8.3"/><circle cx="12" cy="12" r="4.6"/><circle cx="12" cy="12" r="1.2"/>'),
  film: wrap('<rect x="3.5" y="5" width="17" height="14" rx="2.2"/><path d="M3.5 9.5h17M8 5l-2 4.5M13 5l-2 4.5M18 5l-2 4.5"/>'),
  report: wrap('<path d="M7 3.5h7.5L19 8v12.5H7z"/><path d="M14.5 3.5V8H19M10 13h6M10 16.5h6M10 9.8h2"/>'),
  plus: wrap('<path d="M12 5v14M5 12h14"/>'),
  send: wrap('<path d="M4 12l15.5-7.5L13 20l-2.2-7L4 12z"/>'),
  link: wrap('<path d="M9.5 14.5l5-5"/><path d="M13 7l1.3-1.3a3 3 0 014.3 4.3L17 11.5M11 13l-1.3 1.3a3 3 0 01-4.3-4.3L7 8.5"/>'),
  deliverables: wrap('<path d="M3.5 8.3a1.8 1.8 0 011.8-1.8h4.3l1.7 2h7.4a1.8 1.8 0 011.8 1.8v8.6a1.8 1.8 0 01-1.8 1.8H5.3a1.8 1.8 0 01-1.8-1.8z"/><path d="M9 14l2.3 2.3L16 11.6"/>'),
  marketing: wrap('<path d="M4 20V11M10 20V6M16 20v-8M21 5l-6.5 6.5-3-3L4 16"/><path d="M16 5h5v5"/>'),
  team: wrap('<circle cx="8.6" cy="8.3" r="2.9"/><circle cx="16.4" cy="9.3" r="2.4"/><path d="M3.3 19c0-2.9 2.4-5 5.3-5s5.3 2.1 5.3 5M14.6 19c0-2.2-1.1-4-2.8-4.9c.8-.5 1.8-.8 2.9-.8c2.6 0 4.7 1.9 4.7 4.8"/>'),
  clients: wrap('<rect x="3.5" y="8" width="17" height="11" rx="2"/><path d="M8.3 8V6.3A2.3 2.3 0 0110.6 4h2.8a2.3 2.3 0 012.3 2.3V8M3.5 12.7c2.6 1.6 5.6 2.4 8.5 2.4s5.9-.8 8.5-2.4"/>'),
  settings: wrap('<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.3M12 18.2v2.3M20.5 12h-2.3M5.8 12H3.5M17.8 6.2l-1.6 1.6M7.8 16.2l-1.6 1.6M17.8 17.8l-1.6-1.6M7.8 7.8L6.2 6.2"/>'),
  bell: wrap('<path d="M6 10.5a6 6 0 0112 0c0 4 1.4 5.8 1.9 6.3H4.1c.5-.5 1.9-2.3 1.9-6.3z"/><path d="M10 19a2 2 0 004 0"/>'),
  refresh: wrap('<path d="M4 12a8 8 0 0113.7-5.7M20 12a8 8 0 01-13.7 5.7"/><path d="M17.3 4.8v3.6h-3.6M6.7 19.2v-3.6h3.6"/>'),
  menu: wrap('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  expand: wrap('<path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5"/>'),
  logout: wrap('<path d="M15 4h3.5A1.5 1.5 0 0120 5.5v13a1.5 1.5 0 01-1.5 1.5H15"/><path d="M10 8l-4.5 4L10 16"/><path d="M5.5 12H16"/>'),
  trash: wrap('<path d="M4.5 7h15M9.5 7V5.3a1.5 1.5 0 011.5-1.5h2a1.5 1.5 0 011.5 1.5V7M18 7l-.8 12.3a1.8 1.8 0 01-1.8 1.7H8.6a1.8 1.8 0 01-1.8-1.7L6 7"/><path d="M10 11v6M14 11v6"/>'),
  shield: wrap('<path d="M12 3.5l7 3v5.5c0 5-3 8-7 9.5-4-1.5-7-4.5-7-9.5V6.5z"/><path d="M9 12l2.2 2.2L15.3 10"/>'),
};

export function icon(name, cls = '') {
  return `<span class="nav-icon ${cls}">${icons[name] || ''}</span>`;
}
