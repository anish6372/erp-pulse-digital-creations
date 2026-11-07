// Public, login-free page where a cafe owner reviews content. Reached via the private link:
//   <frontend>/#/review/<token>
import { $, esc } from '../lib/dom.js';

let token = '';
let who = '';
try {
  who = localStorage.getItem('pdc_reviewer') || '';
} catch (e) {
  /* storage blocked: the name is simply asked again */
}

async function call(path, body) {
  const r = await fetch(`/api/review/public/${encodeURIComponent(token)}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let d = {};
  try {
    d = await r.json();
  } catch (e) {
    /* empty body */
  }
  if (!r.ok) throw new Error(d.error || 'Something went wrong');
  return d;
}

const nice = (iso) => (iso ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(iso + 'T00:00:00')) : 'No date');

export async function startReview(t) {
  token = t;
  const root = $('onboard');
  root.classList.remove('hidden');
  root.innerHTML = '<div class="rv-wrap"><div class="rv-card"><div class="empty">Loading…</div></div></div>';
  let d;
  try {
    d = await call('');
  } catch (e) {
    root.innerHTML = `<div class="rv-wrap"><div class="rv-card"><img class="login-logo" src="/pdc-logo.png" alt="Pulse Digital Creations"><h2 class="rv-h">Link not available</h2><p class="mini">${esc(e.message)} Please ask your contact at Pulse Digital Creations for a new link.</p></div></div>`;
    return;
  }
  paint(d);
}

function paint(d) {
  const pending = d.items.filter((i) => i.stage === 'Client review');
  const done = d.items.filter((i) => i.stage !== 'Client review');
  $('onboard').innerHTML = `<div class="rv-wrap">
    <div class="rv-card">
      <img class="login-logo" src="/pdc-logo.png" alt="Pulse Digital Creations" style="width:min(200px,60vw)">
      <h1 class="rv-h">Content for ${esc(d.client)}</h1>
      <p class="mini">${pending.length ? `${pending.length} item${pending.length === 1 ? '' : 's'} waiting for your decision.` : 'Nothing is waiting for you right now. Thank you!'}</p>
      <div class="field" style="max-width:320px"><label>Your name</label><input id="rvName" placeholder="So we know who replied" value="${esc(who)}"></div>
    </div>
    ${pending.map((i) => itemCard(i, true)).join('')}
    ${done.length ? `<div class="rv-sub">Already answered</div>${done.map((i) => itemCard(i, false)).join('')}` : ''}
  </div>`;
  $('rvName').oninput = (e) => {
    who = e.target.value;
    try {
      localStorage.setItem('pdc_reviewer', who);
    } catch (err) {
      /* ignore */
    }
  };
  $('onboard')
    .querySelectorAll('[data-approve]')
    .forEach((b) => (b.onclick = () => decide(Number(b.dataset.approve), 'approve')));
  $('onboard')
    .querySelectorAll('[data-changes]')
    .forEach((b) => (b.onclick = () => {
      const box = $('onboard').querySelector(`[data-box="${b.dataset.changes}"]`);
      box.classList.toggle('hidden');
      box.querySelector('textarea').focus();
    }));
  $('onboard')
    .querySelectorAll('[data-send]')
    .forEach((b) => (b.onclick = () => decide(Number(b.dataset.send), 'changes')));
}

function itemCard(i, actionable) {
  const status = i.stage === 'Client review' ? '' : `<span class="badge ${i.stage === 'Posted' ? 'blue' : 'green'}">${esc(i.stage)}</span>`;
  return `<div class="rv-card rv-item">
    <div class="lead-top"><h3 class="rv-t">${esc(i.title)}</h3><span class="badge gray">${esc(i.kind)}</span></div>
    <div class="mini">${i.scheduled_date ? "Planned for " + esc(nice(i.scheduled_date)) : "No planned date"} ${status}</div>
    ${i.media_link ? `<p><a class="btn alt" href="${esc(i.media_link)}" target="_blank" rel="noopener">Watch the draft</a></p>` : '<p class="mini">No video link attached yet.</p>'}
    ${i.script ? `<div class="rv-label">Script</div><div class="rv-text">${esc(i.script)}</div>` : ''}
    ${i.caption ? `<div class="rv-label">Caption</div><div class="rv-text">${esc(i.caption)}</div>` : ''}
    ${
      actionable
        ? `<div class="pnl" style="margin-top:14px"><button class="btn success" data-approve="${i.id}">Approve</button><button class="btn alt" data-changes="${i.id}">Request changes</button></div>
           <div class="hidden" data-box="${i.id}" style="margin-top:10px"><textarea class="rv-note" placeholder="What should we change?"></textarea><button class="btn" style="margin-top:8px" data-send="${i.id}">Send to the team</button></div>`
        : i.reviewed_by
          ? `<div class="mini" style="margin-top:8px">Answered by ${esc(i.reviewed_by)}</div>`
          : ''
    }
  </div>`;
}

async function decide(id, decision) {
  const name = ($('rvName').value || '').trim();
  if (!name) {
    $('rvName').focus();
    return alert('Please type your name first so the team knows who replied.');
  }
  const note = decision === 'changes' ? $('onboard').querySelector(`[data-box="${id}"] textarea`).value.trim() : '';
  if (decision === 'changes' && !note) return alert('Please tell us what to change.');
  try {
    await call(`/items/${id}/decision`, { decision, note, reviewer_name: name });
    paint(await call(''));
  } catch (e) {
    alert(e.message);
  }
}
