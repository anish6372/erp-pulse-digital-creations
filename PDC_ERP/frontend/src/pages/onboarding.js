// Admin side of new-joiner onboarding: invite -> joiner self-service (Aadhaar, selfie face check, NDA) -> review -> approve.
import { api } from '../lib/api.js';
import { state } from '../lib/state.js';
import { $, esc, dateNow, kpi, toast, openModal, closeModal, animateCountUps, confirmDialog } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { compareFaces, MATCH_THRESHOLD } from '../lib/face.js';
import { refresh } from '../router.js';

const DEPARTMENTS = ['General', 'Production', 'Creative', 'Client Relations', 'Client Management', 'HR / Operations', 'Sales', 'Management'];

const STATUS_BADGE = {
  Invited: 'gray',
  'In Progress': 'blue',
  Submitted: 'yellow',
  'Changes Requested': 'purple',
  Approved: 'green',
  Rejected: 'red',
};
const badge = (s) => `<span class="badge ${STATUS_BADGE[s] || 'gray'}">${esc(s)}</span>`;

let rows = [];
let filter = 'all';

const FILTERS = [
  ['all', 'All', () => true],
  ['review', 'Needs review', (r) => r.status === 'Submitted'],
  ['open', 'With joiner', (r) => ['Invited', 'In Progress', 'Changes Requested'].includes(r.status)],
  ['done', 'Closed', (r) => ['Approved', 'Rejected'].includes(r.status)],
];

const fmt = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '—');

// ---------------------------------------------------------------- helpers
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    // clipboard API needs https / localhost; fall back for LAN http deployments
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast('Copied');
}

// Identity images are admin-only and need the Bearer token, so they cannot be plain <img src>.
async function fetchImageUrl(id, kind) {
  const r = await fetch(`/api/onboarding/${id}/file/${kind}`, { headers: { Authorization: 'Bearer ' + state.token } });
  if (!r.ok) throw new Error('missing');
  return URL.createObjectURL(await r.blob());
}

let blobUrls = [];
function releaseBlobs() {
  blobUrls.forEach((u) => URL.revokeObjectURL(u));
  blobUrls = [];
}
// Don't leave identity images sitting in browser memory after the admin closes the dialog.
document.addEventListener('modal-closed', releaseBlobs);

