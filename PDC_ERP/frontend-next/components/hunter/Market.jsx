'use client';
import { useMemo, useState } from 'react';
import { runJob } from '../../legacy/lib/api.js';
import { toast } from '../../legacy/lib/dom.js';
import { CITIES, Kpi, NICHES, TIER_CLASS, TIER_COLOR, money, useFetch } from './shared';

const kmBetween = (a, b) => {
  const rad = (x) => (x * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};
const short = (n) => '₹' + (n >= 1e7 ? (n / 1e7).toFixed(1) + ' Cr' : n >= 1e5 ? (n / 1e5).toFixed(1) + ' L' : Number(n).toLocaleString('en-IN'));

export default function Market({ onOpenLead }) {
  const [params, setParams] = useState({ niche: 'dental', city: 'Bangalore', months: 2 });
  const [form, setForm] = useState(params);
  const { data: d, error, loading, reload } = useFetch(`/api/hunter/market?niche=${params.niche}&city=${encodeURIComponent(params.city)}&months=${params.months}`);

  return (
    <div className="card">
      <form
        className="fgrid"
        style={{ marginBottom: 12 }}
        onSubmit={(e) => {
          e.preventDefault();
          setParams({ ...form, months: Number(form.months) || 2 });
        }}
      >
        <div className="field"><label>Niche</label>
          <select value={form.niche} onChange={(e) => setForm({ ...form, niche: e.target.value })}>{Object.entries(NICHES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div className="field"><label>Location</label>
          <select value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })}>{CITIES.map((c) => <option key={c}>{c}</option>)}</select></div>
        <div className="field"><label>Period (months)</label>
          <input type="number" min="1" max="12" value={form.months} onChange={(e) => setForm({ ...form, months: e.target.value })} /></div>
        <div className="field" style={{ alignSelf: 'flex-end' }}><button className="btn">Estimate</button></div>
      </form>
      {loading && !d ? <div className="empty">Loading…</div> : error || !d ? <div className="err">{error}</div> : <MarketBody d={d} city={params.city} reload={reload} onOpenLead={onOpenLead} />}
    </div>
  );
}

function MarketBody({ d, city, reload, onOpenLead }) {
  const m = d.estimate;
  return (
    <>
      <div className="notice" style={{ marginBottom: 12 }}>{d.note} Figures below are modeled from category benchmarks and {m.priority_label} weighting, not scraped from real listings.</div>
      <div className="grid g5" style={{ marginBottom: 12 }}>
        <Kpi label="Agencies (est.)" value={m.agencies_estimate} sub={m.niche_label} />
        <Kpi label="Businesses buying" value={m.businesses_buying_estimate} sub="in this category/area" />
        <Kpi label="Projects (period)" value={m.projects_estimate} sub={`${m.period_months} month(s)`} />
        <Kpi label="Est. monthly spend" value={money(m.monthly_spend_estimate)} sub="across the category" />
        <Kpi label="Avg project value" value={money(m.avg_project_value_estimate)} sub="" />
      </div>
      <div className="card soft" style={{ marginBottom: 12 }}>
        <div className="statline"><span>Up for grabs (no retained agency, est.)</span><span><b>{money(m.up_for_grabs_monthly_estimate)}</b>/month</span></div>
        <div className="statline"><span>Category growth (est.)</span><span>{m.growth_pct}% / year</span></div>
        <div className="statline"><span>Suggested pitch angle</span><span>{m.suggested_pitch}</span></div>
      </div>
      <RadialSection d={d} m={m} city={city} reload={reload} onOpenLead={onOpenLead} />
      <Forecast m={m} />
    </>
  );
}

