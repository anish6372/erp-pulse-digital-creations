import { api } from '../lib/api.js';
import { state } from '../lib/state.js';
import { $, esc, dateNow, status, kpi, toast, confirmDialog } from '../lib/dom.js';
import { cache } from '../lib/cache.js';
import { openUserModal } from '../components/modals.js';

export async function renderPayroll() {
  if (state.me.role !== 'Admin') return;
  $('page-payroll').innerHTML = `<div class="title"><h1>Payroll</h1><p>Monthly salary stays untouched during the month. Attendance deductions are applied only after Admin finalizes the month.</p></div>
  <div class="pay-grid">
    <div class="card"><div class="sectionHead"><div><h3>Monthly Payroll</h3><div class="mini">Live attendance • salary • month-end finalization</div></div><div class="filters"><input type="month" id="payMonth" value="${dateNow().slice(
      0,
      7
    )}"><button class="btn" id="payRefreshBtn">Refresh</button></div></div><div id="payBody"></div></div>
    <div class="card salary-calc"><div class="sectionHead"><div><h3>Salary Calculator</h3><div class="mini">Estimate only — does not change payroll</div></div></div>
      <div class="field"><label>Employee</label><select id="calcEmployee"></select></div>
      <div class="field"><label>Monthly Salary (₹)</label><input id="calcSalary" type="number" min="0" value="0"></div>
      <div class="field"><label>Working Days</label><input id="calcDays" type="number" min="1" value="26"></div>
      <div class="field"><label>Present Days</label><input id="calcPresent" type="number" min="0" value="0"></div>
      <div class="field"><label>Full Leave / Unpaid Days</label><input id="calcLeave" type="number" min="0" value="0"></div>
      <div class="field"><label>Half Days</label><input id="calcHalf" type="number" min="0" value="0"></div>
      <div class="field"><label>Calculated Absent Days</label><input id="calcAbsent" type="number" readonly value="0"></div>
      <div class="notice" style="margin-top:2px">Absent days are calculated automatically from working days − present − leave − half day.</div>
      <div class="calc-result"><div><span>Per day</span><b id="calcPerDay">₹0</b></div><div><span>Deduction at month end</span><b id="calcDeduction">₹0</b></div><div><span>Net after deduction</span><b id="calcNet">₹0</b></div></div>
    </div>
  </div>`;
  $('payRefreshBtn').onclick = loadPayroll;
  $('calcEmployee').onchange = loadCalculatorEmployee;
  ['calcSalary', 'calcDays', 'calcPresent', 'calcLeave', 'calcHalf'].forEach((id) => ($(id).oninput = runSalaryCalculator));
  await loadPayroll();
  loadCalculatorEmployee();
}

async function loadPayroll() {
  const month = $('payMonth').value;
  const d = await api('/api/payroll?month=' + month);
  const rows = d.rows
    .map(
      (r) =>
        `<tr><td><b>${esc(r.name || '')}</b><div class="mini">${r.present} present / ${r.working_days} working days</div></td><td><b>₹${Number(r.base_salary || 0).toLocaleString(
          'en-IN'
        )}</b></td><td>${r.present}</td><td>${r.half_day}</td><td>${r.full_leave}</td><td>${r.absent}</td><td>${
          d.closed ? '₹' + Number(r.deduction || 0).toLocaleString('en-IN') : '—'
        }</td><td><b>₹${Number(d.closed ? r.net_payable : r.base_salary).toLocaleString('en-IN')}</b></td><td>${status(r.payment_status)} ${
          d.closed
            ? r.payment_status === 'Paid'
              ? `<button class="btn alt" data-unpay="${r.user_id}|${month}">Unmark</button>`
              : `<button class="btn success" data-pay="${r.user_id}|${month}">Mark Paid</button>`
            : ''
        }</td><td><button class="btn alt" data-edit-salary="${r.user_id}">Edit Salary</button></td></tr>`
    )
    .join('');
  const statusText = d.closed ? 'FINALIZED — deductions are applied' : 'OPEN — no deductions are applied yet';
  cache.payrollRows = d.rows;
  const ce = $('calcEmployee');
  if (ce) {
    const old = ce.value;
    ce.innerHTML = d.rows.map((r) => `<option value="${r.user_id}">${esc(r.name)}</option>`).join('');
    if (old && d.rows.some((r) => String(r.user_id) === old)) ce.value = old;
  }
  $('payBody').innerHTML = `<div class="pay-status ${d.closed ? 'closed' : 'open'}"><b>${statusText}</b><span>${
    d.closed ? `Closed ${new Date(d.closed_at).toLocaleString('en-IN')}` : 'Salary remains 100% until month-end finalization.'
  }</span><button class="btn ${d.closed ? 'alt' : 'danger'}" id="payFinalizeBtn">${d.closed ? 'Re-open Month' : 'Finalize Month'}</button></div><div class="grid g5" style="margin-bottom:12px">${kpi(
    'Monthly Salary',
    '₹' + d.totals.gross.toLocaleString('en-IN'),
    'total base salary'
  )}${kpi('Present Days', d.rows.reduce((a, b) => a + b.present, 0), 'actual attendance')}${kpi(
    'Deductions',
    d.closed ? '₹' + d.totals.deductions.toLocaleString('en-IN') : '₹0',
    'month-end only'
  )}${kpi('Net Payable', '₹' + (d.closed ? d.totals.net_payable : d.totals.gross).toLocaleString('en-IN'), d.closed ? 'after deduction' : 'currently payable')}${kpi(
    'Month',
    month,
    d.closed ? 'finalized' : 'open'
  )}</div><div class="tableWrap"><table class="table"><thead><tr><th>Employee</th><th>Salary</th><th>Present</th><th>Half Day</th><th>Leave</th><th>Absent</th><th>Deduction</th><th>Net Salary</th><th>Payment</th><th>Edit</th></tr></thead><tbody>${
    rows || '<tr><td colspan="10" class="empty">No active employees.</td></tr>'
  }</tbody></table></div>`;
  $('payFinalizeBtn').onclick = d.closed ? reopenPayroll : finalizePayroll;
  $('payBody')
    .querySelectorAll('[data-pay]')
    .forEach((b) => (b.onclick = () => setPayment(...b.dataset.pay.split('|'), 'Paid')));
  $('payBody')
    .querySelectorAll('[data-unpay]')
    .forEach((b) => (b.onclick = () => setPayment(...b.dataset.unpay.split('|'), 'Pending')));
  $('payBody')
    .querySelectorAll('[data-edit-salary]')
    .forEach((b) => (b.onclick = () => openUserModal(Number(b.dataset.editSalary))));
}

