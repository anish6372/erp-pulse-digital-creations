import { api } from '../lib/api.js';
import { state } from '../lib/state.js';
import { $, esc, dateNow, toast } from '../lib/dom.js';
import { refresh } from '../router.js';

export function renderSettings() {
  const { me, boot } = state;
  $('page-settings').innerHTML = `<div class="title"><h1>${me.role === 'Admin' ? 'Settings' : 'My Profile'}</h1><p>${
    me.role === 'Admin' ? 'Office rules and system controls.' : 'Your current HR profile.'
  }</p></div><div class="grid g2"><div class="card"><div class="sectionHead"><h3>${me.role === 'Admin' ? 'Office Rules' : 'Profile'}</h3></div>${
    me.role === 'Admin'
      ? `<div class="fgrid"><div class="field"><label>Office Start</label><input id="s1" type="time" value="${boot.settings.office_start}"></div><div class="field"><label>Office End</label><input id="s2" type="time" value="${boot.settings.office_end}"></div><div class="field"><label>Lunch Start</label><input id="s3" type="time" value="${boot.settings.lunch_start}"></div><div class="field"><label>Lunch End</label><input id="s4" type="time" value="${boot.settings.lunch_end}"></div><div class="field"><label>Report Deadline</label><input id="s5" type="time" value="${boot.settings.report_deadline}"></div><div class="field"><label>Work Week</label><input id="s6" value="${boot.settings.work_week}"><span class="mini">ISO days, e.g. 1,2,3,4,5,6</span></div><div class="field"><label>Salary Calculation Basis</label><select id="s7"><option value="working_days" ${
          boot.settings.salary_divisor === 'working_days' ? 'selected' : ''
        }>Scheduled working days</option><option value="30" ${
          boot.settings.salary_divisor === '30' ? 'selected' : ''
        }>Fixed 30 days</option></select><span class="mini">Recommended: scheduled working days.</span></div></div><button class="btn" id="saveSettingsBtn">Save Rules</button>`
      : `<div class="statline"><span>Name</span><b>${esc(me.name)}</b></div><div class="statline"><span>Login ID</span><b>${esc(
          me.employee_code
        )}</b></div><div class="statline"><span>Role</span><b>${esc(me.role)}</b></div><div class="statline"><span>Department</span><b>${esc(
          me.department
        )}</b></div><div class="statline"><span>Designation</span><b>${esc(me.designation)}</b></div>`
  }</div><div class="card"><div class="sectionHead"><h3>Data & Backup</h3></div><p class="mini">Admin can download a database export for backup. Production deployments should also back up the SQLite file or move to PostgreSQL.</p>${
    me.role === 'Admin' ? '<button class="btn" id="downloadBackupBtn">Download Backup JSON</button>' : ''
  }</div></div>`;
  if (me.role === 'Admin') {
    $('saveSettingsBtn').onclick = saveSettings;
    $('downloadBackupBtn').onclick = downloadBackup;
  }
}

async function saveSettings() {
  await api('/api/settings', {
    method: 'PUT',
    body: JSON.stringify({
      office_start: $('s1').value,
      office_end: $('s2').value,
      lunch_start: $('s3').value,
      lunch_end: $('s4').value,
      report_deadline: $('s5').value,
      work_week: $('s6').value,
      salary_divisor: $('s7').value,
    }),
  });
  toast('Settings saved');
  await refresh();
}

async function downloadBackup() {
  const r = await fetch('/api/export', { headers: { Authorization: 'Bearer ' + state.token } });
  const blob = await r.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'pdc_erp_backup_' + dateNow() + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
}
