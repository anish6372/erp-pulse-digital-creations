'use client';
import { useEffect, useState } from 'react';
import { api } from '../../legacy/lib/api.js';
import { confirmDialog, toast } from '../../legacy/lib/dom.js';
import Icon from '../Icon';
import { Modal, NICHES, STATUS_LABEL, TIER_CLASS, useFetch } from './shared';

export function LeadsList({ filters, setFilters, onOpenLead, onAdd, reloadKey }) {
  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
  const { data, loading, reload } = useFetch('/api/hunter/leads?' + qs);
  useEffect(() => {
    if (reloadKey) reload();
  }, [reloadKey, reload]);
  const rows = data?.rows || [];
  const set = (k) => (e) => setFilters({ ...filters, [k]: e.target.value });
  return (
    <div className="card">
      <div className="sectionHead">
        <div className="pnl">
          <input placeholder="Search name or city" value={filters.q} onChange={set('q')} style={{ minWidth: 200 }} />
          <select value={filters.tier} onChange={set('tier')}>
            <option value="">All tiers</option><option value="hot">Hot</option><option value="warm">Warm</option><option value="parked">Parked</option>
          </select>
          <select value={filters.niche} onChange={set('niche')}>
            <option value="">All niches</option>{Object.entries(NICHES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={filters.status} onChange={set('status')}>
            <option value="">All statuses</option>{Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <button className="btn" onClick={onAdd}><Icon raw="plus" /><span>Add lead</span></button>
      </div>
      <div className="tableWrap">
        <table className="table">
          <thead><tr><th>Score</th><th>Business</th><th>Niche</th><th>Location</th><th>Why now</th><th>Status</th></tr></thead>
          <tbody>
            {rows.length ? rows.map((l) => (
              <tr key={l.id} className="click" onClick={() => onOpenLead(l.id)}>
                <td><b>{l.score}</b> <span className={'badge ' + (TIER_CLASS[l.tier] || 'gray')}>{l.tier}</span></td>
                <td>{l.name}</td>
                <td className="mini">{NICHES[l.niche] || l.niche}</td>
                <td className="mini">{l.city || '—'}</td>
                <td className="mini">{l.signal_title || '—'}</td>
                <td><span className="badge gray">{STATUS_LABEL[l.status] || l.status}</span></td>
              </tr>
            )) : (
              <tr><td colSpan="6" className="empty">{loading ? 'Loading…' : 'No leads match these filters.'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const ChannelRow = ({ label, c }) =>
  c ? (
    <div className="statline">
      <span>{label}</span>
      <span>{c.score != null ? <span className="badge gray">{c.score}/5</span> : <span className="mini">not checked</span>} {(c.evidence || []).join(', ')}</span>
    </div>
  ) : null;

const SwotCol = ({ title, items }) => (
  <div>
    <h3 style={{ marginBottom: 6 }}>{title}</h3>
    {items && items.length ? <ul style={{ margin: 0, paddingLeft: 18 }}>{items.map((i, n) => <li key={n} className="mini">{i}</li>)}</ul> : <div className="mini">None noted.</div>}
  </div>
);

export function LeadDetail({ id, cfg, onClose, onChanged }) {
  const { data, loading } = useFetch('/api/hunter/leads/' + id);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data) setStatus(data.lead.status);
  }, [data]);
  if (loading || !data) return <Modal title="Lead" onClose={onClose} wide><div className="empty">Loading…</div></Modal>;
  const { lead: l, touches } = data;
  const ch = l.channels || {};
  const swot = l.swot || {};

  const save = async () => {
    try {
      await api('/api/hunter/leads/' + id, { method: 'PUT', body: JSON.stringify({ status }) });
      toast('Status updated');
      onChanged();
      onClose();
    } catch (e) {
      toast(e.message || 'Could not update status');
    }
  };
  const draft = async () => {
    setBusy(true);
    try {
      await api(`/api/hunter/leads/${id}/draft`, { method: 'POST' });
      toast('Outreach drafted - check Approvals');
      onChanged();
      onClose();
    } catch (e) {
      toast(e.message || 'Could not draft outreach');
    } finally {
      setBusy(false);
    }
  };
  const del = async () => {
    if (!(await confirmDialog(`Delete ${l.name} from Client Hunter?`, { title: 'Delete Lead', confirmText: 'Delete', danger: true }))) return;
    try {
      await api('/api/hunter/leads/' + id, { method: 'DELETE' });
      toast('Lead deleted');
      onChanged();
      onClose();
    } catch (e) {
      toast(e.message || 'Could not delete lead');
    }
  };

  return (
    <Modal title={l.name} onClose={onClose} wide>
      <div className="mini" style={{ marginBottom: 8 }}>{NICHES[l.niche] || l.niche} &middot; {l.city || '—'} &middot; <span className={'badge ' + (TIER_CLASS[l.tier] || 'gray')}>{l.tier}</span> score {l.score}</div>
      {l.elevator_pitch && <div className="notice ok" style={{ marginBottom: 10 }}><b>Opening line:</b> {l.elevator_pitch}</div>}
      <div className="card soft" style={{ marginBottom: 10 }}>
        <ChannelRow label="Website" c={ch.website} /><ChannelRow label="Instagram" c={ch.instagram} /><ChannelRow label="Google Business" c={ch.gmb} />
      </div>
      <div className="grid g3" style={{ marginBottom: 10 }}>
        <SwotCol title="Strengths" items={swot.strengths} /><SwotCol title="Weaknesses" items={swot.weaknesses} /><SwotCol title="Opportunities" items={swot.opportunities} />
      </div>
      <div className="row" style={{ marginBottom: 10 }}>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>{Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <button className="btn alt" onClick={save}>Save status</button>
        {cfg.enabled && <button className="btn alt" disabled={busy} onClick={draft}><Icon raw="send" /><span>{touches.length ? 'Re-draft outreach' : 'Draft outreach'}</span></button>}
        <button className="btn danger" onClick={del}><Icon raw="trash" /><span>Delete</span></button>
      </div>
      <h3 style={{ marginBottom: 6 }}>Outreach drafts</h3>
      {touches.length ? touches.map((t) => (
        <div className="statline" style={{ alignItems: 'flex-start' }} key={t.id}>
          <span className="mini">{t.channel} &middot; {t.to_value || ''}</span>
          <span className="badge gray">{t.status}{t.outcome ? ' · ' + t.outcome : ''}</span>
        </div>
      )) : <div className="empty">No drafts yet.</div>}
    </Modal>
  );
}
