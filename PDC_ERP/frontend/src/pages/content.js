// Content calendar: every reel/post for every client, from idea to posted, with a client sign-off link.
import { api } from '../lib/api.js';
import { state } from '../lib/state.js';
import { $, esc, initials, toast, openModal, closeModal, dateNow, kpi, animateCountUps, confirmDialog } from '../lib/dom.js';
import { icon } from '../lib/icons.js';

let data = { items: [], stages: [], kinds: [] };
let clientFilter = 0; // 0 = all clients
let view = 'board'; // 'board' | 'calendar'
let cursor = dateNow().slice(0, 7); // YYYY-MM shown in calendar view

const isAdmin = () => state.me.role === 'Admin';
const clients = () => state.boot.clients.filter((c) => c.active);

export async function renderContent() {
  try {
    data = await api('/api/content' + (clientFilter ? '?client_id=' + clientFilter : ''));
  } catch (e) {
    $('page-content').innerHTML = `<div class="card"><div class="err">Content could not load: ${esc(e.message)}</div></div>`;
    return;
  }
  paint();
}

function paint() {
  const items = data.items;
  const t = dateNow();
  const waiting = items.filter((i) => i.stage === 'Client review').length;
  const late = items.filter((i) => i.scheduled_date && i.scheduled_date < t && !['Approved', 'Posted'].includes(i.stage)).length;
  const postedMonth = items.filter((i) => i.stage === 'Posted' && i.scheduled_date.slice(0, 7) === t.slice(0, 7)).length;
  const inFlight = items.filter((i) => !['Posted'].includes(i.stage)).length;

  $('page-content').innerHTML = `
    <div class="title"><h1>Content calendar</h1><p>Plan every reel, move it through production, and send it to the client for sign-off.</p></div>
    <div class="chips"><button class="chip ${clientFilter === 0 ? 'active' : ''}" data-c="0"><i>*</i>All clients</button>${clients()
      .map((c) => `<button class="chip ${clientFilter === c.id ? 'active' : ''}" data-c="${c.id}"><i>${esc(c.name.charAt(0).toUpperCase())}</i>${esc(c.name)}</button>`)
      .join('')}</div>
    <div class="grid g5" style="margin-bottom:14px">
      ${kpi('In production', inFlight, 'not posted yet')}
      ${kpi('Waiting for client', waiting, waiting ? 'chase the owner' : 'nothing pending')}
      ${kpi('Running late', late, late ? 'past the planned date' : 'on schedule')}
      ${kpi('Posted this month', postedMonth, 'delivered')}
      ${kpi('Total items', items.length, clientFilter ? 'for this client' : 'across all clients')}
    </div>
    <div class="card">
      <div class="sectionHead">
        <div class="seg" style="margin:0"><button class="${view === 'board' ? 'active' : ''}" data-v="board">Board</button><button class="${view === 'calendar' ? 'active' : ''}" data-v="calendar">Calendar</button></div>
        <div class="pnl">${
          isAdmin() && clientFilter ? `<button class="btn alt" id="linkBtn">${icon('link')}<span>Client review link</span></button>` : ''
        }<button class="btn" id="addItemBtn">${icon('plus')}<span>New content</span></button></div>
      </div>
      ${view === 'board' ? boardHtml() : calendarHtml()}
    </div>`;
  animateCountUps($('page-content'));

  $('page-content')
    .querySelectorAll('[data-c]')
    .forEach((b) => (b.onclick = () => {
      clientFilter = Number(b.dataset.c);
      renderContent();
    }));
  $('page-content')
    .querySelectorAll('[data-v]')
    .forEach((b) => (b.onclick = () => {
      view = b.dataset.v;
      paint();
    }));
  $('addItemBtn').onclick = () => openItem();
  if ($('linkBtn')) $('linkBtn').onclick = openLink;
  $('page-content')
    .querySelectorAll('[data-item]')
    .forEach((c) => (c.onclick = () => openItem(Number(c.dataset.item))));
  if (view === 'board') bindBoardDrag();
  else bindCalendarNav();
}

function cardHtml(i) {
  const late = i.scheduled_date && i.scheduled_date < dateNow() && !['Approved', 'Posted'].includes(i.stage);
  return `<div class="lead-card" draggable="true" data-item="${i.id}" data-drag="${i.id}">
    <div class="lead-top"><b>${esc(i.title)}</b><span class="badge ${i.kind === 'Reel' ? 'blue' : 'gray'}">${esc(i.kind)}</span></div>
    <div class="mini">${esc(i.client_short || i.client_name)}${i.scheduled_date ? ' · ' + esc(i.scheduled_date.slice(5)) : ''}</div>
    ${i.review_note && i.stage === 'Edit' ? `<div class="mini wrap" style="color:var(--danger);margin-top:6px">Client: ${esc(i.review_note)}</div>` : ''}
    <div class="lead-foot">${late ? '<span class="badge red">Late</span>' : ''}${
      i.assignee_name ? `<span class="avatar" title="${esc(i.assignee_name)}" style="width:24px;height:24px;font-size:9px">${esc(initials(i.assignee_name))}</span>` : ''
    }</div></div>`;
}

