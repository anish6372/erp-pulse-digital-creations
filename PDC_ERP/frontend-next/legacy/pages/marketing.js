import { api } from '../lib/api.js';
import { state } from '../lib/state.js';
import { $, esc, kpi, toast, animateCountUps, confirmDialog } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { pieChart, barSpark, lineChart } from '../lib/charts.js';
import { openReelModal, openAudienceModal, openGrowthModal } from '../components/modals.js';

let currentClientId = null;
let currentTab = 'today';
let cache = { reels: [], audience: [], growth: [], reach: [] };
let audienceView = 'reached';
let igStatus = null;

const TABS = [
  ['today', 'Overview'],
  ['reels', 'Posts'],
  ['audience', 'Audience'],
  ['growth', 'Growth'],
];

const fmt = (n) => {
  n = Number(n) || 0;
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (Math.abs(n) >= 1e4) return Math.round(n / 1e3) + 'k';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(Math.round(n * 10) / 10);
};

function timeAgo(iso) {
  if (!iso) return '';
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 2) return 'just now';
  if (m < 60) return m + ' min ago';
  if (m < 1440) return Math.round(m / 60) + ' h ago';
  return Math.round(m / 1440) + ' d ago';
}

// Fired once by the OAuth popup (src/routes/instagram.routes.js's /callback page) when the
// Instagram connect flow finishes — registered once at module load, not per-render.
window.addEventListener('message', (e) => {
  if (!e.data || e.data.source !== 'pdc-instagram-oauth') return;
  toast(e.data.ok ? 'Instagram connected' : e.data.message || 'Instagram connect failed');
  if (e.data.ok && $('mktInstagramBar')) renderInstagramBar();
});

const activeClients = () => state.boot.clients.filter((c) => c.active);

export async function renderMarketing() {
  if (state.me.role !== 'Admin') return;
  const clients = activeClients();
  if (!currentClientId && clients.length) currentClientId = clients[0].id;

  $('page-marketing').innerHTML = `<div id="mktChips" class="chips"></div>
    <div id="mktInstagramBar"></div>
    <div class="seg">${TABS.map(([id, label]) => `<button class="${currentTab === id ? 'active' : ''}" data-tab="${id}">${label}</button>`).join('')}</div>
    <div id="mktBody"></div>`;

  if (!clients.length) {
    $('mktBody').innerHTML = '<div class="empty">Add a client first on the Clients page.</div>';
    return;
  }

  $('page-marketing')
    .querySelectorAll('[data-tab]')
    .forEach((b) => (b.onclick = () => renderTab(b.dataset.tab)));

  renderChips();
  await renderInstagramBar();
  await loadAndRender();
}

// One chip per client: click to switch the whole screen to that client's Instagram.
function renderChips() {
  $('mktChips').innerHTML = activeClients()
    .map((c) => `<button class="chip ${c.id === currentClientId ? 'active' : ''}" data-client="${c.id}"><i>${esc(c.name.charAt(0).toUpperCase())}</i>${esc(c.name)}</button>`)
    .join('');
  $('mktChips')
    .querySelectorAll('[data-client]')
    .forEach(
      (b) =>
        (b.onclick = async () => {
          currentClientId = Number(b.dataset.client);
          renderChips();
          await renderInstagramBar();
          await loadAndRender();
        })
    );
}

