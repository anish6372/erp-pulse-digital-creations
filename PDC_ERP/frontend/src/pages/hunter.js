// Client Hunter: a scored prospect pipeline for marketing/sales outreach - add a lead by
// hand, get an AI-drafted first-touch message per available channel, approve or reject it
// (nothing sends itself), work approved ones as tasks, and a rough market-size estimate.
// Admin and Sales department only, same access as the existing Leads page.
import { api } from '../lib/api.js';
import { state } from '../lib/state.js';
import { $, esc, toast, openModal, closeModal, confirmDialog, kpi } from '../lib/dom.js';
import { icon } from '../lib/icons.js';

const NICHES = {
  dental: 'Dental clinics',
  salon_spa: 'Spas & salons',
  cafe_restaurant: 'Cafes & restaurants',
  saas: 'SaaS products',
  jewellery: 'Jewellery brands',
  automobile: 'Automobile',
  interior_design: 'Interior design',
  other: 'Other',
};
const CITIES = ['Bangalore', 'Mumbai', 'Delhi NCR', 'Hyderabad', 'Pune', 'Chennai', 'Dubai', 'Singapore', 'London'];
const SIGNALS = {
  agency_request: 'Asked for an agency',
  referral: 'Referral',
  new_opening: 'New opening',
  funding: 'Funding round',
  hiring_marketer: 'Hiring a marketer',
  launch: 'Launch',
  low_reviews: 'Few reviews',
  manual: 'Found by team',
  weak_presence: 'Weak online presence',
};
const STATUS_LABEL = { new: 'New', audited: 'Audited', outreach: 'Outreach', replied: 'Replied', meeting: 'Meeting', handed_off: 'Handed off', won: 'Won', lost: 'Lost', disqualified: 'Disqualified' };
const TIER_CLASS = { hot: 'red', warm: 'yellow', parked: 'gray' };

const COMPLIANCE_RULES = [
  'A person reviews and sends every first outreach message - nothing goes out automatically.',
  'The do-not-contact list is checked before a lead or prospect is contacted.',
  'An access or erasure request is fulfilled the same day it is logged here.',
  "Erasure removes a contact's name, phone and email from leads/candidates, but keeps the business record and a do-not-contact entry so they are never reached again.",
  'Every add, delete, access and erasure action here is written to the activity log below.',
];

let cfg = { enabled: false };
let tab = 'dashboard';
let filters = { q: '', tier: '', niche: '', status: '' };
let marketParams = { niche: 'dental', city: 'Bangalore', months: 2 };
let complianceCache = { dnc: [], requests: [], activity: [], lastResult: null };

function canAccess() {
  return state.me.role === 'Admin' || String(state.me.department || '').toLowerCase() === 'sales';
}

function isAdmin() {
  return state.me.role === 'Admin';
}

export async function renderHunter() {
  if (!canAccess()) return;
  try {
    cfg = await api('/api/hunter/config');
  } catch (e) {
    cfg = { enabled: false };
  }
  paintShell();
  await loadTab();
}

function paintShell() {
  $('page-hunter').innerHTML = `<div class="title"><h1>Client Hunter</h1><p>A scored prospect pipeline for marketing outreach - every message is drafted, never auto-sent, and checked against the do-not-contact list.</p></div>
  ${cfg.enabled === false ? '<div class="notice warn">AI drafting isn\'t configured (no Anthropic API key set). Leads can still be added and scored - you just won\'t get AI-drafted outreach messages.</div>' : ''}
  ${cfg.hunts_enabled === false ? '<div class="notice warn">Automatic lead discovery isn\'t configured (no Apify token set). Add leads by hand in the meantime - everything else still works.</div>' : ''}
  <div class="pnl" style="margin-bottom:14px;flex-wrap:wrap">
    ${tabBtn('dashboard', 'Dashboard')}${tabBtn('market', 'Market')}${tabBtn('leads', 'Leads')}${tabBtn('approvals', 'Approvals')}${tabBtn('tasks', 'Tasks')}${tabBtn('add', 'Add leads')}${tabBtn(
    'hunts',
    'Hunts'
  )}${isAdmin() ? tabBtn('compliance', 'Compliance') : ''}
  </div>
  <div id="hunterBody"></div>`;
  $('page-hunter')
    .querySelectorAll('[data-tab]')
    .forEach((b) => (b.onclick = () => switchTab(b.dataset.tab)));
}

function tabBtn(id, label) {
  return `<button class="btn ${tab === id ? '' : 'alt'}" data-tab="${id}">${esc(label)}</button>`;
}

async function switchTab(id) {
  tab = id;
  $('page-hunter')
    .querySelectorAll('[data-tab]')
    .forEach((b) => b.classList.toggle('alt', b.dataset.tab !== tab));
  await loadTab();
}

async function loadTab() {
  const body = $('hunterBody');
  body.innerHTML = '<div class="empty">Loading…</div>';
  try {
    if (tab === 'dashboard') await paintDashboard();
    else if (tab === 'market') await paintMarket();
    else if (tab === 'leads') await paintLeads();
    else if (tab === 'approvals') await paintTouches('draft', 'approvals');
    else if (tab === 'tasks') await paintTouches('approved', 'tasks');
    else if (tab === 'add') paintAdd();
    else if (tab === 'hunts') await paintHunts();
    else if (tab === 'compliance') await paintCompliance();
  } catch (e) {
    body.innerHTML = `<div class="card"><div class="err">Could not load this tab: ${esc(e.message)}</div></div>`;
  }
}

// ---------- dashboard ----------

async function paintDashboard() {
  const d = await api('/api/hunter/dashboard');
  $('hunterBody').innerHTML = `
    <div class="grid g4" style="margin-bottom:14px">
      ${kpi('Hot leads', d.hot_leads, 'score 70+ and reachable')}
      ${kpi('Drafts to approve', d.drafts_to_approve, 'nothing sends without you')}
      ${kpi('Tasks pending', d.tasks_pending, 'DMs, calls, follow-ups')}
      ${kpi('Approved today', d.approved_today, 'messages approved today')}
    </div>
    <div class="grid g2" style="align-items:start">
      <div class="card">
        <h3 style="margin-bottom:10px">Call these first</h3>
        ${
          d.call_these_first.length
            ? d.call_these_first
                .map(
                  (l) =>
                    `<div class="statline"><span><b>${l.score}</b> <span class="badge ${TIER_CLASS[l.tier] || 'gray'}">${esc(l.tier)}</span> ${esc(l.name)}</span><span class="mini">${esc(
                      NICHES[l.niche] || l.niche
                    )} &middot; ${esc(l.city || '—')}</span></div>`
                )
                .join('')
            : '<div class="empty">No leads yet - add one to get started.</div>'
        }
      </div>
      <div class="card">
        <h3 style="margin-bottom:10px">Pipeline</h3>
        ${d.funnel
          .map((f) => `<div class="statline"><span>${esc(STATUS_LABEL[f.status] || f.status)}</span><span class="badge gray">${f.count}</span></div>`)
          .join('')}
      </div>
    </div>
    <div class="grid g2" style="align-items:start;margin-top:14px">
      <div class="card">
        <h3 style="margin-bottom:8px">Performance by Location</h3>
        ${breakdownTable(d.cities, 'city', (c) => `${esc(c.city)} <span class="mini">P${c.priority}</span>`)}
      </div>
      <div class="card">
        <h3 style="margin-bottom:8px">Performance by Niche</h3>
        ${breakdownTable(d.niches, 'niche', (n) => esc(n.niche_label))}
      </div>
    </div>`;
}