async function setPayment(userId, month, statusValue) {
  try {
    await api('/api/payroll/payment', { method: 'POST', body: JSON.stringify({ user_id: Number(userId), month, status: statusValue }) });
    toast(statusValue === 'Paid' ? 'Marked as paid' : 'Marked as pending');
    await loadPayroll();
  } catch (e) {
    toast(e.message || 'Payment update failed');
  }
}

function loadCalculatorEmployee() {
  const id = Number($('calcEmployee')?.value || 0);
  const r = cache.payrollRows.find((x) => x.user_id === id);
  if (!r) return;
  $('calcSalary').value = r.base_salary || 0;
  $('calcDays').value = r.working_days || 1;
  $('calcPresent').value = r.present || 0;
  $('calcLeave').value = r.full_leave || 0;
  $('calcHalf').value = r.half_day || 0;
  runSalaryCalculator();
}

function runSalaryCalculator() {
  const salary = Number($('calcSalary')?.value || 0);
  const days = Math.max(1, Number($('calcDays')?.value || 1));
  const present = Math.max(0, Number($('calcPresent')?.value || 0));
  const leave = Math.max(0, Number($('calcLeave')?.value || 0));
  const half = Math.max(0, Number($('calcHalf')?.value || 0));
  const absent = Math.max(0, days - present - leave - half);
  const perDay = salary / days;
  const deduction = (absent + leave + half * 0.5) * perDay;
  const net = Math.max(0, salary - deduction);
  if ($('calcAbsent')) $('calcAbsent').value = absent;
  if ($('calcPerDay')) $('calcPerDay').textContent = '₹' + perDay.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  if ($('calcDeduction')) $('calcDeduction').textContent = '₹' + deduction.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  if ($('calcNet')) $('calcNet').textContent = '₹' + net.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

async function finalizePayroll() {
  const month = $('payMonth').value;
  if (!(await confirmDialog(`Finalize ${month}? This will apply absence/leave/half-day deductions.`, { title: 'Finalize Payroll', confirmText: 'Finalize', danger: false }))) return;
  try {
    await api('/api/payroll/close', { method: 'POST', body: JSON.stringify({ month }) });
    toast('Payroll month finalized');
    await loadPayroll();
  } catch (e) {
    toast(e.message);
  }
}

async function reopenPayroll() {
  const month = $('payMonth').value;
  if (!(await confirmDialog(`Re-open ${month}? Deductions will stop applying until finalized again.`, { title: 'Re-open Payroll', confirmText: 'Re-open', danger: false }))) return;
  try {
    await api('/api/payroll/reopen', { method: 'POST', body: JSON.stringify({ month }) });
    toast('Payroll month re-opened');
    await loadPayroll();
  } catch (e) {
    toast(e.message);
  }
}
