// Prospect Analyzer (Admin only): give it a business's website + Instagram, get back a
// SWOT and a tailored outreach strategy for the Pulse sales team to walk in with.
import { api } from '../lib/api.js';
import { state } from '../lib/state.js';
import { $, esc, toast, confirmDialog } from '../lib/dom.js';
import { icon } from '../lib/icons.js';

let configEnabled = null;
let history = [];
let current = null;

export async function renderProspect() {
  if (state.me.role !== 'Admin') return;
  try {
    const [cfg, h] = await Promise.all([api('/api/prospect/config'), api('/api/prospect')]);
    configEnabled = cfg.enabled;
    history = h.rows || [];
  } catch (e) {
    configEnabled = false;
    history = [];
  }
  paint();
}

function paint() {
  $('page-prospect').innerHTML = `<div class="title"><h1>Prospect Analyzer</h1><p>Give it a business's website and Instagram, get back a SWOT and a tailored pitch strategy before you walk in.</p></div>
  ${
    configEnabled === false
      ? `<div class="notice warn">AI strategy generation isn't configured yet (no Anthropic API key set on the server). Ask whoever manages the deployment to add one - everything else on this page still works, you just won't get a generated report.</div>`
      : ''
  }
  <div class="grid g2" style="align-items:start">
    <div class="card">
      <h3 style="margin-bottom:10px">New Report</h3>
      <form id="prospectForm"><div class="fgrid">
        <div class="field full"><label>Business Name *</label><input id="pf1" required placeholder="e.g. The Daily Grind Cafe"></div>
        <div class="field full"><label>Website URL</label><input id="pf2" type="url" placeholder="https://theirsite.com"></div>
        <div class="field full"><label>Instagram Handle</label><input id="pf3" placeholder="@theirhandle (optional)"></div>
        <div class="field"><label>Followers</label><input id="pf4" type="number" min="0" placeholder="e.g. 4200"></div>
        <div class="field"><label>Last post (roughly)</label><input id="pf5" placeholder="e.g. 3 days ago"></div>
        <div class="field full"><label>Posting frequency (your impression)</label><select id="pf6"><option value="">Not noted</option><option>Daily</option><option>A few times a week</option><option>Weekly</option><option>Rarely</option><option>Looks abandoned</option></select></div>
        <div class="field full"><label>Other Instagram notes</label><textarea id="pf7" placeholder="e.g. Good food photos but no reels, bio has no link, mostly reposted content"></textarea></div>
      </div>
      <div class="mini" style="margin:6px 0 10px">Instagram fields are filled in by hand - looking at a prospect's public profile yourself and noting what you see, since the app can't (and shouldn't) auto-scrape an account that hasn't authorized it.</div>
      <button class="btn" id="pfSubmit" ${configEnabled === false ? 'disabled' : ''}>${icon('search')}<span>Generate Report</span></button>
      </form>
      <div id="prospectLoading" class="hidden" style="margin-top:14px"><div class="mini">Analyzing the website and generating the strategy - usually takes 10-20 seconds…</div></div>
    </div>
    <div class="card">
      <h3 style="margin-bottom:10px">Past Reports</h3>
      <div id="prospectHistory">${historyHtml()}</div>
    </div>
  </div>
  <div id="prospectReport" style="margin-top:16px"></div>`;

  $('prospectForm').addEventListener('submit', submitReport);
  wireHistoryClicks();
  if (current) renderReport(current);
}

function historyHtml() {
  if (!history.length) return '<div class="empty">No reports yet.</div>';
  return history
    .map(
      (r) =>
        `<div class="row" style="justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line)"><div style="cursor:pointer" data-view-report="${r.id}"><b>${esc(
          r.business_name
        )}</b><div class="mini">${new Date(r.created_at).toLocaleDateString('en-IN')}</div></div><button class="btn danger" style="padding:3px 9px;font-size:11px" data-del-report="${r.id}">${icon(
          'trash'
        )}</button></div>`
    )
    .join('');
}

function wireHistoryClicks() {
  $('page-prospect')
    .querySelectorAll('[data-view-report]')
    .forEach((el) => (el.onclick = () => viewReport(Number(el.dataset.viewReport))));
  $('page-prospect')
    .querySelectorAll('[data-del-report]')
    .forEach((b) => (b.onclick = () => deleteReport(Number(b.dataset.delReport))));
}

