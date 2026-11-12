'use client';
import { useState } from 'react';
import { api } from '../../legacy/lib/api.js';
import { confirmDialog, toast } from '../../legacy/lib/dom.js';
import Icon from '../Icon';
import { CITIES, NICHES, useFetch } from './shared';

export default function Hunts({ cfg }) {
  const { data, loading, reload } = useFetch('/api/hunter/hunts');
  const [niche, setNiche] = useState('dental');
  const [city, setCity] = useState('Bangalore');
  const [running, setRunning] = useState(null);
  const rows = data?.rows || [];
  const disabled = cfg.hunts_enabled === false;

  const add = async (e) => {
    e.preventDefault();
    try {
      await api('/api/hunter/hunts', { method: 'POST', body: JSON.stringify({ niche, city }) });
      toast('Hunt added');
      reload();
    } catch (err) {
      toast(err.message || 'Could not add this hunt');
    }
  };
  const run = async (id) => {
    setRunning(id);
    try {
      const r = await api(`/api/hunter/hunts/${id}/run`, { method: 'POST' });
      toast(`Found ${r.found}, kept ${r.kept} new lead(s) - check Leads`);
    } catch (e) {
      toast(e.message || 'Hunt run failed');
    }
    setRunning(null);
    reload();
  };
  const del = async (id) => {
    if (!(await confirmDialog('Delete this hunt? Leads it already found stay in your pipeline.', { title: 'Delete Hunt', confirmText: 'Delete', danger: true }))) return;
    try {
      await api('/api/hunter/hunts/' + id, { method: 'DELETE' });
      toast('Hunt deleted');
      reload();
    } catch (e) {
      toast(e.message || 'Could not delete this hunt');
    }
  };

  return (
    <>
      <div className="card" style={{ marginBottom: 14 }}>
        <h3 style={{ marginBottom: 8 }}>New Hunt</h3>
        <div className="mini" style={{ marginBottom: 10 }}>Each hunt searches Google Maps for a niche in a location and keeps only businesses showing a buying signal (new/few reviews, no website, or under 4.0 rating).</div>
        <form className="row" style={{ gap: 8, flexWrap: 'wrap' }} onSubmit={add}>
          <select value={niche} onChange={(e) => setNiche(e.target.value)}>{Object.entries(NICHES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <select value={city} onChange={(e) => setCity(e.target.value)}>{CITIES.map((c) => <option key={c}>{c}</option>)}</select>
          <button className="btn" disabled={disabled}><Icon raw="plus" /><span>Add hunt</span></button>
        </form>
      </div>
      <div className="card">
        <h3 style={{ marginBottom: 8 }}>Hunts</h3>
        {loading && !data ? <div className="empty">Loading…</div> : rows.length ? (
          <div className="tableWrap">
            <table className="table">
              <thead><tr><th>Niche</th><th>Location</th><th>Last run</th><th>Found</th><th>Kept</th><th></th></tr></thead>
              <tbody>
                {rows.map((h) => (
                  <tr key={h.id}>
                    <td>{NICHES[h.niche] || h.niche}</td><td>{h.city}</td>
                    <td className="mini">{h.last_run_at ? new Date(h.last_run_at).toLocaleString('en-IN') : 'Never'}</td>
                    <td>{h.found_count}</td><td>{h.kept_count}</td>
                    <td className="pnl">
                      <button className="btn alt" style={{ padding: '3px 9px', fontSize: 11 }} disabled={disabled || running === h.id} onClick={() => run(h.id)}>{running === h.id ? 'Running…' : 'Run now'}</button>
                      <button className="btn danger" style={{ padding: '3px 9px', fontSize: 11 }} onClick={() => del(h.id)}><Icon raw="trash" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="empty">No hunts set up yet.</div>}
      </div>
    </>
  );
}
