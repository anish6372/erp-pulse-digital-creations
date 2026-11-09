export const $ = (id) => document.getElementById(id);

export const esc = (s) =>
  String(s ?? '').replace(/[&<>'"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[m]));

export const dateNow = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

export const initials = (n) =>
  String(n || '')
    .split(' ')
    .map((x) => x[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

export function toast(t) {
  const el = $('toast');
  el.textContent = t;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 1800);
}

export function status(s) {
  let c = 'gray';
  if (['Done', 'Present', 'Approved', 'Paid'].includes(s)) c = 'green';
  else if (['Late / Half Day', 'Pending', 'In Progress'].includes(s)) c = 'yellow';
  else if (['Rejected', 'Absent', 'Blocked'].includes(s)) c = 'red';
  else if (['Leave', 'Selected'].includes(s)) c = 'purple';
  return `<span class="badge ${c}">${esc(s)}</span>`;
}

export function kpi(label, val, sub = '', icon = '') {
  const isTrustedHtml = typeof val === 'string' && /^<span class="badge /.test(val);
  const numeric = typeof val === 'number' || (/^-?\d+(\.\d+)?$/.test(String(val)) && String(val).trim() !== '');
  const displayVal = isTrustedHtml ? val : numeric ? '0' : esc(val);
  return `<div class="card kpi-card"><div class="k">${icon ? `<span class="kpi-ic">${icon}</span>` : ''}${esc(label)}</div><div class="kv" ${
    numeric ? `data-countup="${Number(val)}"` : ''
  }>${displayVal}</div><div class="ks">${esc(sub)}</div></div>`;
}

export function animateCountUps(root = document) {
  root.querySelectorAll('[data-countup]').forEach((el) => {
    const target = Number(el.dataset.countup);
    if (!Number.isFinite(target)) return;
    const duration = 650;
    const start = performance.now();
    const isInt = Number.isInteger(target);
    function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const current = target * eased;
      el.textContent = isInt ? Math.round(current) : current.toFixed(1);
      if (t < 1) requestAnimationFrame(tick);
      else el.textContent = isInt ? target : target.toFixed(1);
    }
    requestAnimationFrame(tick);
  });
}

export function openModal(title, bodyHtml, { wide = false } = {}) {
  $('modalTitle').textContent = title;
  $('modalBody').innerHTML = bodyHtml;
  $('modal').querySelector('.modalCard').classList.toggle('wide', wide);
  $('modal').classList.add('show');
}

export function closeModal() {
  $('modal').classList.remove('show');
  $('modalBody').innerHTML = '';
  document.dispatchEvent(new Event('modal-closed'));
}

// In-app replacement for window.confirm() - the native dialog always prefixes itself with
// the page's own hostname ("localhost:5173 says...", or the production domain), which looks
// broken/unprofessional and can't be removed or styled. This reuses the app's own modal shell.
export function confirmDialog(message, { title = 'Please Confirm', danger = true, confirmText = 'Confirm', cancelText = 'Cancel' } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      document.removeEventListener('modal-closed', onClosed);
      closeModal();
      resolve(val);
    };
    const onClosed = () => finish(false);
    document.addEventListener('modal-closed', onClosed);
    openModal(
      title,
      `<p style="white-space:pre-line;line-height:1.5">${esc(message)}</p>
       <div class="pnl" style="justify-content:flex-end;margin-top:16px;gap:8px">
         <button class="btn alt" id="confirmDialogNo">${esc(cancelText)}</button>
         <button class="btn ${danger ? 'danger' : ''}" id="confirmDialogYes">${esc(confirmText)}</button>
       </div>`
    );
    $('confirmDialogNo').onclick = () => finish(false);
    $('confirmDialogYes').onclick = () => finish(true);
  });
}
