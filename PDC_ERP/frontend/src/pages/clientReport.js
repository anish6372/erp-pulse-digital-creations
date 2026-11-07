// Monthly report for one client, built from Social, Content and Task data. Print it to save as a PDF for the owner.
import { api } from '../lib/api.js';
import { state } from '../lib/state.js';
import { $, esc, toast, dateNow } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { lineChart } from '../lib/charts.js';

let clientId = 0;
let month = dateNow().slice(0, 7);
let report = null;

const fmt = (n) => {
  n = Number(n) || 0;
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (Math.abs(n) >= 1e4) return Math.round(n / 1e3) + 'k';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(Math.round(n * 10) / 10);
};
const monthLabel = (m) => new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(m + '-01T00:00:00Z'));
const pctChange = (cur, prev) => (prev ? Math.round(((cur - prev) / prev) * 100) : null);
const arrow = (p) => (p === null ? '' : `<span class="rp-delta ${p >= 0 ? 'up' : 'down'}">${p >= 0 ? '&#8599;' : '&#8600;'} ${Math.abs(p)}% vs last month</span>`);

export async function renderClientReport() {
  if (state.me.role !== 'Admin') return;
  const clients = state.boot.clients.filter((c) => c.active);
  if (!clientId && clients.length) clientId = clients[0].id;
  $('page-reports').innerHTML = `
    <div class="title"><h1>Client report</h1><p>A one-page monthly summary to send to the cafe owner. Press Print and choose "Save as PDF".</p></div>
    <div class="rp-controls">
      <div class="chips" style="margin:0;flex:1">${clients
        .map((c) => `<button class="chip ${c.id === clientId ? 'active' : ''}" data-c="${c.id}"><i>${esc(c.name.charAt(0).toUpperCase())}</i>${esc(c.name)}</button>`)
        .join('')}</div>
      <input type="month" id="rpMonth" class="ig-client" value="${month}" max="${dateNow().slice(0, 7)}">
      <button class="btn" id="rpPrint">${icon('report')}<span>Print / Save PDF</span></button>
    </div>
    <div id="rpBody"></div>`;
  $('page-reports')
    .querySelectorAll('[data-c]')
    .forEach((b) => (b.onclick = () => {
      clientId = Number(b.dataset.c);
      renderClientReport();
    }));
  $('rpMonth').onchange = (e) => {
    if (!e.target.value) return;
    month = e.target.value;
    load();
  };
  $('rpPrint').onclick = () => window.print();
  if (!clients.length) {
    $('rpBody').innerHTML = '<div class="empty">Add a client first.</div>';
    return;
  }
  await load();
}

async function load() {
  try {
    report = await api(`/api/client-report?client_id=${clientId}&month=${month}`);
  } catch (e) {
    $('rpBody').innerHTML = `<div class="card"><div class="err">${esc(e.message)}</div></div>`;
    return;
  }
  paint();
}

function bars(rows, suffix = '%') {
  if (!rows.length) return '<div class="mini">Not available yet</div>';
  const max = Math.max(...rows.map((r) => r.percentage), 1);
  return rows
    .map(
      (r) =>
        `<div class="fmt-row"><span style="min-width:96px">${esc(r.label)}</span><div class="leader-bar"><i style="width:${Math.round((r.percentage / max) * 100)}%"></i></div><b>${r.percentage}${suffix}</b></div>`
    )
    .join('');
}

// Plain-English sentences the owner can read in ten seconds.
function highlights(r) {
  const out = [];
  const t = r.totals;
  const reachP = pctChange(t.reach, r.previous.reach);
  if (t.count === 0) return ['No Instagram posts were synced for this month yet.'];
  out.push(`${t.count} post${t.count === 1 ? ' was' : 's were'} published and reached ${t.reach.toLocaleString('en-IN')} people.`);
  if (reachP !== null) out.push(`Reach ${reachP >= 0 ? 'grew' : 'fell'} ${Math.abs(reachP)}% compared with last month.`);
  if (r.bestPosts[0]) out.push(`The best performer was “${r.bestPosts[0].title}” with ${r.bestPosts[0].reach.toLocaleString('en-IN')} reach.`);
  if (r.audience.city[0]) out.push(`Most viewers came from ${r.audience.city[0].label} (${r.audience.city[0].percentage}%).`);
  if (r.outcome.offer_redemptions) out.push(`${r.outcome.offer_redemptions} offer${r.outcome.offer_redemptions === 1 ? ' was' : 's were'} redeemed in the café${r.outcome.new_customers ? `, bringing about ${r.outcome.new_customers} new customers` : ''}.`);
  return out;
}