function waLink(phone, name, link) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 10) return '';
  const num = digits.length === 10 ? '91' + digits : digits;
  const text = `Hi ${name}, welcome to Pulse Digital Creation! Please complete your joining formalities (ID verification, selfie and NDA) here: ${link}`;
  return `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
}

function stepChips(c) {
  const chip = (label, st) => `<span class="ob-chip ${st}">${st === 'done' ? '✓ ' : st === 'warn' ? '⚠ ' : ''}${label}</span>`;
  return `<div class="ob-chips">${chip('Details', c.details ? 'done' : '')}${chip('Aadhaar', c.aadhaar ? 'done' : '')}${chip(
    'Face',
    c.face === 'match' ? 'done' : c.face === 'review' ? 'warn' : ''
  )}${chip('NDA', c.nda ? 'done' : '')}</div>`;
}

// ---------------------------------------------------------------- page
export async function loadOnboarding() {
  if (state.me.role !== 'Admin') return;
  try {
    const d = await api('/api/onboarding');
    rows = d.rows || [];
    render();
  } catch (err) {
    $('page-onboarding').innerHTML = `<div class="card"><div class="err">Onboarding could not load: ${esc(err.message)}</div><button class="btn" id="obRetry">Try Again</button></div>`;
    $('obRetry').onclick = loadOnboarding;
  }
}

function actionButtons(r) {
  const b = [];
  if (r.status === 'Submitted') b.push(`<button class="btn" data-ob-review="${r.id}">Review</button>`);
  if (['Invited', 'In Progress', 'Changes Requested'].includes(r.status)) b.push(`<button class="btn alt" data-ob-link="${r.id}">New link</button>`);
  if (r.status === 'Approved') b.push(`<button class="btn alt" data-ob-review="${r.id}">View</button>`);
  if (r.status === 'Rejected') b.push(`<button class="btn alt" data-ob-review="${r.id}">View</button>`);
  if (r.status !== 'Approved') b.push(`<button class="btn alt" data-ob-del="${r.id}" title="Delete this onboarding">✕</button>`);
  return `<div class="pnl">${b.join('')}</div>`;
}

function render() {
  const count = (fn) => rows.filter(fn).length;
  const shown = rows.filter(FILTERS.find((f) => f[0] === filter)[2]);
  const awaiting = count((r) => r.status === 'Submitted');
  $('page-onboarding').innerHTML = `<div class="title"><h1>Employee Onboarding</h1><p>Invite a new joiner — they verify their Aadhaar with a live selfie, sign the NDA, and you approve to create their account.</p></div>
  <div class="grid g5" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">
    ${kpi('Awaiting your review', awaiting, awaiting ? 'action needed' : 'all caught up', icon('onboarding'))}
    ${kpi('With joiner', count((r) => ['Invited', 'In Progress', 'Changes Requested'].includes(r.status)), 'invited / in progress', icon('attendance'))}
    ${kpi('Approved', count((r) => r.status === 'Approved'), 'accounts created', icon('tasks'))}
    ${kpi('Rejected', count((r) => r.status === 'Rejected'), 'closed', icon('leaves'))}
  </div>
  <div class="card" style="margin-top:14px"><div class="sectionHead"><div><h3>New Joiners</h3><div class="mini">${rows.length} onboarding${rows.length === 1 ? '' : 's'}</div></div>
    <div class="pnl"><button class="btn alt" id="obNdaBtn">NDA template</button><button class="btn" id="obNewBtn">+ New Joiner</button></div></div>
    <div class="filters">${FILTERS.map((f) => `<button class="btn ${f[0] === filter ? '' : 'alt'}" data-ob-filter="${f[0]}">${f[1]}${f[0] === 'review' && awaiting ? ` (${awaiting})` : ''}</button>`).join('')}</div>
    <div class="tableWrap"><table class="table"><thead><tr><th>Joiner</th><th>Role</th><th>Progress</th><th>Status</th><th>Updated</th><th></th></tr></thead><tbody>${
      shown
        .map(
          (r) =>
            `<tr><td><b>${esc(r.full_name)}</b><div class="mini">${esc(r.email || r.phone || 'no contact')}</div></td><td>${esc(r.designation || '—')}<div class="mini">${esc(
              r.department || ''
            )}</div></td><td>${stepChips(r.checklist)}</td><td>${badge(r.status)}${
              r.status === 'Submitted' && r.face_match === 0 ? '<div class="mini" style="color:#92650a">face needs a look</div>' : ''
            }</td><td class="mini">${fmtDate(r.submitted_at || r.opened_at || r.created_at)}</td><td>${actionButtons(r)}</td></tr>`
        )
        .join('') || '<tr><td colspan="6" class="empty">Nothing here yet. Use “+ New Joiner” to start an onboarding.</td></tr>'
    }</tbody></table></div></div>`;

  $('obNewBtn').onclick = openInviteModal;
  $('obNdaBtn').onclick = openNdaTemplateModal;
  const root = $('page-onboarding');
  root.querySelectorAll('[data-ob-filter]').forEach((b) => (b.onclick = () => ((filter = b.dataset.obFilter), render())));
  root.querySelectorAll('[data-ob-review]').forEach((b) => (b.onclick = () => openReviewModal(Number(b.dataset.obReview))));
  root.querySelectorAll('[data-ob-link]').forEach((b) => (b.onclick = () => regenerateLink(Number(b.dataset.obLink))));
  root.querySelectorAll('[data-ob-del]').forEach((b) => (b.onclick = () => deleteOnboarding(Number(b.dataset.obDel))));
  animateCountUps(root); // render() also runs on filter clicks, outside the router's own count-up pass
}

// ---------------------------------------------------------------- invite
function openInviteModal() {
  openModal(
    'New Joiner',
    `<form id="obInviteForm"><div class="fgrid">
      <div class="field"><label>Full name *</label><input id="oi1" required></div>
      <div class="field"><label>Email</label><input id="oi2" type="email" placeholder="they will get the link by email if SMTP is set up"></div>
      <div class="field"><label>Phone / WhatsApp</label><input id="oi3" inputmode="tel" placeholder="98765 43210"></div>
      <div class="field"><label>Department</label><select id="oi4">${DEPARTMENTS.map((d) => `<option>${esc(d)}</option>`).join('')}</select></div>
      <div class="field"><label>Designation</label><input id="oi5"></div>
      <div class="field"><label>Joining date</label><input id="oi6" type="date" value="${dateNow()}"></div>
      <div class="field"><label>Employment type</label><input id="oi7" value="Full Time"></div>
      <div class="field"><label>Salary / month (₹)</label><input id="oi8" type="number" min="0" step="0.01" value="0"></div>
    </div><div class="mini">They get a personal link valid for 7 days. Nothing is created in HRMS until you approve their submission.</div>
    <button class="btn" style="margin-top:10px">Create & get link</button></form>`
  );
  $('obInviteForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    btn.disabled = true;
    try {
      const d = await api('/api/onboarding', {
        method: 'POST',
        body: JSON.stringify({
          full_name: $('oi1').value,
          email: $('oi2').value,
          phone: $('oi3').value,
          department: $('oi4').value,
          designation: $('oi5').value,
          joining_date: $('oi6').value,
          employment_type: $('oi7').value,
          monthly_salary: Number($('oi8').value || 0),
        }),
      });
      await loadOnboarding();
      showLinkModal($('oi1').value, $('oi3').value, d.link, d.emailed ? $('oi2').value : '');
    } catch (err) {
      toast(err.message || 'Could not create onboarding');
      btn.disabled = false;
    }
  });
}

function showLinkModal(name, phone, link, emailedTo, title = 'Onboarding link ready') {
  const wa = waLink(phone, name, link);
  openModal(
    title,
    `<div class="notice ok">${
      emailedTo ? `✉ Emailed to <b>${esc(emailedTo)}</b>. ` : ''
    }Send this personal link to <b>${esc(name)}</b>. It works once for them and expires in 7 days.</div>
    <div class="field"><label>Link</label><input id="obLinkInput" readonly value="${esc(link)}"></div>
    <div class="pnl"><button class="btn" id="obCopyLink">Copy link</button>${wa ? `<a class="btn success" href="${wa}" target="_blank" rel="noopener">Share on WhatsApp</a>` : ''}<button class="btn alt" id="obLinkDone">Done</button></div>
    <div class="mini" style="margin-top:10px">This link is shown only now — if you lose it, use “New link” on the onboarding row (that invalidates this one).</div>`
  );
  $('obLinkInput').onfocus = (e) => e.target.select();
  $('obCopyLink').onclick = () => copyText(link);
  $('obLinkDone').onclick = closeModal;
}

async function regenerateLink(id) {
  const r = rows.find((x) => x.id === id);
  if (!(await confirmDialog(`Generate a new link for ${r.full_name}? Their current link will stop working.`, { title: 'Regenerate Link', confirmText: 'Generate' }))) return;
  try {
    const d = await api(`/api/onboarding/${id}/regenerate`, { method: 'POST' });
    showLinkModal(r.full_name, r.phone, d.link, '', 'New onboarding link');
  } catch (err) {
    toast(err.message);
  }
}

async function deleteOnboarding(id) {
  const r = rows.find((x) => x.id === id);
  if (!(await confirmDialog(`Delete the onboarding for ${r.full_name}? Any uploaded ID documents are permanently removed.`, { title: 'Delete Onboarding', confirmText: 'Delete' }))) return;
  try {
    await api('/api/onboarding/' + id, { method: 'DELETE' });
    toast('Onboarding deleted');
    await loadOnboarding();
  } catch (err) {
    toast(err.message);
  }
}

// ---------------------------------------------------------------- NDA template
async function openNdaTemplateModal() {
  const d = await api('/api/onboarding/nda-template');
  openModal(
    'NDA template',
    `<div class="notice warn">This is a general-purpose starting template, not legal advice — have your lawyer review it. Changes apply to <b>new</b> signings only; agreements already signed keep the exact text the person saw.</div>
    <div class="mini" style="margin-bottom:6px">Placeholders: <code>{{name}}</code> <code>{{company}}</code> <code>{{designation}}</code> <code>{{date}}</code></div>
    <div class="field"><textarea id="ndaTpl" style="min-height:340px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px">${esc(d.template)}</textarea></div>
    <div class="pnl"><button class="btn" id="ndaSave">Save template</button>${d.is_default ? '' : '<button class="btn alt" id="ndaReset">Reset to default</button>'}</div>`,
    { wide: true }
  );
  if ($('ndaReset'))
    $('ndaReset').onclick = async () => {
      if (!(await confirmDialog('Replace your NDA text with the built-in default? Signed agreements are not affected.', { title: 'Reset NDA Template', confirmText: 'Reset', danger: false }))) return;
      try {
        await api('/api/onboarding/nda-template', { method: 'PUT', body: JSON.stringify({ reset: true }) });
        closeModal();
        toast('NDA template reset to default');
      } catch (err) {
        toast(err.message);
      }
    };
  $('ndaSave').onclick = async () => {
    try {
      await api('/api/onboarding/nda-template', { method: 'PUT', body: JSON.stringify({ template: $('ndaTpl').value }) });
      closeModal();
      toast('NDA template saved');
    } catch (err) {
      toast(err.message);
    }
  };
}

// ---------------------------------------------------------------- review
async function openReviewModal(id) {
  let o;
  try {
    o = await api('/api/onboarding/' + id);
  } catch (err) {
    return toast(err.message);
  }
  releaseBlobs();
  const submitted = o.status === 'Submitted';
  const approvedUser = o.user_id ? state.boot.users.find((u) => u.id === o.user_id) : null;
  const photo = (key, label, has) =>
    `<div class="ob-doc"><div class="mini"><b>${label}</b></div>${
      has ? `<div class="ob-doc-img" id="img_${key}"><span class="mini">Loading…</span></div>` : '<div class="ob-doc-img empty">Not provided / deleted</div>'
    }</div>`;

  openModal(
    `Onboarding — ${o.full_name}`,
    `<div class="row" style="justify-content:space-between;margin-bottom:10px"><div>${badge(o.status)} <span class="mini">Submitted ${fmt(o.submitted_at)}</span></div>${
      approvedUser ? `<span class="badge green">Employee ID ${esc(approvedUser.employee_code)}</span>` : ''
    }</div>
    ${o.status === 'Changes Requested' ? `<div class="notice warn"><b>Sent back:</b> ${esc(o.review_note)}</div>` : ''}
    ${o.status === 'Rejected' && o.review_note ? `<div class="notice warn"><b>Rejected:</b> ${esc(o.review_note)}</div>` : ''}

    <h4 class="ob-sec">Identity verification</h4>
    <div class="ob-docs">${photo('aadhaar_front', 'Aadhaar — front', o.has_aadhaar_front)}${photo('aadhaar_back', 'Aadhaar — back', o.has_aadhaar_back)}${photo('selfie', 'Live selfie', o.has_selfie)}</div>
    <div class="statline"><span>Aadhaar number</span><b>${esc(o.aadhaar_masked || '—')} <span class="mini">(full number is never stored)</span></b></div>
    <div class="statline"><span>Face match — joiner’s device</span><b>${
      o.face_score === null || o.face_score === undefined
        ? '<span class="badge gray">Not comparable</span>'
        : `${o.face_match ? '<span class="badge green">Match</span>' : '<span class="badge yellow">Low match</span>'} <span class="mini">distance ${Number(o.face_score).toFixed(2)}</span>`
    }</b></div>
    <div class="statline"><span>Face match — re-checked here</span><b id="obFaceRecheck"><span class="mini">${o.has_aadhaar_front && o.has_selfie ? 'Running…' : 'No images to compare'}</span></b></div>
    <div class="mini" style="margin:6px 0 2px">Automated matching is a guide, not proof. Government ID photos are small and often old — always compare the pictures yourself before approving. The ID number is not verified with UIDAI.</div>

    <h4 class="ob-sec">Details</h4>
    <div class="fgrid" style="gap:0 24px">
      <div class="statline"><span>Phone</span><b>${esc(o.phone || '—')}</b></div><div class="statline"><span>Email</span><b>${esc(o.email || '—')}</b></div>
      <div class="statline"><span>Date of birth</span><b>${esc(o.dob || '—')}</b></div><div class="statline"><span>Emergency contact</span><b>${esc(o.emergency_name || '—')} ${esc(o.emergency_phone || '')}</b></div>
      <div class="statline full"><span>Address</span><b style="text-align:right;max-width:70%">${esc(o.address || '—')}</b></div>
    </div>

    <h4 class="ob-sec">NDA</h4>
    <div class="statline"><span>Signed</span><b>${o.nda_signed_at ? `${esc(o.nda_signed_name)} — ${fmt(o.nda_signed_at)}` : '<span class="badge gray">Not signed</span>'}</b></div>
    ${o.nda_signed_at ? `<div style="margin-top:8px"><button class="btn alt" id="obViewNda">View signed NDA</button></div>` : ''}

    ${
      submitted
        ? `<h4 class="ob-sec">Decision</h4>
    <div class="fgrid">
      <div class="field"><label>Designation</label><input id="ra1" value="${esc(o.designation)}"></div>
      <div class="field"><label>Department</label><input id="ra2" value="${esc(o.department)}"></div>
      <div class="field"><label>Joining date</label><input id="ra3" type="date" value="${esc(o.joining_date || dateNow())}"></div>
      <div class="field"><label>Salary / month (₹)</label><input id="ra4" type="number" min="0" step="0.01" value="${o.monthly_salary || 0}"></div>
      <div class="field full"><label>Note to joiner (required to send back; optional when rejecting)</label><textarea id="raNote" style="min-height:60px" placeholder="e.g. Selfie is blurry — please retake in better light"></textarea></div>
    </div>
    <div class="pnl" style="margin-top:6px"><button class="btn success" id="raApprove">Approve & create employee account</button><button class="btn alt" id="raChanges">Send back for changes</button><button class="btn danger" id="raReject">Reject</button></div>`
        : o.status === 'Approved' && (o.has_aadhaar_front || o.has_aadhaar_back || o.has_selfie)
        ? `<div class="notice" style="margin-top:14px">Identity verification is complete. To keep less personal data on file, you can permanently delete the Aadhaar and selfie images (the signed NDA is kept).<div style="margin-top:8px"><button class="btn danger" id="raPurge">Delete ID images</button></div></div>`
        : ''
    }`,
    { wide: true }
  );

  // images + independent face re-check (runs in the admin's browser, so it can't be spoofed by the joiner)
  const loaded = {};
  await Promise.all(
    [
      ['aadhaar_front', o.has_aadhaar_front],
      ['aadhaar_back', o.has_aadhaar_back],
      ['selfie', o.has_selfie],
    ]
      .filter(([, has]) => has)
      .map(async ([key]) => {
        try {
          const url = await fetchImageUrl(id, key);
          blobUrls.push(url);
          loaded[key] = url;
          const box = $('img_' + key);
          if (box) box.innerHTML = `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="${key}"></a>`;
        } catch (e) {
          const box = $('img_' + key);
          if (box) box.innerHTML = '<span class="mini">Could not load</span>';
        }
      })
  );
  if (loaded.aadhaar_front && loaded.selfie) recheckFace(loaded.aadhaar_front, loaded.selfie);

  if ($('obViewNda')) $('obViewNda').onclick = () => openNdaDocModal(id);
  if (submitted) {
    $('raApprove').onclick = () => decide(id, 'approve', o);
    $('raChanges').onclick = () => decide(id, 'request-changes', o);
    $('raReject').onclick = () => decide(id, 'reject', o);
  }
  if ($('raPurge'))
    $('raPurge').onclick = async () => {
      if (!(await confirmDialog('Permanently delete the Aadhaar and selfie images for ' + o.full_name + '? This cannot be undone.', { title: 'Delete ID Images', confirmText: 'Delete' }))) return;
      try {
        await api(`/api/onboarding/${id}/documents`, { method: 'DELETE' });
        toast('ID images deleted');
        await loadOnboarding();
        closeModal();
      } catch (err) {
        toast(err.message);
      }
    };
}

async function recheckFace(idUrl, selfieUrl) {
  const el = $('obFaceRecheck');
  try {
    const r = await compareFaces(idUrl, selfieUrl);
    if (!$('obFaceRecheck')) return; // modal closed meanwhile
    const msgs = {
      no_id_face: '<span class="badge gray">No face found on ID image</span>',
      no_selfie_face: '<span class="badge red">No face found in selfie</span>',
      multiple_selfie_faces: '<span class="badge red">Several faces in selfie</span>',
    };
    el.innerHTML =
      r.status === 'ok'
        ? `${r.match ? '<span class="badge green">Match</span>' : '<span class="badge yellow">Low match</span>'} <span class="mini">distance ${r.distance.toFixed(2)} (match below ${MATCH_THRESHOLD})</span>`
        : msgs[r.status];
  } catch (e) {
    if (el) el.innerHTML = '<span class="badge gray">Unavailable</span> <span class="mini">face model could not load — compare by eye</span>';
  }
}

async function decide(id, action, o) {
  const note = $('raNote').value.trim();
  if (action === 'request-changes' && !note) return toast('Write what the joiner should fix');
  if (action === 'reject' && !(await confirmDialog(`Reject ${o.full_name}? Their link stops working.`, { title: 'Reject Applicant', confirmText: 'Reject' }))) return;
  const btns = [$('raApprove'), $('raChanges'), $('raReject')];
  btns.forEach((b) => (b.disabled = true));
  try {
    if (action === 'approve') {
      const d = await api(`/api/onboarding/${id}/approve`, {
        method: 'POST',
        body: JSON.stringify({
          designation: $('ra1').value,
          department: $('ra2').value,
          joining_date: $('ra3').value,
          monthly_salary: Number($('ra4').value || 0),
        }),
      });
      await refresh(); // reloads users (HRMS) and re-renders this page
      showCredentials(o, d);
      return;
    }
    const d = await api(`/api/onboarding/${id}/${action}`, { method: 'POST', body: JSON.stringify({ note }) });
    await loadOnboarding();
    if (action === 'request-changes') showLinkModal(o.full_name, o.phone, d.link, '', 'Sent back — new link');
    else {
      closeModal();
      toast('Onboarding rejected');
    }
  } catch (err) {
    toast(err.message);
    btns.forEach((b) => (b.disabled = false));
  }
}

function showCredentials(o, d) {
  releaseBlobs();
  const msg = `Welcome to Pulse Digital Creation, ${o.full_name}! Your ERP login:\nEmployee ID: ${d.employee_code}\nTemporary password: ${d.temp_password}\nSign in with your Employee ID (or email) and this password.`;
  openModal(
    'Account created',
    `<div class="notice ok">✅ <b>${esc(o.full_name)}</b> is now an employee.</div>
    <div class="statline"><span>Employee ID</span><b>${esc(d.employee_code)}</b></div>
    <div class="statline"><span>Temporary password</span><b style="font-family:ui-monospace,Menlo,Consolas,monospace">${esc(d.temp_password)}</b></div>
    <div class="notice warn" style="margin-top:12px">This password is shown <b>only once</b> and is not emailed. Give it to ${esc(o.full_name)} securely. You can reset it later from HRMS → Edit.</div>
    <div class="pnl"><button class="btn" id="crCopy">Copy login details</button><button class="btn alt" id="crDone">Done</button></div>`
  );
  $('crCopy').onclick = () => copyText(msg);
  $('crDone').onclick = closeModal;
}

// ---------------------------------------------------------------- signed NDA document
async function openNdaDocModal(id) {
  const o = await api('/api/onboarding/' + id);
  let sig = '';
  try {
    sig = await fetchImageUrl(id, 'signature');
    blobUrls.push(sig);
  } catch (e) {
    /* signature missing */
  }
  openModal(
    'Signed NDA',
    `<div class="nda-doc"><div class="nda-doc-text">${esc(o.nda_text)}</div>
    <div class="nda-sign">${sig ? `<img src="${sig}" alt="Signature">` : ''}<div><b>${esc(o.nda_signed_name)}</b><div class="mini">Signed electronically on ${fmt(o.nda_signed_at)}</div></div></div>
    <div class="mini nda-evidence">Document fingerprint (SHA-256): ${esc(o.nda_text_hash)}<br>Signed from IP ${esc(o.nda_ip || 'unknown')} · ${esc((o.nda_user_agent || '').slice(0, 120))}</div></div>
    <div class="pnl noprint" style="margin-top:12px"><button class="btn" id="ndaPrint">Print / Save as PDF</button><button class="btn alt" id="ndaBack">Back</button></div>`,
    { wide: true }
  );
  $('ndaBack').onclick = () => openReviewModal(id);
  $('ndaPrint').onclick = () => {
    document.body.classList.add('print-nda');
    window.addEventListener('afterprint', () => document.body.classList.remove('print-nda'), { once: true });
    window.print();
  };
}
