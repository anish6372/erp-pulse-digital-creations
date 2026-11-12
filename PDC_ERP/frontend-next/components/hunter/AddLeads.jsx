'use client';
import { useState } from 'react';
import { api } from '../../legacy/lib/api.js';
import { toast } from '../../legacy/lib/dom.js';
import Icon from '../Icon';
import { CITIES, NICHES, PLATFORMS, SIGNALS } from './shared';

const EMPTY = { name: '', niche: 'dental', city: 'Bangalore', instagram: '', website: '', source_platform: 'Instagram', signal_type: 'manual', email: '', signal_title: '', linkedin: '', phone: '', contact_name: '', contact_role: '', gmb_rating: '', gmb_reviews: '', ig_followers: '', ig_last_post_days: '', notes: '' };

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

// Accept either the internal key or the visible label.
function matchKey(map, value, fallback) {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return fallback;
  const hit = Object.entries(map).find(([k, label]) => k.toLowerCase() === v || String(label).toLowerCase() === v);
  return hit ? hit[0] : fallback;
}

export default function AddLeads({ cfg, onAdded }) {
  const [f, setF] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const body = { ...f, gmb_rating: f.gmb_rating || null, gmb_reviews: f.gmb_reviews || null, ig_followers: f.ig_followers || null, ig_last_post_days: f.ig_last_post_days || null };
    try {
      await api('/api/hunter/leads', { method: 'POST', body: JSON.stringify(body) });
      toast('Lead added and scored');
      setF(EMPTY);
      onAdded();
    } catch (err) {
      toast(err.message || 'Could not add this lead');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="title" style={{ marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>Add leads</h2>
        <p>For leads your team spots by hand: Instagram, LinkedIn, Threads, X, Reddit, Facebook groups, Upwork, Fiverr, Contra, referrals and walk-ins. The tool audits the website, scores each lead{cfg.enabled ? ' and drafts outreach for your approval' : ''}.</p>
      </div>
      <div className="notice warn" style={{ marginBottom: 12 }}>Only add business details the business published itself: website, Google profile, bio or company page. Never personal numbers or anything from private groups.</div>
      <div className="card" style={{ marginBottom: 14 }}>
        <form onSubmit={submit}>
          <div className="fgrid">
            <div className="field"><label>Business name *</label><input value={f.name} onChange={set('name')} required /></div>
            <div className="field"><label>Niche</label><select value={f.niche} onChange={set('niche')}>{Object.entries(NICHES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div className="field"><label>Location</label><select value={f.city} onChange={set('city')}>{CITIES.map((c) => <option key={c}>{c}</option>)}</select></div>
            <div className="field"><label>Instagram</label><input value={f.instagram} onChange={set('instagram')} placeholder="@handle" /></div>
            <div className="field"><label>Website</label><input type="url" value={f.website} onChange={set('website')} placeholder="optional" /></div>
            <div className="field"><label>Found on</label><select value={f.source_platform} onChange={set('source_platform')}>{PLATFORMS.map((p) => <option key={p}>{p}</option>)}</select></div>
            <div className="field"><label>Signal</label><select value={f.signal_type} onChange={set('signal_type')}>{Object.entries(SIGNALS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div className="field"><label>Business email</label><input type="email" value={f.email} onChange={set('email')} /></div>
            <div className="field full"><label>What did they post or need?</label><textarea value={f.signal_title} onChange={set('signal_title')} /></div>
          </div>
          <details style={{ marginTop: 8 }}>
            <summary className="mini" style={{ cursor: 'pointer' }}>More details (optional)</summary>
            <div className="fgrid" style={{ marginTop: 8 }}>
              <div className="field"><label>LinkedIn</label><input value={f.linkedin} onChange={set('linkedin')} placeholder="linkedin.com/company/..." /></div>
              <div className="field"><label>Phone</label><input value={f.phone} onChange={set('phone')} /></div>
              <div className="field"><label>Contact name</label><input value={f.contact_name} onChange={set('contact_name')} /></div>
              <div className="field"><label>Contact role</label><input value={f.contact_role} onChange={set('contact_role')} /></div>
              <div className="field"><label>Google rating</label><input type="number" step="0.1" min="0" max="5" value={f.gmb_rating} onChange={set('gmb_rating')} /></div>
              <div className="field"><label>Google reviews</label><input type="number" min="0" value={f.gmb_reviews} onChange={set('gmb_reviews')} /></div>
              <div className="field"><label>Instagram followers</label><input type="number" min="0" value={f.ig_followers} onChange={set('ig_followers')} /></div>
              <div className="field"><label>Last Instagram post (days ago)</label><input type="number" min="0" value={f.ig_last_post_days} onChange={set('ig_last_post_days')} /></div>
              <div className="field full"><label>Notes</label><textarea value={f.notes} onChange={set('notes')} /></div>
            </div>
          </details>
          <button className="btn" disabled={busy} style={{ marginTop: 10 }}><Icon raw="plus" /><span>Add and audit</span></button>
          {busy && <div className="mini" style={{ marginTop: 8 }}>Checking the website and scoring the lead{cfg.enabled ? ', then drafting outreach' : ''}…</div>}
        </form>
      </div>
      <BulkImport cfg={cfg} onAdded={onAdded} />
    </>
  );
}

function BulkImport({ cfg, onAdded }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const template = () => {
    const csv = 'name,niche,city,website,instagram,linkedin,phone,contact_name,contact_role,contact_email,signal_type,source_platform,source_url,notes\n"Example Cafe",cafe_restaurant,Bangalore,https://example.com,@examplecafe,,,,,hello@example.com,new_opening,Instagram,,Posted opening reel\n';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'client-hunter-leads-template.csv';
    a.click();
  };

  const run = async () => {
    if (!file) return setMsg({ text: 'Choose a CSV file first.' });
    const table = parseCsv(await file.text());
    if (table.length < 2) return setMsg({ text: 'That file has no data rows.' });
    const head = table[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
    if (!head.includes('name')) return setMsg({ text: 'The CSV needs a "name" column.' });
    const get = (r, ...names) => {
      for (const n of names) {
        const i = head.indexOf(n);
        if (i >= 0 && r[i] != null && String(r[i]).trim()) return String(r[i]).trim();
      }
      return '';
    };
    const items = table.slice(1, 201).map((r) => ({
      name: get(r, 'name'),
      niche: matchKey(NICHES, get(r, 'niche'), 'other'),
      city: CITIES.find((c) => c.toLowerCase() === get(r, 'city').toLowerCase()) || get(r, 'city'),
      website: get(r, 'website'), instagram: get(r, 'instagram'), linkedin: get(r, 'linkedin'), phone: get(r, 'phone'),
      contact_name: get(r, 'contact_name'), contact_role: get(r, 'contact_role'), email: get(r, 'contact_email', 'email'),
      signal_type: matchKey(SIGNALS, get(r, 'signal_type', 'signal'), 'manual'),
      source_platform: get(r, 'source_platform', 'found_on'), signal_title: get(r, 'source_url'), notes: get(r, 'notes'),
      lat: get(r, 'lat'), lng: get(r, 'lng'),
    }));
    setBusy(true);
    let added = 0, drafted = 0;
    const skipped = [];
    try {
      for (let i = 0; i < items.length; i += 10) {
        setMsg({ text: `Auditing and scoring… ${Math.min(i + 10, items.length)} of ${items.length}` });
        const r = await api('/api/hunter/leads/bulk', { method: 'POST', body: JSON.stringify({ rows: items.slice(i, i + 10) }) });
        added += r.added;
        drafted += r.drafted;
        r.skipped.forEach((s) => skipped.push({ ...s, row: s.row + i }));
      }
    } catch (e) {
      skipped.push({ row: '-', reason: e.message || 'import stopped' });
    }
    setBusy(false);
    setMsg({ added, drafted, skipped });
    if (added) {
      toast(`${added} leads imported`);
      onAdded(false);
    }
  };

  return (
    <div className="card">
      <h3 style={{ marginBottom: 6 }}>Bulk import</h3>
      <div className="mini" style={{ marginBottom: 8 }}>
        Upload a CSV with columns: <b>name</b> (required), niche, city, website, instagram, linkedin, phone, contact_name, contact_role, contact_email (or email), signal_type, source_platform, source_url, notes, and optionally lat, lng. Each row is audited, scored{cfg.enabled ? ' and drafted' : ''} the same way as a single lead. Up to 200 rows at a time.
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files[0] || null)} />
        <button className="btn alt" type="button" disabled={busy} onClick={run}>Import</button>
        <button className="btn alt" type="button" onClick={template}>Download template</button>
      </div>
      <div className="mini" style={{ marginTop: 10 }}>
        {msg?.text}
        {msg && msg.added != null && (
          <>
            <b>{msg.added}</b> lead(s) added{cfg.enabled ? `, ${msg.drafted} drafted for approval` : ''}.
            {msg.skipped.length > 0 && <><br />Skipped {msg.skipped.length}: {msg.skipped.slice(0, 8).map((s) => `row ${s.row}${s.name ? ' (' + s.name + ')' : ''} - ${s.reason}`).join('; ')}</>}
          </>
        )}
      </div>
    </div>
  );
}
