// Sales pipeline for the cafes and restaurants the agency is pitching - Admin and the
// Digital Marketing department.
import { api } from '../lib/api.js';
import { state } from '../lib/state.js';
import { $, esc, initials, toast, openModal, closeModal, dateNow, kpi, animateCountUps, confirmDialog } from '../lib/dom.js';
import { icon } from '../lib/icons.js';

let data = { leads: [], packages: [], stages: [], types: [] };
let filter = { q: '', type: '' };

const money = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
const monthOf = (iso) => String(iso || '').slice(0, 7);

function followUpChip(l) {
  if (!l.next_follow_up || ['Won', 'Lost'].includes(l.stage)) return '';
  const t = dateNow();
  if (l.next_follow_up < t) return `<span class="badge red">Overdue ${esc(l.next_follow_up.slice(5))}</span>`;
  if (l.next_follow_up === t) return '<span class="badge yellow">Follow up today</span>';
  return `<span class="badge gray">Follow up ${esc(l.next_follow_up.slice(5))}</span>`;
}

export async function renderLeads() {
  const canSeeLeads = state.me.role === 'Admin' || String(state.me.department || '').toLowerCase() === 'digital marketing';
  if (!canSeeLeads) return;
  try {
    data = await api('/api/leads');
  } catch (e) {
    $('page-leads').innerHTML = `<div class="card"><div class="err">Leads could not load: ${esc(e.message)}</div></div>`;
    return;
  }
  paint();
}

function visibleLeads() {
  const q = filter.q.trim().toLowerCase();
  return data.leads.filter(
    (l) =>
      (!filter.type || l.business_type === filter.type) &&
      (!q || [l.business_name, l.contact_name, l.area, l.phone].some((v) => String(v || '').toLowerCase().includes(q)))
  );
}