function paint() {
  const r = report;
  const t = r.totals;
  const reachP = pctChange(t.reach, r.previous.reach);
  const followerNet = r.followers.now !== null && r.followers.before !== null ? r.followers.now - r.followers.before : null;
  const stageCount = (s) => r.delivery.byStage.find((x) => x.stage === s)?.n || 0;
  const planned = r.delivery.byStage.reduce((a, x) => a + x.n, 0);

  $('rpBody').innerHTML = `<div class="report-doc">
    <div class="rp-head">
      <div><div class="eyebrow">Monthly performance report</div><h2 class="rp-title">${esc(r.client.name)}</h2><div class="mini">${monthLabel(r.month)}</div></div>
      <img src="/pdc-logo.png" alt="Pulse Digital Creations" class="rp-logo">
    </div>

    <div class="rp-hl"><b>This month in short</b><ul>${highlights(r).map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div>

    <div class="rp-kpis">
      <div class="rp-kpi"><span>Reach</span><b>${fmt(t.reach)}</b>${arrow(reachP)}</div>
      <div class="rp-kpi"><span>Views</span><b>${fmt(t.views)}</b>${arrow(pctChange(t.views, r.previous.views))}</div>
      <div class="rp-kpi"><span>Interactions</span><b>${fmt(t.interactions)}</b><span class="mini">${t.rate}% of reach</span></div>
      <div class="rp-kpi"><span>Followers</span><b>${r.followers.now === null ? '—' : fmt(r.followers.now)}</b><span class="mini">${followerNet === null ? 'month not logged' : (followerNet >= 0 ? '+' : '') + followerNet + ' this month'}</span></div>
    </div>

    ${
      r.reachDaily.length
        ? `<div class="rp-sec"><h3>How far the content travelled each day</h3>${lineChart(r.reachDaily.map((d) => ({ label: d.day.slice(8), value: d.reach })), { width: 900, height: 190 })}</div>`
        : ''
    }

    <div class="rp-sec"><h3>Best posts</h3>${
      r.bestPosts.length
        ? r.bestPosts
            .map(
              (p, i) =>
                `<div class="leader-row" style="margin:8px 0"><span class="leader-rank">${i + 1}</span><div style="min-width:0"><div class="leader-name">${esc(p.title)} <span class="badge gray">${esc(p.post_type || 'Reel')}</span></div><div class="mini">${esc(p.posted_at)}</div></div><span class="leader-val">${fmt(p.reach)} reach</span></div>`
            )
            .join('')
        : '<div class="mini">No posts this month.</div>'
    }</div>

    <div class="rp-cols">
      <div class="rp-sec"><h3>Where viewers are</h3><div class="mini" style="margin-bottom:6px">Top cities</div>${bars(r.audience.city)}<div class="mini" style="margin:12px 0 6px">Top countries</div>${bars(r.audience.country)}</div>
      <div class="rp-sec"><h3>Who they are</h3><div class="mini" style="margin-bottom:6px">Age groups</div>${bars(r.audience.age)}<div class="mini" style="margin:12px 0 6px">Gender</div>${bars(r.audience.gender)}</div>
    </div>

    <div class="rp-cols">
      <div class="rp-sec"><h3>What we delivered</h3>
        <div class="statline"><span>Content planned</span><b>${planned}</b></div>
        <div class="statline"><span>Approved by you</span><b>${stageCount('Approved')}</b></div>
        <div class="statline"><span>Posted</span><b>${stageCount('Posted')}</b></div>
        <div class="statline"><span>Production tasks completed</span><b>${r.delivery.tasksDone}</b></div>
      </div>
      <div class="rp-sec"><h3>Results in your café</h3>
        <form id="outForm" class="rp-out">
          <label>Offers redeemed <input id="oc1" type="number" min="0" value="${r.outcome.offer_redemptions}"></label>
          <label>New customers <input id="oc2" type="number" min="0" value="${r.outcome.new_customers}"></label>
          <label class="full">Notes <input id="oc3" maxlength="500" value="${esc(r.outcome.notes || '')}" placeholder="e.g. Free cookie offer from the 14th reel"></label>
          <button class="btn alt noprint">Save</button>
        </form>
        <div class="mini">Entered with the owner each month, because only the café sees these numbers.</div>
      </div>
    </div>

    <div class="rp-foot">Prepared by Pulse Digital Creations · ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
  </div>`;

  $('outForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/api/client-outcomes', {
        method: 'PUT',
        body: JSON.stringify({ client_id: clientId, month, offer_redemptions: $('oc1').value, new_customers: $('oc2').value, notes: $('oc3').value }),
      });
      toast('Saved');
      await load();
    } catch (err) {
      toast(err.message || 'Could not save');
    }
  };
}