// ---------- market (illustrative estimate) ----------

async function paintMarket() {
  $('hunterBody').innerHTML = `<div class="card">
    <form id="marketForm" class="fgrid" style="margin-bottom:12px">
      <div class="field"><label>Niche</label><select id="mkNiche">${Object.entries(NICHES)
        .map(([k, v]) => `<option value="${k}" ${marketParams.niche === k ? 'selected' : ''}>${esc(v)}</option>`)
        .join('')}</select></div>
      <div class="field"><label>Location</label><select id="mkCity">${CITIES.map((c) => `<option ${marketParams.city === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
      <div class="field"><label>Period (months)</label><input id="mkMonths" type="number" min="1" max="12" value="${marketParams.months}"></div>
      <div class="field" style="align-self:flex-end"><button class="btn">${icon('search')}<span>Estimate</span></button></div>
    </form>
    <div id="marketOut"></div>
  </div>`;
  $('marketForm').onsubmit = async (e) => {
    e.preventDefault();
    marketParams = { niche: $('mkNiche').value, city: $('mkCity').value, months: Number($('mkMonths').value) || 2 };
    await loadMarket();
  };
  await loadMarket();
}

async function loadMarket() {
  const d = await api(`/api/hunter/market?niche=${marketParams.niche}&city=${encodeURIComponent(marketParams.city)}&months=${marketParams.months}`);
  const m = d.estimate;
  const money = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
  $('marketOut').innerHTML = `
    <div class="notice" style="margin-bottom:12px">${esc(d.note)} Figures below are modeled from category benchmarks and ${esc(m.priority_label)} weighting, not scraped from real listings.</div>
    <div class="grid g5" style="margin-bottom:12px">
      ${kpi('Agencies (est.)', m.agencies_estimate, m.niche_label)}
      ${kpi('Businesses buying', m.businesses_buying_estimate, 'in this category/area')}
      ${kpi('Projects (period)', m.projects_estimate, `${m.period_months} month(s)`)}
      ${kpi('Est. monthly spend', money(m.monthly_spend_estimate), 'across the category')}
      ${kpi('Avg project value', money(m.avg_project_value_estimate), '')}
    </div>
    <div class="card soft" style="margin-bottom:12px">
      <div class="statline"><span>Up for grabs (no retained agency, est.)</span><span><b>${money(m.up_for_grabs_monthly_estimate)}</b>/month</span></div>
      <div class="statline"><span>Category growth (est.)</span><span>${m.growth_pct}% / year</span></div>
      <div class="statline"><span>Suggested pitch angle</span><span>${esc(m.suggested_pitch)}</span></div>
    </div>
    ${radialSection(d, m)}
    ${forecastSection(m)}`;

  const out = $('marketOut');
  const lb = $('locateBtn');
  if (lb) {
    lb.onclick = async () => {
      lb.disabled = true;
      let found = 0;
      try {
        for (;;) {
          lb.textContent = `Looking up locations… ${found} found`;
          const r = await api('/api/hunter/leads/locate', { method: 'POST', body: JSON.stringify({ city: marketParams.city }) });
          found += r.located;
          if (!r.remaining || !r.tried) break;
        }
        toast(found ? `${found} lead(s) placed on the map` : 'No locations found - small businesses are often missing from the free map data');
      } catch (e) {
        toast(e.message || 'Location lookup failed');
      }
      await loadMarket();
    };
  }
  out.querySelectorAll('[data-tier-toggle]').forEach((cb) => {
    cb.onchange = () => {
      out.querySelectorAll(`[data-tier="${cb.dataset.tierToggle}"]`).forEach((el) => (el.style.display = cb.checked ? '' : 'none'));
    };
  });
  out.querySelectorAll('[data-lead-id]').forEach((el) => {
    el.onclick = async () => {
      tab = 'leads';
      await switchTab('leads');
      openLeadDetail(Number(el.dataset.leadId));
    };
  });
}

const TIER_COLOR = { hot: 'var(--danger)', warm: 'var(--warn)', parked: 'var(--muted)' };
const kmBetween = (a, b) => {
  const R = 6371;
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

// Radial map around the chosen city centre with 5 km / 10 km rings. Only leads that have
// real coordinates (Hunts pin them automatically from Google Maps) are drawn - nothing is
// placed at a made-up position.
function radialSection(d, m) {
  const center = d.center;
  const all = d.points || [];
  const pts = center ? all.filter((p) => p.lat != null && p.lng != null) : [];
  const unpinned = all.length - pts.length;
  const placed = pts.map((p) => ({ ...p, km: kmBetween(center, p) }));
  const near = placed.filter((p) => p.km <= 12).sort((a, b) => b.score - a.score);
  const far = placed.length - near.length;
  const W = 560, H = 460, cx = W / 2, cy = H / 2, R10 = 190, scale = R10 / 10;
  const locs = (d.localities || []).map((l) => ({ ...l, km: kmBetween(center, l) })).filter((l) => l.km <= 12);
  const areaOf = (p) => {
    let best = null;
    for (const l of locs) {
      const k = kmBetween(p, l);
      if (!best || k < best.k) best = { k, name: l.name };
    }
    return best && best.k <= 4 ? best.name : '—';
  };
  const px = (lng) => cx + (lng - center.lng) * 111.32 * Math.cos((center.lat * Math.PI) / 180) * scale;
  const py = (lat) => cy - (lat - center.lat) * 110.57 * scale;
  const landmarks = locs
    .map((l) => `<circle cx="${px(l.lng).toFixed(1)}" cy="${py(l.lat).toFixed(1)}" r="2" fill="var(--muted)" fill-opacity=".6"/><text x="${px(l.lng).toFixed(1)}" y="${(py(l.lat) - 5).toFixed(1)}" text-anchor="middle" font-size="9" fill="var(--muted)">${esc(l.name)}</text>`)
    .join('');
  const dots = near
    .map((p) => {
      const x = cx + (p.lng - center.lng) * 111.32 * Math.cos((center.lat * Math.PI) / 180) * scale;
      const y = cy - (p.lat - center.lat) * 110.57 * scale;
      const r = 5 + (p.score / 100) * 8;
      const col = TIER_COLOR[p.tier] || 'var(--muted)';
      return `<g data-tier="${p.tier}" data-lead-id="${p.id}" style="cursor:pointer"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="${col}" fill-opacity=".8" stroke="${col}"><title>${esc(p.name)} - score ${p.score}, ${p.km.toFixed(1)} km</title></circle></g>`;
    })
    .join('');
  const svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px;height:auto;background:var(--panel);border-radius:10px">
    <circle cx="${cx}" cy="${cy}" r="${R10}" fill="none" stroke="var(--line)"/>
    <circle cx="${cx}" cy="${cy}" r="${R10 / 2}" fill="none" stroke="var(--line)"/>
    <text x="${cx + R10 / 2 + 4}" y="${cy - 4}" font-size="10" fill="var(--muted)">5 km</text>
    <text x="${cx + R10 * 0.7}" y="${cy - R10 * 0.72}" font-size="10" fill="var(--muted)">10 km</text>
    ${landmarks}
    ${dots}
    <circle cx="${cx}" cy="${cy}" r="6" fill="#fff" stroke="var(--ink)" stroke-width="2"/>
    <text x="${cx}" y="${cy + 20}" text-anchor="middle" font-size="12" fill="var(--ink)" style="font-weight:700">${esc(m.city || 'City centre')}</text>
  </svg>`;
  const counts = { hot: 0, warm: 0, parked: 0 };
  near.forEach((p) => {
    if (counts[p.tier] != null) counts[p.tier]++;
  });
  const toggles = ['hot', 'warm', 'parked']
    .map((t) => `<label class="mini" style="display:inline-flex;gap:6px;align-items:center;margin-right:14px"><input type="checkbox" data-tier-toggle="${t}" checked><span style="color:${TIER_COLOR[t]}">&#9679;</span> ${t[0].toUpperCase() + t.slice(1)} (${counts[t]})</label>`)
    .join('');
  const rows = near
    .slice(0, 12)
    .map((p) => `<tr data-lead-id="${p.id}" style="cursor:pointer"><td><b>${esc(p.name)}</b><div class="mini">${esc(NICHES[p.niche] || p.niche)}</div></td><td>${esc(areaOf(p))}</td><td>${p.km.toFixed(1)} km</td><td>${p.gmb_reviews ?? '—'}</td><td>${p.score}</td><td><span class="badge ${TIER_CLASS[p.tier] || 'gray'}">${esc(p.tier)}</span></td></tr>`)
    .join('');
  const note = [
    unpinned > 0 ? `${unpinned} lead(s) here aren't pinned because they have no coordinates (leads found by a Hunt are pinned automatically).` : '',
    d.unlocated > 0 ? `<button class="btn alt" id="locateBtn" type="button" style="margin-left:6px">Locate ${d.unlocated} lead(s)</button>` : '',
    far > 0 ? `${far} more are over 12 km from the centre.` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return `<div class="grid g2" style="align-items:start;margin-bottom:12px">
    <div class="card">
      <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px;margin-bottom:8px"><h3>Map</h3><div>${toggles}</div></div>
      ${center ? svg : '<div class="empty">Pick a city to see the map.</div>'}
      <div class="mini" style="margin-top:8px">Your real leads, positioned by their Google Maps coordinates. Bigger dot = higher score. Click a dot to open the lead. ${note}</div>
    </div>
    <div class="card">
      <h3 style="margin-bottom:8px">What this means for Pulse</h3>
      <ul style="margin:0;padding-left:18px;line-height:1.6">
        <li><b>Estimate:</b> about ${m.businesses_buying_estimate} businesses here buy ${esc(m.niche_label.toLowerCase())} services, roughly ${m.projects_estimate} projects over ${m.period_months} month(s).</li>
        <li><b>Up for grabs:</b> around ${'₹' + Number(m.up_for_grabs_monthly_estimate).toLocaleString('en-IN')} a month has no retained agency.</li>
        <li><b>Growth:</b> ${m.growth_pct}% a year. <b>Pitch:</b> ${esc(m.suggested_pitch)}.</li>
        <li><b>Your pipeline here:</b> ${all.length} lead(s), ${counts.hot} hot within 12 km.</li>
      </ul>
      <div class="mini" style="margin-top:8px">Estimates are modeled from category benchmarks; lead counts are real.</div>
    </div>
  </div>
  <div class="card" style="margin-bottom:12px">
    <h3 style="margin-bottom:8px">Who's here <span class="mini">your leads in ${esc(m.city || 'this city')}, highest score first</span></h3>
    ${rows ? `<div class="tableWrap"><table class="table"><thead><tr><th>Business</th><th>Area</th><th>Distance</th><th>Reviews</th><th>Score</th><th>Tier</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty">Nothing to list yet.</div>'}
  </div>`;
}

// Modeled forecast: current monthly spend grown at the category's annual growth rate.
// Labeled as a model, not live data.
function forecastSection(m) {
  const money = (n) => '₹' + (n >= 1e7 ? (n / 1e7).toFixed(1) + ' Cr' : n >= 1e5 ? (n / 1e5).toFixed(1) + ' L' : Number(n).toLocaleString('en-IN'));
  const g = Math.pow(1 + m.growth_pct / 100, 1 / 12);
  const vals = Array.from({ length: 7 }, (_, i) => m.monthly_spend_estimate * Math.pow(g, i));
  const W = 700, H = 200, P = 30;
  const max = Math.max(...vals) * 1.15;
  const min = Math.min(...vals) * 0.85;
  const x = (i) => P + (i / 6) * (W - 2 * P);
  const y = (v) => H - P - ((v - min) / (max - min || 1)) * (H - 2 * P);
  const path = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const labels = ['Now', '+1', '+2', '+3', '+4', '+5', '+6'].map((t, i) => `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="var(--muted)">${i ? t + ' mo' : t}</text>`).join('');
  return `<div class="card" style="margin-bottom:12px">
    <h3 style="margin-bottom:4px">Forecast: the next 6 months</h3>
    <div class="mini" style="margin-bottom:10px">Modeled by growing this category's estimated monthly spend at ${m.growth_pct}% a year. Illustrative, not live market data.</div>
    <div class="grid g4" style="margin-bottom:10px">
      ${kpi('Now', money(vals[0]), 'est. monthly spend')}
      ${kpi('In 3 months', money(vals[3]), `${((vals[3] / vals[0] - 1) * 100).toFixed(1)}% vs now`)}
      ${kpi('In 6 months', money(vals[6]), `${((vals[6] / vals[0] - 1) * 100).toFixed(1)}% vs now`)}
      ${kpi('Projects / month', Math.round(m.projects_estimate / m.period_months), 'today, est.')}
    </div>
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;background:var(--panel);border-radius:10px"><path d="${path}" fill="none" stroke="#4f86f7" stroke-width="2" stroke-dasharray="5 4"/>${vals.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="3" fill="#4f86f7"/>`).join('')}${labels}</svg>
  </div>`;
}

function breakdownTable(rows, key, labelFn) {
  const sorted = [...rows].sort((a, b) => b.lead_count - a.lead_count);
  if (!sorted.some((r) => r.lead_count > 0)) return '<div class="empty">No leads yet - add some to see this breakdown.</div>';
  return `<div class="tableWrap"><table class="table"><thead><tr><th>${key === 'city' ? 'Location' : 'Niche'}</th><th>Leads</th><th>Hot</th><th>Warm</th><th>Parked</th><th>Avg score</th></tr></thead><tbody>${sorted
    .filter((r) => r.lead_count > 0)
    .map((r) => `<tr><td>${labelFn(r)}</td><td>${r.lead_count}</td><td>${r.hot}</td><td>${r.warm}</td><td>${r.parked}</td><td>${r.avg_score ?? '—'}</td></tr>`)
    .join('')}</tbody></table></div>`;
}

// ---------- leads ----------

async function paintLeads() {
  const rows = await loadLeads();
  renderLeadsList(rows);
}

async function loadLeads() {
  const qs = new URLSearchParams({ ...(filters.q && { q: filters.q }), ...(filters.tier && { tier: filters.tier }), ...(filters.niche && { niche: filters.niche }), ...(filters.status && { status: filters.status }) });
  const d = await api('/api/hunter/leads?' + qs.toString());
  return d.rows || [];
}

function renderLeadsList(rows) {
  $('hunterBody').innerHTML = `<div class="card">
    <div class="sectionHead">
      <div class="pnl">
        <input id="hlSearch" placeholder="Search name or city" value="${esc(filters.q)}" style="min-width:200px">
        <select id="hlTier"><option value="">All tiers</option><option value="hot" ${filters.tier === 'hot' ? 'selected' : ''}>Hot</option><option value="warm" ${
    filters.tier === 'warm' ? 'selected' : ''
  }>Warm</option><option value="parked" ${filters.tier === 'parked' ? 'selected' : ''}>Parked</option></select>
        <select id="hlNiche"><option value="">All niches</option>${Object.entries(NICHES)
          .map(([k, v]) => `<option value="${k}" ${filters.niche === k ? 'selected' : ''}>${esc(v)}</option>`)
          .join('')}</select>
        <select id="hlStatus"><option value="">All statuses</option>${Object.entries(STATUS_LABEL)
          .map(([k, v]) => `<option value="${k}" ${filters.status === k ? 'selected' : ''}>${esc(v)}</option>`)
          .join('')}</select>
      </div>
      <button class="btn" data-tab="add" id="hlAddBtn">${icon('plus')}<span>Add lead</span></button>
    </div>
    <div class="tableWrap"><table class="table"><thead><tr><th>Score</th><th>Business</th><th>Niche</th><th>Location</th><th>Why now</th><th>Status</th></tr></thead><tbody>${
      rows.length
        ? rows
            .map(
              (l) =>
                `<tr class="click" data-open-lead="${l.id}"><td><b>${l.score}</b> <span class="badge ${TIER_CLASS[l.tier] || 'gray'}">${esc(l.tier)}</span></td><td>${esc(l.name)}</td><td class="mini">${esc(
                  NICHES[l.niche] || l.niche
                )}</td><td class="mini">${esc(l.city || '—')}</td><td class="mini">${esc(l.signal_title || '—')}</td><td><span class="badge gray">${esc(STATUS_LABEL[l.status] || l.status)}</span></td></tr>`
            )
            .join('')
        : '<tr><td colspan="6" class="empty">No leads match these filters.</td></tr>'
    }</tbody></table></div>
  </div>`;
  ['hlSearch', 'hlTier', 'hlNiche', 'hlStatus'].forEach((id) => {
    const el = $(id);
    const ev = id === 'hlSearch' ? 'input' : 'change';
    el.addEventListener(ev, async () => {
      filters = { q: $('hlSearch').value, tier: $('hlTier').value, niche: $('hlNiche').value, status: $('hlStatus').value };
      const caret = el.selectionStart;
      renderLeadsList(await loadLeads());
      // The list is rebuilt on every change, which dropped focus after each typed character -
      // put the cursor back where it was so typing keeps flowing.
      const fresh = $(id);
      if (fresh && ev === 'input') {
        fresh.focus();
        if (caret != null) fresh.setSelectionRange(caret, caret);
      }
    });
  });
  $('hlAddBtn').onclick = () => switchTab('add');
  $('page-hunter')
    .querySelectorAll('[data-open-lead]')
    .forEach((tr) => (tr.onclick = () => openLeadDetail(Number(tr.dataset.openLead))));
}

async function openLeadDetail(id) {
  const d = await api('/api/hunter/leads/' + id);
  const l = d.lead;
  const ch = l.channels || {};
  const swot = l.swot || {};
  const chRow = (label, c) =>
    c
      ? `<div class="statline"><span>${esc(label)}</span><span>${c.score != null ? `<span class="badge gray">${c.score}/5</span>` : '<span class="mini">not checked</span>'} ${esc(
          (c.evidence || []).join(', ')
        )}</span></div>`
      : '';
  const col = (title, items) => `<div><h3 style="margin-bottom:6px">${title}</h3>${items && items.length ? `<ul style="margin:0;padding-left:18px">${items.map((i) => `<li class="mini">${esc(i)}</li>`).join('')}</ul>` : '<div class="mini">None noted.</div>'}</div>`;
  openModal(
    l.name,
    `<div class="mini" style="margin-bottom:8px">${esc(NICHES[l.niche] || l.niche)} &middot; ${esc(l.city || '—')} &middot; <span class="badge ${TIER_CLASS[l.tier] || 'gray'}">${esc(l.tier)}</span> score ${l.score}</div>
    ${l.elevator_pitch ? `<div class="notice ok" style="margin-bottom:10px"><b>Opening line:</b> ${esc(l.elevator_pitch)}</div>` : ''}
    <div class="card soft" style="margin-bottom:10px">${chRow('Website', ch.website)}${chRow('Instagram', ch.instagram)}${chRow('Google Business', ch.gmb)}</div>
    <div class="grid g3" style="margin-bottom:10px">${col('Strengths', swot.strengths)}${col('Weaknesses', swot.weaknesses)}${col('Opportunities', swot.opportunities)}</div>
    <div class="row" style="margin-bottom:10px">
      <select id="hdStatus">${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}" ${l.status === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
      <button class="btn alt" id="hdSave">Save status</button>
      ${cfg.enabled ? `<button class="btn alt" id="hdDraft">${icon('send')}<span>${d.touches.length ? 'Re-draft outreach' : 'Draft outreach'}</span></button>` : ''}
      <button class="btn danger" id="hdDelete">${icon('trash')}<span>Delete</span></button>
    </div>
    <h3 style="margin-bottom:6px">Outreach drafts</h3>
    ${
      d.touches.length
        ? d.touches
            .map(
              (t) =>
                `<div class="statline" style="align-items:flex-start"><span class="mini">${esc(t.channel)} &middot; ${esc(t.to_value || '')}</span><span class="badge gray">${esc(t.status)}${
                  t.outcome ? ' · ' + esc(t.outcome) : ''
                }</span></div>`
            )
            .join('')
        : '<div class="empty">No drafts yet.</div>'
    }`,
    { wide: true }
  );
  $('hdSave').onclick = async () => {
    try {
      await api('/api/hunter/leads/' + id, { method: 'PUT', body: JSON.stringify({ status: $('hdStatus').value }) });
      toast('Status updated');
      closeModal();
      await loadTab();
    } catch (e) {
      toast(e.message || 'Could not update status');
    }
  };
  if ($('hdDraft')) {
    $('hdDraft').onclick = async () => {
      $('hdDraft').disabled = true;
      try {
        await api(`/api/hunter/leads/${id}/draft`, { method: 'POST' });
        toast('Outreach drafted - check Approvals');
        closeModal();
        await loadTab();
      } catch (e) {
        toast(e.message || 'Could not draft outreach');
      } finally {
        if ($('hdDraft')) $('hdDraft').disabled = false;
      }
    };
  }
  $('hdDelete').onclick = async () => {
    const ok = await confirmDialog(`Delete ${l.name} from Client Hunter?`, { title: 'Delete Lead', confirmText: 'Delete', danger: true });
    if (!ok) return;
    try {
      await api('/api/hunter/leads/' + id, { method: 'DELETE' });
      toast('Lead deleted');
      closeModal();
      await loadTab();
    } catch (e) {
      toast(e.message || 'Could not delete lead');
    }
  };
}

// ---------- add lead ----------

const PLATFORMS = ['Instagram', 'LinkedIn', 'Threads', 'X', 'Reddit', 'Facebook groups', 'Upwork', 'Fiverr', 'Contra', 'Referral', 'Walk-in', 'Other'];

function paintAdd() {
  $('hunterBody').innerHTML = `
  <div class="title" style="margin-bottom:10px"><h2 style="margin:0">Add leads</h2><p>For leads your team spots by hand: Instagram, LinkedIn, Threads, X, Reddit, Facebook groups, Upwork, Fiverr, Contra, referrals and walk-ins. The tool audits the website, scores each lead${cfg.enabled ? ' and drafts outreach for your approval' : ''}.</p></div>
  <div class="notice warn" style="margin-bottom:12px">Only add business details the business published itself: website, Google profile, bio or company page. Never personal numbers or anything from private groups.</div>
  <div class="card" style="margin-bottom:14px">
    <form id="addLeadForm"><div class="fgrid">
      <div class="field"><label>Business name *</label><input id="al1" required></div>
      <div class="field"><label>Niche</label><select id="al2">${Object.entries(NICHES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></div>
      <div class="field"><label>Location</label><select id="al3">${CITIES.map((c) => `<option>${esc(c)}</option>`).join('')}</select></div>
      <div class="field"><label>Instagram</label><input id="al5" placeholder="@handle"></div>
      <div class="field"><label>Website</label><input id="al4" type="url" placeholder="optional"></div>
      <div class="field"><label>Found on</label><select id="alPlat">${PLATFORMS.map((p) => `<option>${esc(p)}</option>`).join('')}</select></div>
      <div class="field"><label>Signal</label><select id="al11">${Object.entries(SIGNALS).map(([k, v]) => `<option value="${k}" ${k === 'manual' ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></div>
      <div class="field"><label>Business email</label><input id="al7" type="email"></div>
      <div class="field full"><label>What did they post or need?</label><textarea id="al12"></textarea></div>
    </div>
    <details style="margin-top:8px"><summary class="mini" style="cursor:pointer">More details (optional)</summary>
      <div class="fgrid" style="margin-top:8px">
        <div class="field"><label>LinkedIn</label><input id="al6" placeholder="linkedin.com/company/..."></div>
        <div class="field"><label>Phone</label><input id="al8"></div>
        <div class="field"><label>Contact name</label><input id="al9"></div>
        <div class="field"><label>Contact role</label><input id="al10"></div>
        <div class="field"><label>Google rating</label><input id="al13" type="number" step="0.1" min="0" max="5"></div>
        <div class="field"><label>Google reviews</label><input id="al14" type="number" min="0"></div>
        <div class="field"><label>Instagram followers</label><input id="al15" type="number" min="0"></div>
        <div class="field"><label>Last Instagram post (days ago)</label><input id="al16" type="number" min="0"></div>
        <div class="field full"><label>Notes</label><textarea id="al17"></textarea></div>
      </div>
    </details>
    <button class="btn" id="alSubmit" style="margin-top:10px">${icon('plus')}<span>Add and audit</span></button>
    <div id="addLoading" class="mini hidden" style="margin-top:8px">Checking the website and scoring the lead${cfg.enabled ? ', then drafting outreach' : ''}…</div>
    </form>
  </div>
  <div class="card">
    <h3 style="margin-bottom:6px">Bulk import</h3>
    <div class="mini" style="margin-bottom:8px">Upload a CSV with columns: <b>name</b> (required), niche, city, website, instagram, linkedin, phone, contact_name, contact_role, contact_email (or email), signal_type, source_platform, source_url, notes, and optionally lat, lng. Each row is audited, scored${cfg.enabled ? ' and drafted' : ''} the same way as a single lead. Up to 200 rows at a time.</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
      <input type="file" id="bulkFile" accept=".csv,text/csv">
      <button class="btn alt" id="bulkGo" type="button">Import</button>
      <button class="btn alt" id="bulkTpl" type="button">Download template</button>
    </div>
    <div id="bulkOut" class="mini" style="margin-top:10px"></div>
  </div>`;
  $('addLeadForm').onsubmit = submitAdd;
  $('bulkGo').onclick = runBulkImport;
  $('bulkTpl').onclick = () => {
    const csv = 'name,niche,city,website,instagram,linkedin,phone,contact_name,contact_role,contact_email,signal_type,source_platform,source_url,notes\n"Example Cafe",cafe_restaurant,Bangalore,https://example.com,@examplecafe,,,,,hello@example.com,new_opening,Instagram,,Posted opening reel\n';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'client-hunter-leads-template.csv';
    a.click();
  };
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

// Accept either the internal key or the visible label for niche / signal / city.
function matchKey(map, value, fallback) {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return fallback;
  const hit = Object.entries(map).find(([k, label]) => k.toLowerCase() === v || String(label).toLowerCase() === v);
  return hit ? hit[0] : fallback;
}

async function runBulkImport() {
  const out = $('bulkOut');
  const file = $('bulkFile').files[0];
  if (!file) { out.textContent = 'Choose a CSV file first.'; return; }
  const table = parseCsv(await file.text());
  if (table.length < 2) { out.textContent = 'That file has no data rows.'; return; }
  const head = table[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const get = (r, ...names) => {
    for (const n of names) { const i = head.indexOf(n); if (i >= 0 && r[i] != null && String(r[i]).trim()) return String(r[i]).trim(); }
    return '';
  };
  if (!head.includes('name')) { out.textContent = 'The CSV needs a "name" column.'; return; }
  const items = table.slice(1, 201).map((r) => ({
    name: get(r, 'name'),
    niche: matchKey(NICHES, get(r, 'niche'), 'other'),
    city: CITIES.find((c) => c.toLowerCase() === get(r, 'city').toLowerCase()) || get(r, 'city'),
    website: get(r, 'website'),
    instagram: get(r, 'instagram'),
    linkedin: get(r, 'linkedin'),
    phone: get(r, 'phone'),
    contact_name: get(r, 'contact_name'),
    contact_role: get(r, 'contact_role'),
    email: get(r, 'contact_email', 'email'),
    signal_type: matchKey(SIGNALS, get(r, 'signal_type', 'signal'), 'manual'),
    source_platform: get(r, 'source_platform', 'found_on'),
    signal_title: get(r, 'source_url'),
    notes: get(r, 'notes'),
    lat: get(r, 'lat'),
    lng: get(r, 'lng'),
  }));
  const btn = $('bulkGo');
  btn.disabled = true;
  let added = 0, drafted = 0;
  const skipped = [];
  try {
    for (let i = 0; i < items.length; i += 10) {
      out.textContent = `Auditing and scoring… ${Math.min(i + 10, items.length)} of ${items.length}`;
      const r = await api('/api/hunter/leads/bulk', { method: 'POST', body: JSON.stringify({ rows: items.slice(i, i + 10) }) });
      added += r.added;
      drafted += r.drafted;
      r.skipped.forEach((s) => skipped.push({ ...s, row: s.row + i }));
    }
  } catch (e) {
    skipped.push({ row: '-', reason: e.message || 'import stopped' });
  }
  btn.disabled = false;
  out.innerHTML = `<b>${added}</b> lead(s) added${cfg.enabled ? `, ${drafted} drafted for approval` : ''}.${
    skipped.length ? `<br>Skipped ${skipped.length}: ${skipped.slice(0, 8).map((s) => `row ${s.row}${s.name ? ' (' + esc(s.name) + ')' : ''} - ${esc(s.reason)}`).join('; ')}` : ''
  }`;
  if (added) toast(`${added} leads imported`);
}

async function submitAdd(e) {
  e.preventDefault();
  const btn = $('alSubmit');
  btn.disabled = true;
  $('addLoading').classList.remove('hidden');
  const body = {
    name: $('al1').value,
    niche: $('al2').value,
    city: $('al3').value,
    website: $('al4').value,
    instagram: $('al5').value,
    linkedin: $('al6').value,
    email: $('al7').value,
    phone: $('al8').value,
    contact_name: $('al9').value,
    contact_role: $('al10').value,
    signal_type: $('al11').value,
    signal_title: $('al12').value,
    source_platform: $('alPlat').value,
    gmb_rating: $('al13').value || null,
    gmb_reviews: $('al14').value || null,
    ig_followers: $('al15').value || null,
    ig_last_post_days: $('al16').value || null,
    notes: $('al17').value,
  };
  try {
    await api('/api/hunter/leads', { method: 'POST', body: JSON.stringify(body) });
    toast('Lead added and scored');
    tab = 'leads';
    await renderHunter();
  } catch (err) {
    toast(err.message || 'Could not add this lead');
  } finally {
    if (btn) btn.disabled = false;
    if ($('addLoading')) $('addLoading').classList.add('hidden');
  }
}

// ---------- approvals / tasks ----------

async function paintTouches(statusFilter, mode) {
  const d = await api('/api/hunter/touches?status=' + statusFilter);
  const rows = (d.rows || []).filter((r) => (mode === 'tasks' ? !r.outcome : true));
  $('hunterBody').innerHTML = `<div class="card">
    <h3 style="margin-bottom:10px">${mode === 'approvals' ? 'Approvals' : 'Tasks'}</h3>
    <div class="mini" style="margin-bottom:10px">${mode === 'approvals' ? 'Review each AI-drafted message. Edit if needed, then approve or reject - nothing sends itself.' : 'Approved messages waiting to be sent by hand (DM, call, email) and logged below.'}</div>
    ${
      rows.length
        ? rows
            .map(
              (t) => `<div class="card soft" style="margin-bottom:10px">
        <div class="row" style="justify-content:space-between"><b>${esc(t.lead_name)}</b><span class="badge ${TIER_CLASS[t.lead_tier] || 'gray'}">${esc(t.lead_tier)}</span></div>
        <div class="mini" style="margin:4px 0">${esc(t.channel)} &middot; ${esc(t.to_value || '')}</div>
        ${t.subject ? `<div class="field"><label>Subject</label><input data-subject="${t.id}" value="${esc(t.subject)}" ${mode === 'tasks' ? 'readonly' : ''}></div>` : ''}
        <div class="field"><label>Message</label><textarea data-body="${t.id}" ${mode === 'tasks' ? 'readonly' : ''}>${esc(t.body)}</textarea></div>
        ${
          mode === 'approvals'
            ? `<div class="pnl" style="margin-top:8px"><button class="btn" data-approve="${t.id}">Approve</button><button class="btn alt" data-reject="${t.id}">Reject</button></div>`
            : `<div class="pnl" style="margin-top:8px">
                <button class="btn alt" data-copy="${t.id}">Copy message</button>
                <button class="btn" data-outcome="${t.id}" data-outcome-val="interested">Interested</button>
                <button class="btn alt" data-outcome="${t.id}" data-outcome-val="not_now">Not now</button>
                <button class="btn danger" data-outcome="${t.id}" data-outcome-val="asked_to_stop">Asked to stop</button>
              </div>`
        }
      </div>`
            )
            .join('')
        : `<div class="empty">Nothing ${mode === 'approvals' ? 'to approve' : 'pending'} right now.</div>`
    }
  </div>`;

  $('page-hunter')
    .querySelectorAll('[data-approve]')
    .forEach((b) => (b.onclick = () => approveTouch(Number(b.dataset.approve))));
  $('page-hunter')
    .querySelectorAll('[data-reject]')
    .forEach((b) => (b.onclick = () => rejectTouch(Number(b.dataset.reject))));
  $('page-hunter')
    .querySelectorAll('[data-copy]')
    .forEach((b) => (b.onclick = () => copyTouch(Number(b.dataset.copy))));
  $('page-hunter')
    .querySelectorAll('[data-outcome]')
    .forEach((b) => (b.onclick = () => logOutcome(Number(b.dataset.outcome), b.dataset.outcomeVal)));
}

async function approveTouch(id) {
  const subject = document.querySelector(`[data-subject="${id}"]`)?.value;
  const body = document.querySelector(`[data-body="${id}"]`)?.value;
  try {
    await api(`/api/hunter/touches/${id}/approve`, { method: 'PUT', body: JSON.stringify({ subject, body }) });
    toast('Approved - moved to Tasks');
    await loadTab();
  } catch (e) {
    toast(e.message || 'Could not approve this message');
  }
}

async function rejectTouch(id) {
  try {
    await api(`/api/hunter/touches/${id}/reject`, { method: 'PUT' });
    toast('Rejected');
    await loadTab();
  } catch (e) {
    toast(e.message || 'Could not reject this message');
  }
}

async function copyTouch(id) {
  const body = document.querySelector(`[data-body="${id}"]`)?.value || '';
  try {
    await navigator.clipboard.writeText(body);
    toast('Message copied');
  } catch (e) {
    toast('Could not copy - select the text and copy it manually');
  }
}

async function logOutcome(id, outcome) {
  if (outcome === 'asked_to_stop') {
    const ok = await confirmDialog('Add this contact to the do-not-contact list and stop reaching out to them?', { title: 'Asked to Stop', confirmText: 'Add & Stop', danger: true });
    if (!ok) return;
  }
  try {
    await api(`/api/hunter/touches/${id}/outcome`, { method: 'PUT', body: JSON.stringify({ outcome }) });
    toast('Logged');
    await loadTab();
  } catch (e) {
    toast(e.message || 'Could not log that outcome');
  }
}

// ---------- hunts (automatic discovery) ----------

async function paintHunts() {
  const d = await api('/api/hunter/hunts');
  renderHunts(d.rows || []);
}

function renderHunts(rows) {
  $('hunterBody').innerHTML = `<div class="card" style="margin-bottom:14px">
    <h3 style="margin-bottom:8px">New Hunt</h3>
    <div class="mini" style="margin-bottom:10px">Each hunt searches Google Maps for a niche in a location and keeps only businesses showing a buying signal (new/few reviews, no website, or under 4.0 rating).</div>
    <form id="huntForm" class="row" style="gap:8px;flex-wrap:wrap">
      <select id="huNiche">${Object.entries(NICHES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
      <select id="huCity">${CITIES.map((c) => `<option>${esc(c)}</option>`).join('')}</select>
      <button class="btn" ${cfg.hunts_enabled === false ? 'disabled' : ''}>${icon('plus')}<span>Add hunt</span></button>
    </form>
  </div>
  <div class="card">
    <h3 style="margin-bottom:8px">Hunts</h3>
    ${
      rows.length
        ? `<div class="tableWrap"><table class="table"><thead><tr><th>Niche</th><th>Location</th><th>Last run</th><th>Found</th><th>Kept</th><th></th></tr></thead><tbody>${rows
            .map(
              (h) =>
                `<tr><td>${esc(NICHES[h.niche] || h.niche)}</td><td>${esc(h.city)}</td><td class="mini">${h.last_run_at ? new Date(h.last_run_at).toLocaleString('en-IN') : 'Never'}</td><td>${
                  h.found_count
                }</td><td>${h.kept_count}</td><td class="pnl"><button class="btn alt" style="padding:3px 9px;font-size:11px" data-run-hunt="${h.id}" ${
                  cfg.hunts_enabled === false ? 'disabled' : ''
                }>Run now</button><button class="btn danger" style="padding:3px 9px;font-size:11px" data-del-hunt="${h.id}">${icon('trash')}</button></td></tr>`
            )
            .join('')}</tbody></table></div>`
        : '<div class="empty">No hunts set up yet.</div>'
    }
  </div>`;

  $('huntForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/api/hunter/hunts', { method: 'POST', body: JSON.stringify({ niche: $('huNiche').value, city: $('huCity').value }) });
      toast('Hunt added');
      await paintHunts();
    } catch (err) {
      toast(err.message || 'Could not add this hunt');
    }
  };
  $('page-hunter')
    .querySelectorAll('[data-run-hunt]')
    .forEach((b) => (b.onclick = () => runHunt(Number(b.dataset.runHunt), b)));
  $('page-hunter')
    .querySelectorAll('[data-del-hunt]')
    .forEach((b) => (b.onclick = () => deleteHunt(Number(b.dataset.delHunt))));
}

async function runHunt(id, btn) {
  btn.disabled = true;
  btn.textContent = 'Running…';
  try {
    const r = await api(`/api/hunter/hunts/${id}/run`, { method: 'POST' });
    toast(`Found ${r.found}, kept ${r.kept} new lead(s) - check Leads`);
    await paintHunts();
  } catch (e) {
    toast(e.message || 'Hunt run failed');
    btn.disabled = false;
    btn.textContent = 'Run now';
  }
}

async function deleteHunt(id) {
  const ok = await confirmDialog('Delete this hunt? Leads it already found stay in your pipeline.', { title: 'Delete Hunt', confirmText: 'Delete', danger: true });
  if (!ok) return;
  try {
    await api('/api/hunter/hunts/' + id, { method: 'DELETE' });
    toast('Hunt deleted');
    await paintHunts();
  } catch (e) {
    toast(e.message || 'Could not delete this hunt');
  }
}

// ---------- compliance (Admin only) ----------

async function paintCompliance() {
  if (!isAdmin()) return;
  try {
    const [d, r, a] = await Promise.all([api('/api/compliance/dnc'), api('/api/compliance/data-requests'), api('/api/compliance/activity')]);
    complianceCache = { dnc: d.rows || [], requests: r.rows || [], activity: a.rows || [], lastResult: complianceCache.lastResult };
  } catch (e) {
    complianceCache = { dnc: [], requests: [], activity: [], lastResult: null };
  }
  renderCompliance();
}

function renderCompliance() {
  const { dnc, requests, activity, lastResult } = complianceCache;
  $('hunterBody').innerHTML = `<div class="notice" style="margin-bottom:12px">Do-not-contact list, data subject requests (DPDP Act / GDPR style), and a record of who did what - the guardrails for this module's outreach.</div>
  <div class="grid g2" style="align-items:start">
    <div>
      <div class="card" style="margin-bottom:14px">
        <h3 style="margin-bottom:10px">Data Request</h3>
        <form id="drForm" class="row" style="gap:8px;flex-wrap:wrap">
          <select id="drKind"><option value="access">Access - show what we hold</option><option value="delete">Erasure - delete and never contact</option></select>
          <input id="drValue" placeholder="Email or phone" required style="flex:1;min-width:200px">
          <button class="btn">${icon('search')}<span>Run</span></button>
        </form>
        <div id="drOut" style="margin-top:12px">${lastResult ? complianceResultHtml(lastResult) : ''}</div>
        ${requests.length ? `<div class="mini" style="margin-top:12px">Recent requests</div><div class="scroll-x" style="margin-top:4px">${complianceRequestsTable(requests)}</div>` : ''}
      </div>
      <div class="card">
        <h3 style="margin-bottom:10px">Do-Not-Contact List</h3>
        <form id="dncForm" class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:10px">
          <select id="dncType"><option value="email">email</option><option value="phone">phone</option><option value="domain">domain</option><option value="instagram">instagram</option></select>
          <input id="dncValue" placeholder="Value" required style="flex:1;min-width:150px">
          <input id="dncReason" placeholder="Reason (optional)" style="flex:1;min-width:150px">
          <button class="btn">${icon('plus')}<span>Add</span></button>
        </form>
        ${complianceDncTable(dnc)}
      </div>
    </div>
    <div>
      <div class="card" style="margin-bottom:14px">
        <h3 style="margin-bottom:8px">Built-in Rules</h3>
        <ul style="margin:0;padding-left:18px">${COMPLIANCE_RULES.map((r) => `<li class="mini" style="margin-bottom:6px;color:var(--ink)">${esc(r)}</li>`).join('')}</ul>
      </div>
      <div class="card">
        <h3 style="margin-bottom:8px">Activity</h3>
        ${activity.length ? activity.slice(0, 20).map((x) => complianceActivityRow(x)).join('') : '<div class="empty">Nothing logged yet.</div>'}
      </div>
    </div>
  </div>`;

  $('drForm').addEventListener('submit', submitDataRequest);
  $('dncForm').addEventListener('submit', submitDnc);
  wireDncDeletes();
}

function complianceActivityRow(x) {
  const verb = { CREATE: 'added', DELETE: 'removed', ACCESS: 'ran an access request for', UPDATE: 'updated' }[x.action] || x.action.toLowerCase();
  return `<div class="statline" style="display:block;padding:7px 0;border-bottom:1px solid var(--line)"><div class="mini">${new Date(x.created_at).toLocaleString('en-IN')} &middot; ${esc(
    x.actor || 'System'
  )}</div><div>${verb} ${esc(x.entity_type.replace('_', ' '))}${x.meta ? ' - ' + esc(x.meta) : ''}</div></div>`;
}

function complianceDncTable(dnc) {
  if (!dnc.length) return '<div class="empty">Nobody is on the list yet.</div>';
  return `<div class="tableWrap"><table class="table"><thead><tr><th>Value</th><th>Type</th><th>Reason</th><th>Added</th><th></th></tr></thead><tbody>${dnc
    .map(
      (d) =>
        `<tr><td>${esc(d.value)}</td><td class="mini">${esc(d.type)}</td><td class="mini">${esc(d.reason || '-')}</td><td class="mini">${new Date(d.created_at).toLocaleDateString('en-IN')}${
          d.added_by_name ? ' by ' + esc(d.added_by_name) : ''
        }</td><td><button class="btn danger" style="padding:3px 9px;font-size:11px" data-del-dnc="${d.id}">${icon('trash')}</button></td></tr>`
    )
    .join('')}</tbody></table></div>`;
}

function complianceRequestsTable(requests) {
  return `<div class="tableWrap"><table class="table"><thead><tr><th>Kind</th><th>Contact</th><th>When</th></tr></thead><tbody>${requests
    .slice(0, 8)
    .map((r) => `<tr><td class="mini">${esc(r.kind)}</td><td class="mini">${esc(r.contact_value)}</td><td class="mini">${new Date(r.created_at).toLocaleDateString('en-IN')}</td></tr>`)
    .join('')}</tbody></table></div>`;
}

function complianceResultHtml(r) {
  const leads = r.result?.leads || [];
  const candidates = r.result?.candidates || [];
  const rowsOf = (arr, labelField) =>
    arr.length
      ? arr.map((x) => `<div class="statline"><span>${esc(x[labelField] || '-')}</span><span class="mini">${esc(x.phone || '')} ${esc(x.email || '')}</span></div>`).join('')
      : '<div class="mini">None found.</div>';
  return `<div class="notice ${r.kind === 'delete' ? 'warn' : 'ok'}">
    <b>${r.kind === 'delete' ? 'Erasure' : 'Access'} request for ${esc(r.contact_value)}</b>${
    r.kind === 'delete' ? ' - personal fields removed, added to the do-not-contact list.' : ''
  }
    <div style="margin-top:8px"><div class="mini" style="text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Leads</div>${rowsOf(leads, 'business_name')}</div>
    <div style="margin-top:8px"><div class="mini" style="text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Candidates</div>${rowsOf(candidates, 'name')}</div>
  </div>`;
}

async function submitDataRequest(e) {
  e.preventDefault();
  const kind = $('drKind').value;
  const contact_value = $('drValue').value.trim();
  if (!contact_value) return;
  if (kind === 'delete') {
    const ok = await confirmDialog(
      `Erase all personal data for "${contact_value}"? Their name, phone and email will be removed from leads/candidates and they will be added to the do-not-contact list. This cannot be undone.`,
      { title: 'Erase Personal Data', confirmText: 'Erase', danger: true }
    );
    if (!ok) return;
  }
  try {
    const r = await api('/api/compliance/data-requests', { method: 'POST', body: JSON.stringify({ kind, contact_value }) });
    complianceCache.lastResult = r;
    toast(kind === 'delete' ? 'Erased and added to the do-not-contact list' : 'Access request completed');
    await paintCompliance();
  } catch (err) {
    toast(err.message || 'Could not run that request');
  }
}

async function submitDnc(e) {
  e.preventDefault();
  const type = $('dncType').value;
  const value = $('dncValue').value.trim();
  const reason = $('dncReason').value.trim();
  if (!value) return;
  try {
    await api('/api/compliance/dnc', { method: 'POST', body: JSON.stringify({ type, value, reason }) });
    toast('Added to the do-not-contact list');
    await paintCompliance();
  } catch (err) {
    toast(err.message || 'Could not add that entry');
  }
}

function wireDncDeletes() {
  $('page-hunter')
    .querySelectorAll('[data-del-dnc]')
    .forEach((b) => {
      b.onclick = async () => {
        const id = Number(b.dataset.delDnc);
        const row = complianceCache.dnc.find((d) => d.id === id);
        const ok = await confirmDialog(`Remove ${row?.value || 'this entry'} from the do-not-contact list?`, { title: 'Remove Entry', confirmText: 'Remove' });
        if (!ok) return;
        try {
          await api('/api/compliance/dnc/' + id, { method: 'DELETE' });
          toast('Removed');
          await paintCompliance();
        } catch (err) {
          toast(err.message || 'Could not remove that entry');
        }
      };
    });
}