// Hero card for the selected client: handle, connection state, sync controls and headline numbers.
async function renderInstagramBar() {
  const el = $('mktInstagramBar');
  if (!el) return;
  const client = activeClients().find((c) => c.id === currentClientId) || activeClients()[0];
  try {
    igStatus = await api('/api/instagram/status?client_id=' + currentClientId);
  } catch (e) {
    igStatus = null;
  }
  const s = igStatus || {};
  const connected = !!(s.configured && s.connected);
  const title = connected ? '@' + s.username : client ? client.name : 'Social';
  let actions = '';
  if (s.configured && !s.connected) actions = `<button class="btn" id="igConnectBtn">${icon('link')}<span>Connect Instagram</span></button>`;
  else if (connected)
    actions = `<span class="mini">${s.last_synced_at ? 'Synced ' + timeAgo(s.last_synced_at) : 'Never synced'}</span><button class="btn alt" id="igSyncBtn">${icon(
      'refresh'
    )}<span>Sync now</span></button><button class="btn alt" id="igDisconnectBtn">Disconnect</button>`;
  el.innerHTML = `<div class="hero">
    <div class="hero-top">
      <div class="hero-avatar">${esc((client ? client.name : '?').charAt(0).toUpperCase())}</div>
      <div><div class="hero-name">${esc(title)}</div><div class="hero-sub">${
        connected ? esc(client ? client.name : '') : !s.configured ? 'Instagram sync is not set up yet — you can still log posts by hand' : 'Not connected yet'
      }</div></div>
      <span class="hero-pill ${connected ? 'ok' : ''}">${connected ? 'Connected' : s.configured ? 'Not connected' : 'Manual'}</span>
      <div class="hero-actions">${actions}</div>
    </div>
    <div class="hero-stats" id="heroStats"></div>
  </div>`;
  if ($('igConnectBtn')) $('igConnectBtn').onclick = connectInstagram;
  if ($('igSyncBtn')) $('igSyncBtn').onclick = syncInstagram;
  if ($('igDisconnectBtn')) $('igDisconnectBtn').onclick = disconnectInstagram;
  paintHeroStats();
}

function paintHeroStats() {
  const el = $('heroStats');
  if (!el) return;
  const g = cache.growth;
  const followers = g.length ? g[g.length - 1].followers : 0;
  const net = g.length > 1 ? followers - g[g.length - 2].followers : null;
  const recent = cache.reels.slice().sort((a, b) => (a.posted_at < b.posted_at ? 1 : -1)).slice(0, 12);
  const reach30 = cache.reach.reduce((a, r) => a + r.reach, 0);
  const views = recent.reduce((a, r) => a + r.plays, 0);
  const inter = recent.reduce((a, r) => a + r.likes + r.comments + r.shares + r.saves, 0);
  const reachPosts = recent.reduce((a, r) => a + r.reach, 0);
  const rate = reachPosts ? Math.round((inter / reachPosts) * 1000) / 10 : 0;
  el.innerHTML = `
    <div class="hero-stat"><b>${fmt(followers)}</b><span>Followers${net === null ? '' : ` · ${net >= 0 ? '+' : ''}${fmt(net)} this month`}</span></div>
    <div class="hero-stat"><b>${fmt(reach30)}</b><span>Reach, last ${cache.reach.length || 0} days</span></div>
    <div class="hero-stat"><b>${fmt(views)}</b><span>Views on latest ${recent.length} posts</span></div>
    <div class="hero-stat"><b>${rate}%</b><span>Interactions per reach</span></div>`;
}

async function connectInstagram() {
  try {
    const d = await api('/api/instagram/connect/start?client_id=' + currentClientId);
    const popup = window.open(d.url, 'ig_oauth', 'width=620,height=720');
    if (!popup) toast('Your browser blocked the popup — allow popups for this site and try again.');
  } catch (e) {
    toast(e.message || 'Could not start Instagram connect');
  }
}

async function disconnectInstagram() {
  if (!(await confirmDialog('Disconnect Instagram for this client? You can reconnect any time.', { title: 'Disconnect Instagram', confirmText: 'Disconnect' }))) return;
  try {
    await api('/api/instagram/disconnect', { method: 'POST', body: JSON.stringify({ client_id: currentClientId }) });
    toast('Instagram disconnected');
    await renderInstagramBar();
  } catch (e) {
    toast(e.message || 'Could not disconnect');
  }
}