function paint() {
  const all = data.leads;
  const open = all.filter((l) => !['Won', 'Lost'].includes(l.stage));
  const t = dateNow();
  const wonThisMonth = all.filter((l) => l.stage === 'Won' && monthOf(l.updated_at) === t.slice(0, 7));
  const overdue = open.filter((l) => l.next_follow_up && l.next_follow_up < t).length;
  const won = all.filter((l) => l.stage === 'Won').length;
  const lost = all.filter((l) => l.stage === 'Lost').length;
  const winRate = won + lost ? Math.round((won / (won + lost)) * 100) : 0;
  const leads = visibleLeads();

  $('page-leads').innerHTML = `
    <div class="title"><h1>Leads</h1><p>Every cafe and restaurant you are pitching, from first contact to signed client. Drag a card to move it along.</p></div>
    <div class="grid g5" style="margin-bottom:14px">
      ${kpi('Open leads', open.length, 'still being worked')}
      ${kpi('Pipeline value', money(open.reduce((a, l) => a + l.monthly_value, 0)), 'per month, open leads')}
      ${kpi('Won this month', wonThisMonth.length, money(wonThisMonth.reduce((a, l) => a + l.monthly_value, 0)) + ' per month')}
      ${kpi('Follow-ups overdue', overdue, overdue ? 'call these first' : 'all caught up')}
      ${kpi('Win rate', winRate + '%', `${won} won, ${lost} lost`)}
    </div>
    <div class="card">
      <div class="sectionHead">
        <div class="pnl">
          <input id="leadSearch" class="ig-client" placeholder="Search name, area, phone" value="${esc(filter.q)}" style="min-width:230px">
          <select id="leadType" class="ig-client"><option value="">All types</option>${data.types.map((x) => `<option ${filter.type === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
        </div>
        <div class="pnl"><button class="btn alt" id="pkgBtn">Packages</button><button class="btn" id="addLeadBtn">${icon('plus')}<span>Add lead</span></button></div>
      </div>
      <div class="lead-board">${data.stages
        .map((stage) => {
          const col = leads.filter((l) => l.stage === stage);
          const val = col.reduce((a, l) => a + l.monthly_value, 0);
          return `<div class="lead-col" data-stage="${esc(stage)}"><div class="lead-colhead"><b>${esc(stage)}</b><span class="badge gray">${col.length}</span></div><div class="mini" style="margin:-4px 0 8px">${money(val)} / month</div>${
            col
              .map(
                (l) => `<div class="lead-card" draggable="true" data-id="${l.id}">
                  <div class="lead-top"><b>${esc(l.business_name)}</b><span class="badge blue">${esc(l.business_type)}</span></div>
                  <div class="mini">${esc([l.area, l.contact_name].filter(Boolean).join(' · ') || 'No contact yet')}</div>
                  <div class="lead-foot"><span class="lead-val">${l.monthly_value ? money(l.monthly_value) : '—'}</span>${followUpChip(l)}${
                    l.owner_name ? `<span class="avatar" title="${esc(l.owner_name)}" style="width:24px;height:24px;font-size:9px">${esc(initials(l.owner_name))}</span>` : ''
                  }</div>
                </div>`
              )
              .join('') || '<div class="empty" style="padding:14px 6px">Drop a lead here</div>'
          }</div>`;
        })
        .join('')}</div>
    </div>`;
  animateCountUps($('page-leads'));

  $('leadSearch').oninput = (e) => {
    filter.q = e.target.value;
    paint();
    const el = $('leadSearch');
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  };
  $('leadType').onchange = (e) => {
    filter.type = e.target.value;
    paint();
  };
  $('addLeadBtn').onclick = () => openLeadModal();
  $('pkgBtn').onclick = openPackages;

  // drag and drop between stages
  const cards = $('page-leads').querySelectorAll('.lead-card');
  cards.forEach((c) => {
    c.onclick = () => openLeadModal(Number(c.dataset.id));
    c.ondragstart = (e) => {
      e.dataTransfer.setData('text/plain', c.dataset.id);
      c.classList.add('dragging');
    };
    c.ondragend = () => c.classList.remove('dragging');
  });
  $('page-leads')
    .querySelectorAll('.lead-col')
    .forEach((col) => {
      col.ondragover = (e) => {
        e.preventDefault();
        col.classList.add('over');
      };
      col.ondragleave = () => col.classList.remove('over');
      col.ondrop = (e) => {
        e.preventDefault();
        col.classList.remove('over');
        moveLead(Number(e.dataTransfer.getData('text/plain')), col.dataset.stage);
      };
    });
}

async function moveLead(id, stage) {
  const l = data.leads.find((x) => x.id === id);
  if (!l || l.stage === stage) return;
  const body = { stage };
  if (stage === 'Lost') {
    const why = prompt('Why was this lead lost? (so you can learn from it)');
    if (!why || !why.trim()) return toast('Lead not moved — a reason is needed');
    body.lost_reason = why.trim();
  }
  try {
    await api('/api/leads/' + id, { method: 'PUT', body: JSON.stringify(body) });
    toast(`Moved to ${stage}`);
    await renderLeads();
  } catch (e) {
    toast(e.message || 'Could not move lead');
  }
}

function openLeadModal(id) {
  const l = id ? data.leads.find((x) => x.id === id) : null;
  const users = state.boot.users.filter((u) => u.active);
  openModal(
    l ? l.business_name : 'Add lead',
    `<form id="leadForm"><div class="fgrid">
      <div class="field"><label>Business name *</label><input id="lf1" required value="${esc(l?.business_name || '')}"></div>
      <div class="field"><label>Type</label><select id="lf2">${data.types.map((x) => `<option ${l?.business_type === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></div>
      <div class="field"><label>Contact person</label><input id="lf3" value="${esc(l?.contact_name || '')}"></div>
      <div class="field"><label>Phone / WhatsApp</label><input id="lf4" value="${esc(l?.phone || '')}"></div>
      <div class="field"><label>Email</label><input id="lf5" type="email" value="${esc(l?.email || '')}"></div>
      <div class="field"><label>Area</label><input id="lf6" placeholder="e.g. Indiranagar" value="${esc(l?.area || '')}"></div>
      <div class="field"><label>How you found them</label><input id="lf7" placeholder="Instagram DM, walk-in, referral" value="${esc(l?.source || '')}"></div>
      <div class="field"><label>Stage</label><select id="lf8">${data.stages.map((x) => `<option ${(l?.stage || 'New') === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></div>
      <div class="field"><label>Package</label><select id="lf9"><option value="">Not decided</option>${data.packages
        .map((p) => `<option value="${p.id}" data-price="${p.price}" ${l?.package_id === p.id ? 'selected' : ''}>${esc(p.name)} · ${p.reels_per_month} reels · ${money(p.price)}</option>`)
        .join('')}</select></div>
      <div class="field"><label>Monthly value (₹)</label><input id="lf10" type="number" min="0" value="${l?.monthly_value || 0}"></div>
      <div class="field"><label>Next follow-up</label><input id="lf11" type="date" value="${esc(l?.next_follow_up || '')}"></div>
      <div class="field"><label>Owner</label><select id="lf12">${users.map((u) => `<option value="${u.id}" ${(l?.owner_id || state.me.id) === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></div>
      ${l?.stage === 'Lost' ? `<div class="field full"><label>Why it was lost</label><input id="lf13" value="${esc(l.lost_reason || '')}"></div>` : ''}
      <div class="field full"><label>Notes</label><textarea id="lf14">${esc(l?.notes || '')}</textarea></div>
    </div>
    <div class="pnl" style="margin-top:10px"><button class="btn">Save lead</button>${
      l && !l.converted_client_id && l.stage === 'Won' ? '<button class="btn success" type="button" id="convertBtn">Convert to client</button>' : ''
    }${l?.converted_client_id ? '<span class="badge green">Already a client</span>' : ''}${l ? '<button class="btn danger" type="button" id="delLeadBtn">Delete</button>' : ''}</div></form>
    ${l ? '<div id="actBox" style="margin-top:18px"></div>' : ''}`,
    { wide: true }
  );
  // choosing a package suggests its price, but the value stays editable
  $('lf9').onchange = (e) => {
    const price = e.target.selectedOptions[0]?.dataset.price;
    if (price && !Number($('lf10').value)) $('lf10').value = price;
  };
  $('leadForm').addEventListener('submit', (e) => saveLead(e, id));
  if (l) {
    $('delLeadBtn').onclick = async () => {
      if (!(await confirmDialog('Delete this lead and its history?', { title: 'Delete Lead', confirmText: 'Delete' }))) return;
      await api('/api/leads/' + id, { method: 'DELETE' });
      closeModal();
      renderLeads();
    };
    if ($('convertBtn'))
      $('convertBtn').onclick = async () => {
        try {
          await api(`/api/leads/${id}/convert`, { method: 'POST' });
          const boot = await api('/api/bootstrap');
          state.boot = boot;
          closeModal();
          toast('Now a client — you can add tasks and content for them');
          renderLeads();
        } catch (err) {
          toast(err.message || 'Could not convert');
        }
      };
    loadActivities(id);
  }
}

async function saveLead(e, id) {
  e.preventDefault();
  const btn = e.submitter;
  const b = {
    business_name: $('lf1').value,
    business_type: $('lf2').value,
    contact_name: $('lf3').value,
    phone: $('lf4').value,
    email: $('lf5').value,
    area: $('lf6').value,
    source: $('lf7').value,
    stage: $('lf8').value,
    package_id: $('lf9').value || null,
    monthly_value: Number($('lf10').value || 0),
    next_follow_up: $('lf11').value,
    owner_id: Number($('lf12').value),
    notes: $('lf14').value,
  };
  if ($('lf13')) b.lost_reason = $('lf13').value;
  if (b.stage === 'Lost' && !b.lost_reason) {
    const why = prompt('Why was this lead lost?');
    if (!why || !why.trim()) return toast('A reason is needed to mark a lead as lost');
    b.lost_reason = why.trim();
  }
  try {
    if (btn) btn.disabled = true;
    if (id) await api('/api/leads/' + id, { method: 'PUT', body: JSON.stringify(b) });
    else await api('/api/leads', { method: 'POST', body: JSON.stringify(b) });
    closeModal();
    toast('Lead saved');
    await renderLeads();
  } catch (err) {
    toast(err.message || 'Could not save lead');
  } finally {
    if (btn) btn.disabled = false;
  }
}

const KIND_ICON = { note: 'Note', call: 'Call', whatsapp: 'WhatsApp', meeting: 'Meeting', email: 'Email', stage: 'Stage' };

async function loadActivities(id) {
  const box = $('actBox');
  if (!box) return;
  let rows = [];
  try {
    rows = (await api(`/api/leads/${id}/activities`)).rows;
  } catch (e) {
    /* leave empty */
  }
  box.innerHTML = `<div class="ob-sec" style="margin-top:0">Activity</div>
    <form id="actForm" class="pnl" style="margin-bottom:10px">
      <select id="actKind" class="ig-client">${['note', 'call', 'whatsapp', 'meeting', 'email'].map((k) => `<option value="${k}">${KIND_ICON[k]}</option>`).join('')}</select>
      <input id="actText" placeholder="What happened? e.g. Owner liked the sample reel, wants pricing" style="flex:1;min-width:220px" class="ig-client">
      <button class="btn">Log</button>
    </form>
    <div class="timeline">${
      rows
        .map(
          (r) =>
            `<div class="tl-row"><span class="badge ${r.kind === 'stage' ? 'purple' : 'gray'}">${esc(KIND_ICON[r.kind] || r.kind)}</span><div><div>${esc(r.text)}</div><div class="mini">${esc(r.user_name || 'System')} · ${new Date(r.created_at).toLocaleString('en-IN')}</div></div></div>`
        )
        .join('') || '<div class="empty">Nothing logged yet.</div>'
    }</div>`;
  $('actForm').onsubmit = async (e) => {
    e.preventDefault();
    const text = $('actText').value.trim();
    if (!text) return;
    try {
      await api(`/api/leads/${id}/activities`, { method: 'POST', body: JSON.stringify({ kind: $('actKind').value, text }) });
      loadActivities(id);
    } catch (err) {
      toast(err.message || 'Could not log');
    }
  };
}

function openPackages() {
  const rows = data.packages;
  openModal(
    'Service packages',
    `<div class="mini" style="margin-bottom:10px">What you offer to cafes. Prices here pre-fill a lead's monthly value.</div>
    <form id="pkgForm"><table class="table"><thead><tr><th>Name</th><th>Reels / month</th><th>Price (₹)</th></tr></thead><tbody>${rows
      .map(
        (p) =>
          `<tr data-pkg="${p.id}"><td><input class="ig-client" data-f="name" value="${esc(p.name)}"></td><td><input class="ig-client" data-f="reels" type="number" min="0" value="${p.reels_per_month}" style="width:90px"></td><td><input class="ig-client" data-f="price" type="number" min="0" value="${p.price}" style="width:120px"></td></tr>`
      )
      .join('')}
      <tr data-pkg="new"><td><input class="ig-client" data-f="name" placeholder="New package"></td><td><input class="ig-client" data-f="reels" type="number" min="0" value="0" style="width:90px"></td><td><input class="ig-client" data-f="price" type="number" min="0" value="0" style="width:120px"></td></tr>
    </tbody></table><button class="btn" style="margin-top:12px">Save packages</button></form>`
  );
  $('pkgForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      for (const tr of $('pkgForm').querySelectorAll('tr[data-pkg]')) {
        const get = (f) => tr.querySelector(`[data-f=${f}]`).value;
        const body = { name: get('name').trim(), reels_per_month: Number(get('reels')), price: Number(get('price')) };
        if (tr.dataset.pkg === 'new') {
          if (body.name) await api('/api/packages', { method: 'POST', body: JSON.stringify(body) });
        } else await api('/api/packages/' + tr.dataset.pkg, { method: 'PUT', body: JSON.stringify(body) });
      }
      closeModal();
      toast('Packages saved');
      renderLeads();
    } catch (err) {
      toast(err.message || 'Could not save packages');
    }
  };
}
