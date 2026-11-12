const { db, getSetting } = require('../db');
const { today, istHM } = require('../utils/datetime');
const { notifyAdmins, notify } = require('../utils/notify');

function automationSweep() {
  try {
    const t = today();
    const nowHMValue = istHM();
    const officeEnd = getSetting('office_end', '19:00');
    const reportDeadline = getSetting('report_deadline', '18:00');
    const afterEnd = nowHMValue >= officeEnd;
    const afterReport = nowHMValue >= reportDeadline;
    const employees = db.prepare("SELECT id,name FROM users WHERE active=1 AND role='Employee'").all();
    if (afterEnd) {
      for (const e of employees) {
        const att = db.prepare('SELECT id FROM attendance_days WHERE user_id=? AND date=?').get(e.id, t);
        const approved = db.prepare("SELECT id FROM leave_requests WHERE user_id=? AND leave_date=? AND status='Approved'").get(e.id, t);
        if (!att && !approved) db.prepare("INSERT OR IGNORE INTO attendance_days(user_id,date,status,first_login,manual_note) VALUES(?,?, 'Absent', NULL, 'Automatic end-of-day absence')").run(e.id, t);
      }
    }
    if (afterReport) {
      for (const e of employees) {
        const has = db.prepare('SELECT id FROM work_reports WHERE user_id=? AND work_date=?').get(e.id, t);
        const onLeave = db.prepare("SELECT id FROM leave_requests WHERE user_id=? AND leave_date=? AND status='Approved'").get(e.id, t);
        if (!has && !onLeave) notify(e.id, 'report_reminder', 'Daily report pending', `Please submit today's work report before the day is closed.`, 'work_report', null, `report_reminder:${t}:${e.id}`);
      }
    }
    // Sales follow-ups: remind the lead's owner (or the admins) once a day until the follow-up is done.
    const due = db
      .prepare("SELECT id,business_name,owner_id,next_follow_up FROM leads WHERE next_follow_up<>'' AND next_follow_up<=? AND stage NOT IN ('Won','Lost','Done')")
      .all(t);
    for (const l of due) {
      const title = l.next_follow_up < t ? 'Lead follow-up overdue' : 'Lead follow-up today';
      const body = `Follow up with ${l.business_name} (planned for ${l.next_follow_up}).`;
      if (l.owner_id) notify(l.owner_id, 'lead_followup', title, body, 'lead', l.id, `lead_followup:${t}:${l.id}`);
      else notifyAdmins('lead_followup', title, body, 'lead', l.id, `lead_followup:${t}:${l.id}`);
    }
    const y = t.slice(0, 4),
      m = t.slice(5, 7);
    const lastDay = new Date(Date.UTC(Number(y), Number(m), 0)).toISOString().slice(0, 10);
    if (t === lastDay && afterEnd) notifyAdmins('payroll_ready', 'Payroll ready for review', `Automatic payroll calculation for ${t.slice(0, 7)} is ready. Review deductions and mark payments when paid.`, 'payroll', null, `payroll_ready:${t.slice(0, 7)}`);
  } catch (e) {
    console.error('automationSweep', e.message);
  }
}

function startAutomationSweep() {
  setInterval(automationSweep, 60 * 1000);
  automationSweep();
}

module.exports = { automationSweep, startAutomationSweep };
