// Content calendar: every reel/post for every client, from idea to posted, with a client sign-off link.
import { api } from '../lib/api.js';
import { state } from '../lib/state.js';
import { $, esc, initials, toast, openModal, closeModal, dateNow, kpi, animateCountUps, confirmDialog } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { readContentSheet, TEMPLATE_CSV } from '../lib/sheet.js';

let data = { items: [], stages: [], kinds: [] };
let ai = { enabled: false, usage: null }; // content AI assistant availability (+ usage for admins)
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
  try {
    ai = await api('/api/content/ai/status');
  } catch (e) {
    ai = { enabled: false, usage: null };
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
          ai.enabled ? `<button class="btn alt" id="aiIdeasBtn">${icon('send')}<span>AI ideas</span></button>` : ''
        }${
          isAdmin() && clientFilter ? `<button class="btn alt" id="linkBtn">${icon('link')}<span>Client review link</span></button>` : ''
        }<button class="btn alt" id="importBtn">${icon('plus')}<span>Import Excel</span></button><button class="btn" id="addItemBtn">${icon('plus')}<span>New content</span></button></div>
      </div>
      ${view === 'board' ? boardHtml() : calendarHtml()}
    </div>
    ${
      ai.usage
        ? `<div class="mini" style="margin-top:8px">AI usage this month: ${ai.usage.tokens_used.toLocaleString('en-IN')} tokens across ${ai.usage.by_feature.reduce((a, f) => a + f.calls, 0)} request(s)${ai.usage.cap ? ' (limit ' + ai.usage.cap.toLocaleString('en-IN') + ')' : ''}.</div>`
        : ''
    }`;
  animateCountUps($('page-content'));
  if ($('aiIdeasBtn')) $('aiIdeasBtn').onclick = openIdeas;
  if ($('importBtn')) $('importBtn').onclick = openImport;

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
      <div class="field full"><label>Script / shot list${ai.enabled ? ' <button type="button" class="btn alt" id="aiScript" style="padding:2px 9px;font-size:11px;margin-left:8px">Write with AI</button>' : ''}</label><textarea id="ci7" placeholder="Hook, shots, voiceover, on-screen text">${esc(it?.script || '')}</textarea></div>
      <div class="field full"><label>Caption${ai.enabled ? ' <button type="button" class="btn alt" id="aiCaption" style="padding:2px 9px;font-size:11px;margin-left:8px">Write with AI</button>' : ''}</label><textarea id="ci8" style="min-height:70px">${esc(it?.caption || '')}</textarea></div>
      <div class="field full"><label>Video / draft link (Drive, etc.)</label><input id="ci9" type="url" value="${esc(it?.media_link || '')}" placeholder="https://drive.google.com/..."></div>
    </div>
    ${it?.review_note ? `<div class="notice" style="margin-top:10px"><b>${esc(it.reviewed_by || 'Client')}</b> said: ${esc(it.review_note)}</div>` : ''}
    <div class="pnl" style="margin-top:12px"><button class="btn">Save</button>${
      it && it.stage !== 'Client review' && it.stage !== 'Approved' && it.stage !== 'Posted' ? '<button class="btn alt" type="button" id="sendReview">Send for client review</button>' : ''
    }${it && (isAdmin() || it.created_by === state.me.id) ? '<button class="btn danger" type="button" id="delItem">Delete</button>' : ''}</div></form>`,
    { wide: true }
  );
  $('itemForm').addEventListener('submit', (e) => saveItem(e, id));
  if ($('aiCaption')) $('aiCaption').onclick = (e) => aiWrite('caption', e.currentTarget);
  if ($('aiScript')) $('aiScript').onclick = (e) => aiWrite('script', e.currentTarget);
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
    let newId = id;
    if (id) await api('/api/content/' + id, { method: 'PUT', body: JSON.stringify(b) });
    else {
      const r = await api('/api/content', { method: 'POST', body: JSON.stringify(b) });
      newId = r.id;
    }
    closeModal();
    toast(b.stage === 'Client review' ? 'Ready for the client — share their review link' : 'Saved');
    await renderContent();
    // The board scrolls horizontally across 7 stage columns - a brand-new item (usually
    // landing in the leftmost "Idea" column) can otherwise sit off-screen with no clue
    // it's there, looking like it silently vanished.
    if (!id && newId && view === 'board') {
      const el = document.querySelector(`[data-item="${newId}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  } catch (err) {
    toast(err.message || 'Could not save');
  } finally {
    if (btn) btn.disabled = false;
  }
}



// ---- import a content plan from Excel / CSV: cards land on their dates in the calendar ----

function openImport() {
  const cl = clients();
  if (!cl.length) return toast('Add a client first');
  openModal(
    'Import from Excel',
    `<div class="mini" style="margin-bottom:10px">Upload the client's content plan (.xlsx or .csv). Each row becomes a card on its date and shows up in the calendar straight away - no typing on the board. Columns: <b>Date</b>, <b>Title</b> (required), Format, Caption, Script, Link. Dates like 2026-12-01, 01/12/2026 or 1 Dec 2026 all work.</div>
    <div class="fgrid">
      <div class="field"><label>Client</label><select id="im1">${cl.map((c) => `<option value="${c.id}" ${clientFilter === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Excel / CSV file</label><input id="im2" type="file" accept=".xlsx,.csv,text/csv"></div>
    </div>
    <div class="pnl" style="margin:8px 0"><button class="btn alt" type="button" id="imTpl">Download template</button></div>
    <div id="imPreview"></div>`,
    { wide: true }
  );
  let parsed = null;
  $('imTpl').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([TEMPLATE_CSV], { type: 'text/csv' }));
    a.download = 'content-calendar-template.csv';
    a.click();
  };
  $('im2').onchange = async (e) => {
    const f = e.target.files[0];
    parsed = null;
    $('imPreview').innerHTML = '';
    if (!f) return;
    $('imPreview').innerHTML = '<div class="mini">Reading the file…</div>';
    try {
      parsed = await readContentSheet(f);
    } catch (err) {
      $('imPreview').innerHTML = `<div class="err">${esc(err.message || 'Could not read that file')}</div>`;
      return;
    }
    const withDate = parsed.items.filter((i) => i.date).length;
    $('imPreview').innerHTML = `<div class="notice ok" style="margin-bottom:8px"><b>${parsed.items.length}</b> row(s) found, <b>${withDate}</b> with a readable date.${
      parsed.hasDate ? '' : ' No Date column was found, so cards will be added without a date.'
    }</div>${
      parsed.problems.length ? `<div class="notice warn" style="margin-bottom:8px">${parsed.problems.slice(0, 5).map(esc).join('<br>')}${parsed.problems.length > 5 ? '<br>…' : ''}</div>` : ''
    }<div class="tableWrap"><table class="table"><thead><tr><th>Date</th><th>Title</th><th>Format</th></tr></thead><tbody>${parsed.items
      .slice(0, 6)
      .map((i) => `<tr><td class="mini">${esc(i.date || '—')}</td><td>${esc(i.title || '(missing)')}</td><td class="mini">${esc(i.kind || 'Reel')}</td></tr>`)
      .join('')}</tbody></table></div>${parsed.items.length > 6 ? `<div class="mini">…and ${parsed.items.length - 6} more</div>` : ''}
    <button class="btn" id="imGo" style="margin-top:10px">Add ${parsed.items.length} to the calendar</button>`;
    $('imGo').onclick = async () => {
      const btn = $('imGo');
      btn.disabled = true;
      btn.textContent = 'Adding…';
      try {
        const r = await api('/api/content/import', { method: 'POST', body: JSON.stringify({ client_id: Number($('im1').value), items: parsed.items }) });
        clientFilter = Number($('im1').value);
        view = 'calendar';
        if (r.first_date) cursor = r.first_date.slice(0, 7);
        await renderContent();
        $('imPreview').innerHTML = `<div class="notice ok"><b>${r.added}</b> card(s) added${r.first_date ? ` - showing ${esc(r.first_date.slice(0, 7))} in the calendar behind this window` : ''}.${
          r.skipped.length
            ? `<div class="mini" style="margin-top:6px">Skipped ${r.skipped.length}: ${r.skipped.slice(0, 8).map((s) => `row ${s.row}${s.title ? ' (' + esc(s.title) + ')' : ''} - ${esc(s.reason)}`).join('; ')}</div>`
            : ''
        }</div><button class="btn" id="imClose" style="margin-top:10px">Done</button>`;
        $('imClose').onclick = closeModal;
        toast(`${r.added} card(s) added to the calendar`);
      } catch (err) {
        toast(err.message || 'Import failed');
        btn.disabled = false;
        btn.textContent = `Add ${parsed.items.length} to the calendar`;
      }
    };
  };
}