function RadialSection({ d, m, city, reload, onOpenLead }) {
  const center = d.center;
  const [hidden, setHidden] = useState({});
  const [locating, setLocating] = useState('');
  const all = d.points || [];

  const { near, unpinned, far, locs } = useMemo(() => {
    const pts = center ? all.filter((p) => p.lat != null && p.lng != null) : [];
    const placed = pts.map((p) => ({ ...p, km: kmBetween(center, p) }));
    const locs = (d.localities || []).map((l) => ({ ...l, km: kmBetween(center, l) })).filter((l) => l.km <= 12);
    const near = placed.filter((p) => p.km <= 12).sort((a, b) => b.score - a.score);
    return { near, unpinned: all.length - pts.length, far: placed.length - near.length, locs };
  }, [d, center, all]);

  const W = 560, H = 460, cx = W / 2, cy = H / 2, R10 = 190, scale = R10 / 10;
  const px = (lng) => cx + (lng - center.lng) * 111.32 * Math.cos((center.lat * Math.PI) / 180) * scale;
  const py = (lat) => cy - (lat - center.lat) * 110.57 * scale;
  const areaOf = (p) => {
    let best = null;
    for (const l of locs) {
      const k = kmBetween(p, l);
      if (!best || k < best.k) best = { k, name: l.name };
    }
    return best && best.k <= 4 ? best.name : '—';
  };
  const counts = { hot: 0, warm: 0, parked: 0 };
  near.forEach((p) => counts[p.tier] != null && counts[p.tier]++);

  const locate = async () => {
    let found = 0;
    try {
      for (;;) {
        setLocating(`Looking up locations… ${found} found`);
        const r = await runJob('/api/hunter/leads/locate', { city }, (p) => setLocating(`Locating ${p.done || 0}/${p.total || '?'}… ${found} found`));
        found += r.located;
        if (!r.remaining || !r.tried) break;
      }
      toast(found ? `${found} lead(s) placed on the map` : 'No locations found - small businesses are often missing from the free map data');
    } catch (e) {
      toast(e.message || 'Location lookup failed');
    }
    setLocating('');
    reload();
  };

  return (
    <>
      <div className="grid g2" style={{ alignItems: 'start', marginBottom: 12 }}>
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            <h3>Map</h3>
            <div>
              {['hot', 'warm', 'parked'].map((t) => (
                <label key={t} className="mini" style={{ display: 'inline-flex', gap: 6, alignItems: 'center', marginRight: 14 }}>
                  <input type="checkbox" checked={!hidden[t]} onChange={(e) => setHidden({ ...hidden, [t]: !e.target.checked })} />
                  <span style={{ color: TIER_COLOR[t] }}>&#9679;</span> {t[0].toUpperCase() + t.slice(1)} ({counts[t]})
                </label>
              ))}
            </div>
          </div>
          {center ? (
            <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W, height: 'auto', background: 'var(--panel)', borderRadius: 10 }}>
              <circle cx={cx} cy={cy} r={R10} fill="none" stroke="var(--line)" />
              <circle cx={cx} cy={cy} r={R10 / 2} fill="none" stroke="var(--line)" />
              <text x={cx + R10 / 2 + 4} y={cy - 4} fontSize="10" fill="var(--muted)">5 km</text>
              <text x={cx + R10 * 0.7} y={cy - R10 * 0.72} fontSize="10" fill="var(--muted)">10 km</text>
              {locs.map((l) => (
                <g key={l.name}>
                  <circle cx={px(l.lng)} cy={py(l.lat)} r="2" fill="var(--muted)" fillOpacity=".6" />
                  <text x={px(l.lng)} y={py(l.lat) - 5} textAnchor="middle" fontSize="9" fill="var(--muted)">{l.name}</text>
                </g>
              ))}
              {near.filter((p) => !hidden[p.tier]).map((p) => {
                const col = TIER_COLOR[p.tier] || 'var(--muted)';
                return (
                  <circle key={p.id} cx={px(p.lng)} cy={py(p.lat)} r={5 + (p.score / 100) * 8} fill={col} fillOpacity=".8" stroke={col} style={{ cursor: 'pointer' }} onClick={() => onOpenLead(p.id)}>
                    <title>{`${p.name} - score ${p.score}, ${p.km.toFixed(1)} km`}</title>
                  </circle>
                );
              })}
              <circle cx={cx} cy={cy} r="6" fill="#fff" stroke="var(--ink)" strokeWidth="2" />
              <text x={cx} y={cy + 20} textAnchor="middle" fontSize="12" fill="var(--ink)" style={{ fontWeight: 700 }}>{m.city || 'City centre'}</text>
            </svg>
          ) : (
            <div className="empty">Pick a city to see the map.</div>
          )}
          <div className="mini" style={{ marginTop: 8 }}>
            Your real leads, positioned by their Google Maps coordinates. Bigger dot = higher score. Click a dot to open the lead.{' '}
            {unpinned > 0 && `${unpinned} lead(s) here aren't pinned because they have no coordinates (leads found by a Hunt are pinned automatically). `}
            {far > 0 && `${far} more are over 12 km from the centre. `}
            {d.unlocated > 0 && (
              <button className="btn alt" type="button" disabled={!!locating} onClick={locate} style={{ marginLeft: 6 }}>
                {locating || `Locate ${d.unlocated} lead(s)`}
              </button>
            )}
          </div>
        </div>
        <div className="card">
          <h3 style={{ marginBottom: 8 }}>What this means for Pulse</h3>
          <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
            <li><b>Estimate:</b> about {m.businesses_buying_estimate} businesses here buy {m.niche_label.toLowerCase()} services, roughly {m.projects_estimate} projects over {m.period_months} month(s).</li>
            <li><b>Up for grabs:</b> around {money(m.up_for_grabs_monthly_estimate)} a month has no retained agency.</li>
            <li><b>Growth:</b> {m.growth_pct}% a year. <b>Pitch:</b> {m.suggested_pitch}.</li>
            <li><b>Your pipeline here:</b> {all.length} lead(s), {counts.hot} hot within 12 km.</li>
          </ul>
          <div className="mini" style={{ marginTop: 8 }}>Estimates are modeled from category benchmarks; lead counts are real.</div>
        </div>
      </div>
      <div className="card" style={{ marginBottom: 12 }}>
        <h3 style={{ marginBottom: 8 }}>Who&apos;s here <span className="mini">your leads in {m.city || 'this city'}, highest score first</span></h3>
        {near.length ? (
          <div className="tableWrap">
            <table className="table">
              <thead><tr><th>Business</th><th>Area</th><th>Distance</th><th>Reviews</th><th>Score</th><th>Tier</th></tr></thead>
              <tbody>
                {near.slice(0, 12).map((p) => (
                  <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => onOpenLead(p.id)}>
                    <td><b>{p.name}</b><div className="mini">{NICHES[p.niche] || p.niche}</div></td>
                    <td>{areaOf(p)}</td><td>{p.km.toFixed(1)} km</td><td>{p.gmb_reviews ?? '—'}</td><td>{p.score}</td>
                    <td><span className={'badge ' + (TIER_CLASS[p.tier] || 'gray')}>{p.tier}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">Nothing to list yet.</div>
        )}
      </div>
    </>
  );
}