function boardHtml() {
  return `<div class="lead-board content-board">${data.stages
    .map((s) => {
      const col = data.items.filter((i) => i.stage === s);
      return `<div class="lead-col" data-stage="${esc(s)}"><div class="lead-colhead"><b>${esc(s)}</b><span class="badge gray">${col.length}</span></div>${
        col.map(cardHtml).join('') || '<div class="empty" style="padding:14px 6px">Empty</div>'
      }</div>`;
    })
    .join('')}</div>`;
}

function bindBoardDrag() {
  $('page-content')
    .querySelectorAll('[data-drag]')
    .forEach((c) => {
      c.ondragstart = (e) => {
        e.dataTransfer.setData('text/plain', c.dataset.drag);
        c.classList.add('dragging');
      };
      c.ondragend = () => c.classList.remove('dragging');
    });
  $('page-content')
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
        moveItem(Number(e.dataTransfer.getData('text/plain')), col.dataset.stage);
      };
    });
}

async function moveItem(id, stage) {
  const i = data.items.find((x) => x.id === id);
  if (!i || i.stage === stage) return;
  try {
    await api('/api/content/' + id, { method: 'PUT', body: JSON.stringify({ stage }) });
    toast(`Moved to ${stage}`);
    await renderContent();
  } catch (e) {
    toast(e.message || 'Could not move item');
  }
}

// ---- month grid ----

function calendarHtml() {
  const [y, m] = cursor.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7; // Monday first
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const label = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(first);
  const today = dateNow();
  const byDay = {};
  const unscheduled = [];
  data.items.forEach((i) => {
    if (!i.scheduled_date) unscheduled.push(i);
    else if (i.scheduled_date.slice(0, 7) === cursor) (byDay[i.scheduled_date] = byDay[i.scheduled_date] || []).push(i);
  });
  const cells = [];
  for (let k = 0; k < lead; k++) cells.push('<div class="cal-cell blank"></div>');
  for (let d = 1; d <= days; d++) {
    const iso = `${cursor}-${String(d).padStart(2, '0')}`;
    cells.push(
      `<div class="cal-cell ${iso === today ? 'today' : ''}" data-day="${iso}"><div class="cal-d">${d}</div>${(byDay[iso] || [])
        .map((i) => `<button class="cal-ev k-${esc(i.stage.replace(/\s+/g, '-'))}" data-item="${i.id}" title="${esc(i.title)} · ${esc(i.stage)}">${esc(i.title)}</button>`)
        .join('')}</div>`
    );
  }
  return `<div class="cal-nav"><button class="iconBtn" id="calPrev" title="Previous month">&lsaquo;</button><b>${label}</b><button class="iconBtn" id="calNext" title="Next month">&rsaquo;</button><button class="btn alt" id="calToday">Today</button></div>
    <div class="cal-grid">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((x) => `<div class="cal-h">${x}</div>`).join('')}${cells.join('')}</div>
    ${
      unscheduled.length
        ? `<div class="ob-sec">No date yet (${unscheduled.length})</div><div class="pnl">${unscheduled
            .map((i) => `<button class="pill" data-item="${i.id}">${esc(i.title)} <span class="mini">${esc(i.client_short || '')}</span></button>`)
            .join('')}</div>`
        : ''
    }`;
}

function bindCalendarNav() {
  const shift = (n) => {
    const [y, m] = cursor.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    cursor = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    paint();
  };
  $('calPrev').onclick = () => shift(-1);
  $('calNext').onclick = () => shift(1);
  $('calToday').onclick = () => {
    cursor = dateNow().slice(0, 7);
    paint();
  };
  // click an empty day to plan something on it
  $('page-content')
    .querySelectorAll('.cal-cell[data-day]')
    .forEach(
      (c) =>
        (c.ondblclick = (e) => {
          if (e.target.closest('.cal-ev')) return;
          openItem(0, c.dataset.day);
        })
    );
}

// ---- add / edit ----