async function syncInstagram() {
  const btn = $('igSyncBtn');
  if (btn) btn.disabled = true;
  try {
    const d = await api('/api/instagram/sync', { method: 'POST', body: JSON.stringify({ client_id: currentClientId }) });
    toast(`Synced ${d.posts_synced} post${d.posts_synced === 1 ? '' : 's'}` + (d.audience_rows ? '' : ' — no audience data returned') + (d.warnings && d.warnings.length ? ` (${d.warnings.length} warning${d.warnings.length === 1 ? '' : 's'}, see browser console)` : ''));
    if (d.warnings && d.warnings.length) console.warn('Instagram sync warnings:', d.warnings);
    await renderInstagramBar();
    await loadAndRender();
  } catch (e) {
    toast(e.message || 'Sync failed');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function renderTab(tab) {
  currentTab = tab;
  $('page-marketing')
    .querySelectorAll('[data-tab]')
    .forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  loadAndRender();
}

// Loads the numbers shared by the hero card and the overview in one go.
async function loadSummary() {
  const [d, r, g] = await Promise.all([
    api('/api/marketing/reels?client_id=' + currentClientId),
    api('/api/marketing/reach?client_id=' + currentClientId).catch(() => ({ rows: [] })),
    api('/api/marketing/growth?client_id=' + currentClientId).catch(() => ({ rows: [] })),
  ]);
  cache.reels = d.reels;
  cache.reach = r.rows;
  cache.growth = g.rows;
  paintHeroStats();
}

async function loadAndRender() {
  await loadSummary();
  if (currentTab === 'today') renderToday();
  else if (currentTab === 'reels') await loadReels();
  else if (currentTab === 'audience') await loadAudience();
  else await loadGrowth();
  animateCountUps($('page-marketing'));
}

export function reloadMarketingTab() {
  return loadAndRender();
}

// --- Overview ----------------------------------------------------------------

function delta(cur, prev, label) {
  if (!prev) return `<div class="stat-delta flat">${label}</div>`;
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (pct === 0) return `<div class="stat-delta flat">no change ${label}</div>`;
  return `<div class="stat-delta ${pct > 0 ? 'up' : 'down'}">${pct > 0 ? '&#8599;' : '&#8600;'} ${Math.abs(pct)}% ${label}</div>`;
}

function renderToday() {
  const posts = cache.reels.slice().sort((a, b) => (a.posted_at < b.posted_at ? 1 : -1)); // newest first
  const series = cache.reach;
  const total = series.reduce((a, r) => a + r.reach, 0);
  const half = Math.floor(series.length / 2);
  const now = series.slice(half).reduce((a, r) => a + r.reach, 0);
  const before = series.slice(0, half).reduce((a, r) => a + r.reach, 0);
  const sum = (k) => posts.reduce((a, r) => a + r[k], 0);
  const mix = pieChart([
    { label: 'Likes', value: sum('likes') },
    { label: 'Comments', value: sum('comments') },
    { label: 'Shares', value: sum('shares') },
    { label: 'Saves', value: sum('saves') },
  ]);
  const reachAll = sum('reach');
  const perK = reachAll ? Math.round(((sum('saves') + sum('shares')) / reachAll) * 10000) / 10 : 0;
  const top = posts.slice().sort((a, b) => b.reach - a.reach).slice(0, 5);
  const topMax = Math.max(1, ...top.map((p) => p.reach));
  const byType = {};
  posts.forEach((p) => (byType[p.post_type || 'Reel'] = (byType[p.post_type || 'Reel'] || []).concat(p.reach)));
  const types = Object.entries(byType)
    .map(([t, v]) => ({ t, n: v.length, avg: Math.round(v.reduce((a, b) => a + b, 0) / v.length) }))
    .sort((a, b) => b.avg - a.avg);
  const typeMax = Math.max(1, ...types.map((x) => x.avg));
  const newest = posts[0];

  $('mktBody').innerHTML = `
    <div class="ov-grid">
      <div class="card ov-card">
        <div class="ov-head"><span class="ov-title">Reach</span><span class="mini">daily reach added up, last ${series.length} days</span></div>
        <div class="ov-big">${fmt(total)}</div>
        ${series.length > 7 ? delta(now, before, 'vs the earlier half') : '<div class="stat-delta flat">Sync to load daily reach</div>'}
        ${series.length ? lineChart(series.map((r) => ({ label: r.day.slice(5), value: r.reach })), { width: 760, height: 210 }) : ''}
      </div>
      <div class="card ov-card">
        <div class="ov-head"><span class="ov-title">How people interact</span><span class="mini">all synced posts</span></div>
        <div class="pipeline-row" style="gap:18px">${mix.svg}<div style="flex:1;min-width:130px">${legendHtml(mix.legend)}</div></div>
        <div class="mini" style="margin-top:12px"><b>${perK}</b> saves + shares per thousand reached</div>
      </div>
    </div>
    <div class="ov-grid">
      <div class="card ov-card">
        <div class="ov-head"><span class="ov-title">Top posts by reach</span><span class="mini">${posts.length} synced</span></div>
        ${
          top.length
            ? `<div class="leader">${top
                .map(
                  (p, i) => `<div class="leader-row"><span class="leader-rank">${i + 1}</span><div style="min-width:0"><div class="leader-name">${esc(p.title)} <span class="badge gray">${esc(p.post_type || 'Reel')}</span></div><div class="leader-bar"><i style="width:${Math.round((p.reach / topMax) * 100)}%"></i></div></div><span class="leader-val">${fmt(p.reach)}</span></div>`
                )
                .join('')}</div>`
            : '<div class="empty">No posts yet. Connect Instagram and press Sync now.</div>'
        }
      </div>
      <div class="card ov-card">
        <div class="ov-head"><span class="ov-title">Which format works</span><span class="mini">average reach</span></div>
        ${
          types.length
            ? types.map((x) => `<div class="fmt-row"><span style="min-width:74px">${esc(x.t)} <span class="mini">(${x.n})</span></span><div class="leader-bar"><i style="width:${Math.round((x.avg / typeMax) * 100)}%"></i></div><b>${fmt(x.avg)}</b></div>`).join('')
            : '<div class="empty">Appears once posts are synced.</div>'
        }
        ${newest ? `<div class="mini" style="margin-top:16px">Latest: <b>${esc(newest.title)}</b> · ${esc(newest.posted_at)} · reach ${fmt(newest.reach)}</div>` : ''}
      </div>
    </div>`;
}

// --- Reels -------------------------------------------------------------

async function loadReels() {
  const [d, r] = await Promise.all([
    api('/api/marketing/reels?client_id=' + currentClientId),
    api('/api/marketing/reach?client_id=' + currentClientId).catch(() => ({ rows: [] })),
  ]);
  cache.reels = d.reels;
  cache.reach = r.rows;
  renderReelsBody();
}

function renderReelsBody() {
  const rows = cache.reels;
  const totalReach = rows.reduce((a, r) => a + r.reach, 0);
  const totalEngagement = rows.reduce((a, r) => a + r.likes + r.comments + r.shares + r.saves, 0);
  const best = rows.slice().sort((a, b) => b.reach - a.reach)[0];
  const recent = rows.slice(0, 15).reverse(); // oldest -> newest, left to right
  const chart = recent.length
    ? barSpark(
        recent.map((r) => r.reach),
        { labels: recent.map((r) => r.posted_at.slice(5)), width: 1100, height: 190 }
      )
    : '';
  const dailyReach = lineChart(cache.reach.map((r) => ({ label: r.day.slice(5), value: r.reach })), { width: 1100, height: 210 });
  const reach30 = cache.reach.reduce((a, r) => a + r.reach, 0);
  const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
  const mix = pieChart([
    { label: 'Likes', value: sum('likes') },
    { label: 'Comments', value: sum('comments') },
    { label: 'Shares', value: sum('shares') },
    { label: 'Saves', value: sum('saves') },
  ]);

  $('mktBody').innerHTML = `
    <div class="sectionHead" style="margin-top:14px"><div><h3>Post Performance</h3><div class="mini">${rows.length} post${rows.length === 1 ? '' : 's'} &bull; each bar is one post's reach</div></div><button class="btn" id="logReelBtn">${icon(
    'plus'
  )}<span>Log Post</span></button></div>
    <div class="grid g3" style="margin-bottom:14px">
      ${kpi('Total Reach', totalReach, 'across all posts')}
      ${kpi('Interactions', totalEngagement, `${totalReach ? Math.round((totalEngagement / totalReach) * 1000) / 10 : 0}% of reach · likes + comments + shares + saves`)}
      ${kpi('Best Post', best ? best.reach : 0, best ? best.title : 'no posts yet')}
    </div>
    ${
      cache.reach.length
        ? `<div class="card" style="margin-bottom:14px"><div class="sectionHead"><h3 style="font-size:13px">Account reach per day</h3><div class="mini">last ${cache.reach.length} days &bull; ${reach30.toLocaleString()} total</div></div>${dailyReach}</div>`
        : ''
    }
    ${
      rows.length
        ? `<div class="card" style="margin-bottom:14px"><div class="sectionHead"><h3 style="font-size:13px">How people interacted</h3><div class="mini">all posts combined</div></div><div class="pipeline-row">${mix.svg}<div style="flex:1;min-width:160px">${legendHtml(
            mix.legend
          )}</div></div></div>`
        : ''
    }
    ${rows.length ? `<div class="card" style="margin-bottom:14px"><div class="sectionHead"><h3 style="font-size:13px">Reach per post</h3><div class="mini">latest ${recent.length}, oldest on the left</div></div>${chart}</div>` : ''}
    <div class="tableWrap"><table class="table"><thead><tr><th>Post</th><th>Posted</th><th>Reach</th><th>Plays</th><th>Likes</th><th>Comments</th><th>Shares</th><th>Saves</th><th>Interactions</th><th>Eng. rate</th><th>Edit</th></tr></thead><tbody>
      ${
        rows
          .map(
            (r) =>
              `<tr><td><b>${esc(r.title)}</b> ${r.post_type ? `<span class="badge gray">${esc(r.post_type)}</span> ` : ''}${r.source === 'instagram' ? '<span class="badge blue">Synced</span>' : '<span class="badge gray">Manual</span>'}${
                r.reel_url ? ` <a href="${esc(r.reel_url)}" target="_blank" rel="noopener" class="mini">view</a>` : ''
              }</td><td>${esc(
                r.posted_at
              )}</td><td>${r.reach.toLocaleString()}</td><td>${r.plays.toLocaleString()}</td><td>${r.likes.toLocaleString()}</td><td>${r.comments.toLocaleString()}</td><td>${r.shares.toLocaleString()}</td><td>${r.saves.toLocaleString()}</td><td><b>${(r.likes + r.comments + r.shares + r.saves).toLocaleString()}</b></td><td>${r.reach ? Math.round(((r.likes + r.comments + r.shares + r.saves) / r.reach) * 1000) / 10 : 0}%</td><td><button class="btn alt" data-edit-reel="${
                r.id
              }">Edit</button> <button class="btn danger" data-del-reel="${r.id}">Delete</button></td></tr>`
          )
          .join('') || '<tr><td colspan="11" class="empty">No posts yet. Connect Instagram and press Sync Now.</td></tr>'
      }
    </tbody></table></div>`;

  $('logReelBtn').onclick = () => openReelModal(currentClientId);
  $('mktBody')
    .querySelectorAll('[data-edit-reel]')
    .forEach((b) => (b.onclick = () => openReelModal(currentClientId, rows.find((r) => r.id === Number(b.dataset.editReel)))));
  $('mktBody')
    .querySelectorAll('[data-del-reel]')
    .forEach((b) => (b.onclick = () => deleteReel(Number(b.dataset.delReel))));
}

async function deleteReel(id) {
  if (!(await confirmDialog('Delete this post entry?', { title: 'Delete Post', confirmText: 'Delete' }))) return;
  await api('/api/marketing/reels/' + id, { method: 'DELETE' });
  await loadReels();
}

// --- Audience geography --------------------------------------------------

async function loadAudience() {
  const d = await api('/api/marketing/audience?client_id=' + currentClientId);
  cache.audience = d.rows;
  renderAudienceBody();
}

function legendHtml(legend) {
  return legend.length
    ? legend
        .map(
          (l) =>
            `<div class="statline"><span><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${l.color};margin-right:7px"></span>${esc(
              l.label
            )}</span><b>${l.pct}%</b></div>`
        )
        .join('')
    : '<div class="empty">No data logged yet.</div>';
}

function renderAudienceBody() {
  const inView = cache.audience.filter((r) => (r.audience || 'followers') === audienceView);
  const titles = { country: 'Country', city: 'City', age: 'Age group', gender: 'Gender' };
  const pies = ['country', 'city', 'age', 'gender'].map((scope) => {
    const rows = inView.filter((r) => r.scope === scope);
    const pie = pieChart(rows.map((r) => ({ label: r.label, value: r.percentage })));
    return `<div class="card"><div class="sectionHead"><h3 style="font-size:13px">By ${titles[scope]}</h3></div><div class="pipeline-row">${pie.svg}<div style="flex:1;min-width:160px">${legendHtml(
      pie.legend
    )}</div></div></div>`;
  });

  $('mktBody').innerHTML = `
    <div class="sectionHead" style="margin-top:14px"><div><h3>Audience</h3><div class="mini">Account-level: Instagram gives no audience data for a single post. &quot;Reached&quot; = people the content was shown to in the last 30 days.</div></div><button class="btn" id="logAudienceBtn">${icon(
      'plus'
    )}<span>Add Breakdown</span></button></div>
    <div class="chat-tabs" style="max-width:320px;margin-bottom:14px">
      <button class="chat-tab ${audienceView === 'reached' ? 'active' : ''}" data-aud="reached">People reached</button>
      <button class="chat-tab ${audienceView === 'followers' ? 'active' : ''}" data-aud="followers">Followers</button>
    </div>
    <div class="grid g2">${pies.join('')}</div>
    <div class="tableWrap" style="margin-top:14px"><table class="table"><thead><tr><th>Type</th><th>Group</th><th>Source</th><th>%</th><th>Logged</th><th>Edit</th></tr></thead><tbody>
    ${
      inView
        .map(
          (r) =>
            `<tr><td class="wrap" style="text-transform:capitalize">${esc(r.scope)}</td><td>${esc(r.label)}</td><td>${r.source === 'instagram' ? '<span class="badge blue">Synced</span>' : '<span class="badge gray">Manual</span>'}</td><td>${r.percentage}%</td><td>${esc(
              r.snapshot_date
            )}</td><td><button class="btn danger" data-del-geo="${r.id}">Delete</button></td></tr>`
        )
        .join('') || '<tr><td colspan="6" class="empty">No data yet. Press Sync Now. Instagram only returns demographics for accounts with about 100+ followers.</td></tr>'
    }
    </tbody></table></div>`;

  $('logAudienceBtn').onclick = () => openAudienceModal(currentClientId);
  $('mktBody')
    .querySelectorAll('[data-aud]')
    .forEach(
      (b) =>
        (b.onclick = () => {
          audienceView = b.dataset.aud;
          renderAudienceBody();
        })
    );
  $('mktBody')
    .querySelectorAll('[data-del-geo]')
    .forEach((b) => (b.onclick = () => deleteAudience(Number(b.dataset.delGeo))));
}

async function deleteAudience(id) {
  if (!(await confirmDialog('Delete this audience entry?', { title: 'Delete Audience Entry', confirmText: 'Delete' }))) return;
  await api('/api/marketing/audience/' + id, { method: 'DELETE' });
  await loadAudience();
}

// --- Follower growth -------------------------------------------------------

async function loadGrowth() {
  const d = await api('/api/marketing/growth?client_id=' + currentClientId);
  cache.growth = d.rows;
  renderGrowthBody();
}

function renderGrowthBody() {
  const rows = cache.growth;
  const chart = rows.length
    ? barSpark(
        rows.map((r) => r.followers),
        { labels: rows.map((r) => r.month.slice(5)), width: 620, height: 140, color: 'var(--accent2)' }
      )
    : '';
  const first = rows[0]?.followers || 0;
  const last = rows[rows.length - 1]?.followers || 0;
  const growthPct = first ? Math.round(((last - first) / first) * 1000) / 10 : 0;

  $('mktBody').innerHTML = `
    <div class="sectionHead" style="margin-top:14px"><div><h3>Follower Growth</h3><div class="mini">${rows.length} month${rows.length === 1 ? '' : 's'} logged</div></div><button class="btn" id="logGrowthBtn">${icon(
    'plus'
  )}<span>Log Month</span></button></div>
    <div class="grid g3" style="margin-bottom:14px">
      ${kpi('Current Followers', last, rows.length ? rows[rows.length - 1].month : 'not logged yet')}
      ${kpi('Starting Point', first, rows.length ? rows[0].month : 'not logged yet')}
      ${kpi('Growth', growthPct + '%', 'since first logged month')}
    </div>
    ${rows.length ? `<div style="margin-bottom:16px">${chart}</div>` : '<div class="empty">No growth data logged yet.</div>'}
    <div class="tableWrap"><table class="table"><thead><tr><th>Month</th><th>Followers</th><th>Edit</th></tr></thead><tbody>
    ${
      rows
        .slice()
        .reverse()
        .map((r) => `<tr><td>${esc(r.month)}</td><td>${r.followers.toLocaleString()}</td><td><button class="btn danger" data-del-growth="${r.id}">Delete</button></td></tr>`)
        .join('') || ''
    }
    </tbody></table></div>`;

  $('logGrowthBtn').onclick = () => openGrowthModal(currentClientId);
  $('mktBody')
    .querySelectorAll('[data-del-growth]')
    .forEach((b) => (b.onclick = () => deleteGrowth(Number(b.dataset.delGrowth))));
}

async function deleteGrowth(id) {
  if (!(await confirmDialog('Delete this month entry?', { title: 'Delete Month Entry', confirmText: 'Delete' }))) return;
  await api('/api/marketing/growth/' + id, { method: 'DELETE' });
  await loadGrowth();
}
