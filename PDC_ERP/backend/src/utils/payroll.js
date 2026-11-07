const { db, getSetting } = require('../db');
const { today, firstOfMonth, dateRange, workingDay } = require('./datetime');

function calcMonthly(userId, month) {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(userId);
  if (!u) return null;
  const start = firstOfMonth(month);
  const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const currentMonth = today().slice(0, 7);
  const asOf = month === currentMonth ? today() : lastDay;
  const elapsedDates = dateRange(start, asOf).filter((d) => workingDay(d, '1,2,3,4,5,6'));
  const fullMonthWorkingDays = dateRange(start, lastDay).filter((d) => workingDay(d, '1,2,3,4,5,6'));
  const salary = Number(u.monthly_salary || 0);
  const divisorSetting = String(getSetting('salary_divisor', 'working_days'));
  const salaryDivisor = divisorSetting === 'working_days' ? Math.max(fullMonthWorkingDays.length, 1) : Math.max(Number(divisorSetting) || fullMonthWorkingDays.length, 1);
  const approved = db.prepare("SELECT * FROM leave_requests WHERE user_id=? AND leave_date BETWEEN ? AND ? AND status='Approved'").all(userId, start, asOf);
  const approvedMap = new Map(approved.map((x) => [x.leave_date, x]));
  const atts = db.prepare('SELECT * FROM attendance_days WHERE user_id=? AND date BETWEEN ? AND ?').all(userId, start, asOf);
  const attMap = new Map(atts.map((x) => [x.date, x]));
  let present = 0,
    half = 0,
    fullLeave = 0,
    absent = 0,
    pending = 0;
  for (const d of elapsedDates) {
    const approvedLeave = approvedMap.get(d);
    const st = attMap.get(d)?.status;
    if (approvedLeave?.leave_type === 'Full Day' || (!approvedLeave && st === 'Leave')) fullLeave++;
    else if (approvedLeave?.leave_type === 'Half Day' || (!approvedLeave && ['Half Day', 'Late / Half Day'].includes(st))) half++;
    else if (st === 'Present') present++;
    else if (st === 'Absent') absent++;
    else if (!st) pending++;
    else absent++;
  }
  const perDay = salary / salaryDivisor;
  const deductionUnits = absent + fullLeave + half * 0.5;
  const rawAttendanceDeduction = deductionUnits * perDay;
  const adjustment = Number(db.prepare('SELECT COALESCE(SUM(amount),0) total FROM payroll_adjustments WHERE user_id=? AND month=?').get(userId, month).total || 0);
  const allowance = Math.max(0, adjustment);
  const adjustmentDeduction = Math.max(0, -adjustment);
  const closure = db.prepare('SELECT closed_at FROM payroll_closures WHERE month=?').get(month);
  const isClosed = !!closure;
  const attendanceDeduction = isClosed ? rawAttendanceDeduction : 0;
  const appliedAdjustment = isClosed ? adjustment : 0;
  const totalDeductions = isClosed ? attendanceDeduction + adjustmentDeduction : 0;
  const net = isClosed ? Math.max(0, salary - totalDeductions + allowance) : salary;
  const taskStats = db
    .prepare(`SELECT COUNT(*) total, SUM(CASE WHEN status='Done' THEN 1 ELSE 0 END) done FROM tasks WHERE assignee_id=? AND due_date BETWEEN ? AND ?`)
    .get(userId, start, asOf);
  const workHours = db
    .prepare(`SELECT COALESCE(SUM((julianday(COALESCE(ended_at,datetime('now')))-julianday(started_at))*24),0) h FROM work_sessions WHERE user_id=? AND substr(started_at,1,7)=?`)
    .get(userId, month).h;
  const reportHours = db.prepare('SELECT COALESCE(SUM(hours),0) h FROM work_reports WHERE user_id=? AND work_date BETWEEN ? AND ?').get(userId, start, asOf).h;
  const paidUnits = present + half * 0.5;
  const attendancePct = elapsedDates.length ? Math.round((paidUnits / elapsedDates.length) * 100) : 0;
  return {
    user_id: userId,
    month,
    as_of: asOf,
    working_days: fullMonthWorkingDays.length,
    elapsed_working_days: elapsedDates.length,
    salary_divisor: salaryDivisor,
    salary_divisor_type: divisorSetting === 'working_days' ? 'working_days' : 'fixed',
    is_closed: isClosed,
    closed_at: closure?.closed_at || null,
    present,
    absent,
    half_day: half,
    full_leave: fullLeave,
    half_leave: half,
    pending_days: pending,
    base_salary: salary,
    per_day: Math.round(perDay * 100) / 100,
    deduction_units: Math.round(deductionUnits * 100) / 100,
    absent_deduction: Math.round((isClosed ? absent * perDay : 0) * 100) / 100,
    half_day_deduction: Math.round((isClosed ? fullLeave * perDay + half * perDay * 0.5 : 0) * 100) / 100,
    deduction: Math.round(attendanceDeduction * 100) / 100,
    adjustment: Math.round(appliedAdjustment * 100) / 100,
    raw_adjustment: Math.round(adjustment * 100) / 100,
    adjustment_deduction: Math.round((isClosed ? adjustmentDeduction : 0) * 100) / 100,
    allowances: Math.round((isClosed ? allowance : 0) * 100) / 100,
    total_deductions: Math.round(totalDeductions * 100) / 100,
    net_payable: Math.round(net * 100) / 100,
    tasks_assigned: taskStats.total || 0,
    tasks_done: taskStats.done || 0,
    work_hours: Math.round(Number(workHours || 0) * 100) / 100,
    reported_hours: Math.round(Number(reportHours || 0) * 100) / 100,
    attendance_pct: attendancePct,
  };
}

module.exports = { calcMonthly };