// ---- AI assistant: drafts only, a person reviews before anything is saved ----

const AI_NOTE = 'AI draft - please review and edit before saving.';

function appendDraft(el, text) {
  // Never overwrite what someone already typed: add the draft underneath instead.
  el.value = el.value.trim() ? el.value.trim() + '\n\n--- AI draft ---\n' + text : text;
  el.focus();
}

async function aiWrite(kind, btn) {
  const body = {
    client_id: Number($('ci1').value),
    title: $('ci2').value,
    kind: $('ci3').value,
    script: $('ci7').value,
    caption: $('ci8').value,
  };
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Writing…';
  try {
    const r = await api('/api/content/ai/' + kind, { method: 'POST', body: JSON.stringify(body) });
    if (kind === 'caption') {
      appendDraft($('ci8'), [r.caption, r.cta, (r.hashtags || []).join(' ')].filter(Boolean).join('\n\n'));
      toast(r.used_examples?.length ? `Caption drafted using ${r.used_examples.length} past approved example(s). ${AI_NOTE}` : AI_NOTE);
    } else {
      const parts = [r.hook && 'Hook: ' + r.hook, r.script, r.shots?.length && 'Shots:\n' + r.shots.map((s, i) => `${i + 1}. ${s}`).join('\n'), r.on_screen_text?.length && 'On-screen text: ' + r.on_screen_text.join(' / ')];
      appendDraft($('ci7'), parts.filter(Boolean).join('\n\n'));
      toast(AI_NOTE);
    }
  } catch (e) {
    toast(e.message || 'AI request failed');
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

function openIdeas() {
  const cl = clients();
  const month = dateNow().slice(0, 7);
  openModal(
    'AI content ideas',
    `<div class="mini" style="margin-bottom:10px">Suggests ideas for one client using their brand voice and what has worked before. Nothing is added until you pick ideas and confirm.</div>
    <div class="fgrid">
      <div class="field"><label>Client</label><select id="ai1">${cl.map((c) => `<option value="${c.id}" ${clientFilter === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Month</label><input id="ai2" type="month" value="${month}"></div>
      <div class="field"><label>How many</label><input id="ai3" type="number" min="1" max="15" value="8"></div>
      <div class="field"><label>Theme (optional)</label><input id="ai4" placeholder="e.g. monsoon menu, weekend brunch"></div>
    </div>
    <button class="btn" id="aiGo" style="margin-top:10px">Suggest ideas</button>
    <div id="aiOut" style="margin-top:14px"></div>`,
    { wide: true }
  );
  $('aiGo').onclick = async () => {
    const btn = $('aiGo');
    btn.disabled = true;
    btn.textContent = 'Thinking…';
    $('aiOut').innerHTML = '';
    try {
      const r = await api('/api/content/ai/ideas', {
        method: 'POST',
        body: JSON.stringify({ client_id: Number($('ai1').value), month: $('ai2').value, count: Number($('ai3').value), theme: $('ai4').value }),
      });
      const clientId = Number($('ai1').value);
      $('aiOut').innerHTML = `<div class="mini" style="margin-bottom:8px">${esc(AI_NOTE)} Untick any you don't want.</div>${r.ideas
        .map(
          (i, n) => `<label class="statline" style="align-items:flex-start;gap:10px;cursor:pointer"><span><input type="checkbox" data-idea="${n}" checked> <b>${esc(i.title)}</b> <span class="badge gray">${esc(i.kind)}</span><div class="mini">${esc(i.hook)}${i.why ? ' &middot; ' + esc(i.why) : ''}</div></span></label>`
        )
        .join('')}<button class="btn success" id="aiAdd" style="margin-top:10px">Add selected as Idea cards</button>`;
      $('aiAdd').onclick = async () => {
        const picked = [...document.querySelectorAll('[data-idea]:checked')].map((c) => r.ideas[Number(c.dataset.idea)]);
        if (!picked.length) return toast('Pick at least one idea');
        $('aiAdd').disabled = true;
        try {
          for (const i of picked) {
            await api('/api/content', {
              method: 'POST',
              body: JSON.stringify({ client_id: clientId, title: i.title, kind: i.kind, stage: 'Idea', script: [i.hook && 'Hook: ' + i.hook, i.why && 'Why: ' + i.why].filter(Boolean).join('\n') }),
            });
          }
          closeModal();
          toast(`${picked.length} idea card(s) added`);
          await renderContent();
        } catch (e) {
          toast(e.message || 'Could not add the ideas');
          $('aiAdd').disabled = false;
        }
      };
    } catch (e) {
      $('aiOut').innerHTML = `<div class="err">${esc(e.message || 'AI request failed')}</div>`;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Suggest ideas';
    }
  };
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
      // confirmDialog reuses this same modal, and closes it once answered - $('rvUrl')
      // no longer exists by the time this resolves, so the only safe move is to reopen
      // the link modal fresh with the new URL, not write into a field that's gone.
      if (!(await confirmDialog('The old link will stop working. Continue?', { title: 'Regenerate Link', confirmText: 'Continue' }))) return;
      await api(`/api/content/review-link/${clientFilter}/regenerate`, { method: 'POST' });
      toast('New link created');
      await openLink();
    };
  } catch (e) {
    toast(e.message || 'Could not create the link');
  }
}