// Modeled forecast: current monthly spend grown at the category's annual growth rate.
function Forecast({ m }) {
  const g = Math.pow(1 + m.growth_pct / 100, 1 / 12);
  const vals = Array.from({ length: 7 }, (_, i) => m.monthly_spend_estimate * Math.pow(g, i));
  const W = 700, H = 200, P = 30;
  const max = Math.max(...vals) * 1.15, min = Math.min(...vals) * 0.85;
  const x = (i) => P + (i / 6) * (W - 2 * P);
  const y = (v) => H - P - ((v - min) / (max - min || 1)) * (H - 2 * P);
  const path = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const pct = (i) => ((vals[i] / vals[0] - 1) * 100).toFixed(1) + '% vs now';
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <h3 style={{ marginBottom: 4 }}>Forecast: the next 6 months</h3>
      <div className="mini" style={{ marginBottom: 10 }}>Modeled by growing this category&apos;s estimated monthly spend at {m.growth_pct}% a year. Illustrative, not live market data.</div>
      <div className="grid g4" style={{ marginBottom: 10 }}>
        <Kpi label="Now" value={short(vals[0])} sub="est. monthly spend" />
        <Kpi label="In 3 months" value={short(vals[3])} sub={pct(3)} />
        <Kpi label="In 6 months" value={short(vals[6])} sub={pct(6)} />
        <Kpi label="Projects / month" value={Math.round(m.projects_estimate / m.period_months)} sub="today, est." />
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', background: 'var(--panel)', borderRadius: 10 }}>
        <path d={path} fill="none" stroke="#4f86f7" strokeWidth="2" strokeDasharray="5 4" />
        {vals.map((v, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(v)} r="3" fill="#4f86f7" />
            <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--muted)">{i ? `+${i} mo` : 'Now'}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}