function viewReport(id) {
  const r = history.find((x) => x.id === id);
  if (!r) return;
  current = {
    business_name: r.business_name,
    website_url: r.website_url,
    instagram: { handle: r.instagram_handle, followers: r.instagram_followers, last_post: r.instagram_last_post, posting_frequency: r.instagram_posting_frequency, notes: r.instagram_notes },
    website_signals: JSON.parse(r.website_signals || '{}'),
    swot: JSON.parse(r.swot || '{}'),
    strategy: r.strategy,
  };
  renderReport(current);
  $('prospectReport').scrollIntoView({ behavior: 'smooth' });
}

async function deleteReport(id) {
  const r = history.find((x) => x.id === id);
  const ok = await confirmDialog(`Delete the report for ${r?.business_name || 'this business'}?`, { title: 'Delete Report', confirmText: 'Delete' });
  if (!ok) return;
  try {
    await api('/api/prospect/' + id, { method: 'DELETE' });
    toast('Report deleted');
    await renderProspect();
  } catch (e) {
    toast(e.message || 'Could not delete report');
  }
}

async function submitReport(e) {
  e.preventDefault();
  const btn = $('pfSubmit');
  btn.disabled = true;
  $('prospectLoading').classList.remove('hidden');
  const body = {
    business_name: $('pf1').value,
    website_url: $('pf2').value,
    instagram_handle: $('pf3').value,
    instagram_followers: $('pf4').value,
    instagram_last_post: $('pf5').value,
    instagram_posting_frequency: $('pf6').value,
    instagram_notes: $('pf7').value,
  };
  try {
    const r = await api('/api/prospect/analyze', { method: 'POST', body: JSON.stringify(body) });
    current = r;
    await renderProspect();
    $('prospectReport').scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    toast(err.message || 'Could not generate the report');
  } finally {
    btn.disabled = false;
    if ($('prospectLoading')) $('prospectLoading').classList.add('hidden');
  }
}

function signalRow(label, ok, detail) {
  const badge = ok === true ? '<span class="badge green">Yes</span>' : ok === false ? '<span class="badge red">No</span>' : '<span class="badge gray">—</span>';
  return `<div class="statline"><span>${esc(label)}</span>${badge}${detail ? `<span class="mini" style="margin-left:8px">${esc(detail)}</span>` : ''}</div>`;
}

function renderReport(r) {
  const s = r.website_signals || {};
  const swot = r.swot || {};
  const col = (title, items, cls) =>
    `<div class="card"><h3 style="margin-bottom:8px">${title}</h3>${
      items && items.length ? `<ul style="margin:0;padding-left:18px">${items.map((i) => `<li class="mini" style="margin-bottom:6px;color:var(--ink)">${esc(i)}</li>`).join('')}</ul>` : '<div class="empty">None noted.</div>'
    }</div>`;

  $('prospectReport').innerHTML = `
    <div class="card" style="margin-bottom:14px">
      <h3>${esc(r.business_name)}</h3>
      ${r.website_url ? `<div class="mini">${esc(r.website_url)}</div>` : ''}
      ${swot.elevator_pitch ? `<div class="notice ok" style="margin-top:10px"><b>Opening line:</b> ${esc(swot.elevator_pitch)}</div>` : ''}
    </div>
    ${
      s.reachable !== undefined
        ? `<div class="card" style="margin-bottom:14px"><h3 style="margin-bottom:8px">Website Signals</h3>
      ${signalRow('Reachable', s.reachable)}
      ${s.note ? `<div class="mini" style="color:var(--danger)">${esc(s.note)}</div>` : ''}
      ${signalRow('HTTPS', s.is_https)}
      ${signalRow('Mobile-friendly tag', s.has_mobile_viewport_tag)}
      ${signalRow('Online ordering mentioned', s.mentions_online_ordering)}
      ${signalRow('Menu referenced', s.has_menu_reference)}
      ${signalRow('Instagram link on site', s.links_instagram)}
      ${signalRow('Facebook link on site', s.links_facebook)}
      ${signalRow('WhatsApp link on site', s.links_whatsapp)}
      ${signalRow('Contact info visible', s.has_contact_info)}
      </div>`
        : ''
    }
    <div class="grid g3" style="margin-bottom:14px">
      ${col('Strengths', swot.strengths)}
      ${col('Weaknesses', swot.weaknesses)}
      ${col('Opportunities for Pulse', swot.opportunities)}
    </div>
    <div class="card"><h3 style="margin-bottom:8px">Suggested Strategy</h3>${
      r.strategy ? r.strategy.split('\n\n').map((p) => `<p style="margin:0 0 10px">${esc(p)}</p>`).join('') : '<div class="empty">No strategy generated.</div>'
    }</div>`;
}
