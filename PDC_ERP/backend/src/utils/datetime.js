const { getSetting } = require('../db');

const now = () => new Date().toISOString();

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

const istHM = (iso = new Date().toISOString()) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));

function workingDay(date, defaultWorkWeek) {
  const d = new Date(date + 'T00:00:00Z');
  const day = d.getUTCDay();
  const n = day === 0 ? 7 : day;
  return getSetting('work_week', defaultWorkWeek).split(',').map(Number).includes(n);
}

function firstOfMonth(month) {
  return month + '-01';
}

function dateRange(start, end) {
  const out = [];
  let d = new Date(start + 'T00:00:00Z');
  const e = new Date(end + 'T00:00:00Z');
  while (d <= e) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

module.exports = { now, today, istHM, workingDay, firstOfMonth, dateRange };