function openItem(id, presetDate = '') {
  const it = id ? data.items.find((x) => x.id === id) : null;
  const users = state.boot.users.filter((u) => u.active);
  const canEditAll = isAdmin() || !it;
  const stageOptions = data.stages.filter((s) => isAdmin() || s !== 'Approved' || it?.stage === 'Approved');
  openModal(
    it ? it.title : 'New content',
    `<form id="itemForm"><div class="fgrid">
      <div class="field"><label>Client *</label><select id="ci1" ${it && !isAdmin() ? 'disabled' : ''} required>${clients()
        .map((c) => `<option value="${c.id}" ${(it?.client_id || clientFilter) === c.id ? 'selected' : ''}>${esc(c.name)}</option>`)
        .join('')}</select></div>
      <div class="field"><label>Title *</label><input id="ci2" required value="${esc(it?.title || '')}" placeholder="e.g. Cold coffee pour, slow motion"></div>
      <div class="field"><label>Format</label><select id="ci3">${data.kinds.map((k) => `<option ${it?.kind === k ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select></div>
      <div class="field"><label>Stage</label><select id="ci4">${stageOptions.map((s) => `<option ${(it?.stage || 'Idea') === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
      <div class="field"><label>Planned date</label><input id="ci5" type="date" value="${esc(it?.scheduled_date || presetDate)}"></div>
      <div class="field"><label>Assigned to</label><select id="ci6" ${canEditAll && isAdmin() ? '' : 'disabled'}><option value="">Nobody yet</option>${users
        .map((u) => `<option value="${u.id}" ${(it ? it.assignee_id : state.me.id) === u.id ? 'selected' : ''}>${esc(u.name)}</option>`)
        .join('')}</select></div>
      <div class="field full"><label>Script / shot list</label><textarea id="ci7" placeholder="Hook, shots, voiceover, on-screen text">${esc(it?.script || '')}</textarea></div>
      <div class="field full"><label>Caption</label><textarea id="ci8" style="min-height:70px">${esc(it?.caption || '')}</textarea></div>
      <div class="field full"><label>Video / draft link (Drive, etc.)</label><input id="ci9" type="url" value="${esc(it?.media_link || '')}" placeholder="https://drive.google.com/..."></div>
    </div>
    ${it?.review_note ? `<div class="notice" style="margin-top:10px"><b>${esc(it.reviewed_by || 'Client')}</b> said: ${esc(it.review_note)}</div>` : ''}
    <div class="pnl" style="margin-top:12px"><button class="btn">Save</button>${
      it && it.stage !== 'Client review' && it.stage !== 'Approved' && it.stage !== 'Posted' ? '<button class="btn alt" type="button" id="sendReview">Send for client review</button>' : ''
    }${it && isAdmin() ? '<button class="btn danger" type="button" id="delItem">Delete</button>' : ''}</div></form>`,
    { wide: true }
  );
  $('itemForm').addEventListener('submit', (e) => saveItem(e, id));
  if ($('sendReview'))
    $('sendReview').onclick = async () => {
      if (!$('ci9').value.trim() && !$('ci7').value.trim()) return toast('Add a draft link or script so the client has something to review');
      $('ci4').value = 'Client review';
      $('itemForm').requestSubmit();
    };
  if ($('delItem'))
    $('delItem').onclick = async () => {
      if (!(await confirmDialog('Delete this content item?', { title: 'Delete Content', confirmText: 'Delete' }))) return;
      await api('/api/content/' + id, { method: 'DELETE' });
      closeModal();
      renderContent();
    };
}

async function saveItem(e, id) {
  e.preventDefault();
  const btn = e.submitter;
  const b = {
    title: $('ci2').value,
    kind: $('ci3').value,
    stage: $('ci4').value,
    scheduled_date: $('ci5').value,
    script: $('ci7').value,
    caption: $('ci8').value,
    media_link: $('ci9').value,
  };
  if (isAdmin()) {
    b.client_id = Number($('ci1').value);
    b.assignee_id = $('ci6').value ? Number($('ci6').value) : null;
  }
  if (!id) b.client_id = Number($('ci1').value);
  try {
    if (btn) btn.disabled = true;
    if (id) await api('/api/content/' + id, { method: 'PUT', body: JSON.stringify(b) });
    else await api('/api/content', { method: 'POST', body: JSON.stringify(b) });
    closeModal();
    toast(b.stage === 'Client review' ? 'Ready for the client — share their review link' : 'Saved');
    await renderContent();
  } catch (err) {
    toast(err.message || 'Could not save');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ---- client review link ----

async function openLink() {
  try {
    const d = await api('/api/content/review-link/' + clientFilter);
    const c = clients().find((x) => x.id === clientFilter);
    openModal(
      'Client review link',
      `<div class="mini" style="margin-bottom:10px">Send this to the owner of <b>${esc(c?.name || '')}</b> on WhatsApp. They can watch each reel waiting for review and tap Approve or Request changes. No login needed.</div>
      <div class="field"><input id="rvUrl" readonly value="${esc(d.url)}"></div>
      <div class="mini">${d.last_viewed_at ? 'Last opened by the client ' + new Date(d.last_viewed_at).toLocaleString('en-IN') : 'Not opened by the client yet'}</div>
      <div class="pnl" style="margin-top:12px"><button class="btn" id="rvCopy">Copy link</button><button class="btn alt" id="rvRegen">Make a new link</button></div>
      <div class="mini" style="margin-top:8px">Making a new link stops the old one working immediately.</div>`
    );
    $('rvCopy').onclick = async () => {
      try {
        await navigator.clipboard.writeText($('rvUrl').value);
        toast('Link copied');
      } catch (e) {
        $('rvUrl').select();
        toast('Press Ctrl+C to copy');
      }
    };
    $('rvRegen').onclick = async () => {
      if (!(await confirmDialog('The old link will stop working. Continue?', { title: 'Regenerate Link', confirmText: 'Continue' }))) return;
      const n = await api(`/api/content/review-link/${clientFilter}/regenerate`, { method: 'POST' });
      $('rvUrl').value = n.url;
      toast('New link created');
    };
  } catch (e) {
    toast(e.message || 'Could not create the link');
  }
}
