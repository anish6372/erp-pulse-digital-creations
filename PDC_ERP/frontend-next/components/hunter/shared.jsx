'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../legacy/lib/api.js';

export const NICHES = {
  dental: 'Dental clinics',
  salon_spa: 'Spas & salons',
  cafe_restaurant: 'Cafes & restaurants',
  saas: 'SaaS products',
  jewellery: 'Jewellery brands',
  automobile: 'Automobile',
  interior_design: 'Interior design',
  other: 'Other',
};
export const CITIES = ['Bangalore', 'Mumbai', 'Delhi NCR', 'Hyderabad', 'Pune', 'Chennai', 'Dubai', 'Singapore', 'London'];
export const SIGNALS = {
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
export const PLATFORMS = ['Instagram', 'LinkedIn', 'Threads', 'X', 'Reddit', 'Facebook groups', 'Upwork', 'Fiverr', 'Contra', 'Referral', 'Walk-in', 'Other'];
export const STATUS_LABEL = { new: 'New', audited: 'Audited', outreach: 'Outreach', replied: 'Replied', meeting: 'Meeting', handed_off: 'Handed off', won: 'Won', lost: 'Lost', disqualified: 'Disqualified' };
export const TIER_CLASS = { hot: 'red', warm: 'yellow', parked: 'gray' };
export const TIER_COLOR = { hot: 'var(--danger)', warm: 'var(--warn)', parked: 'var(--muted)' };

// Fetch a path and keep loading / error / data state; reload() re-fetches.
export function useFetch(path) {
  const [state, setState] = useState({ data: null, error: '', loading: true });
  const load = useCallback(async () => {
    try {
      const data = await api(path);
      setState({ data, error: '', loading: false });
      return data;
    } catch (e) {
      setState((s) => ({ ...s, error: e.message || 'Failed to load', loading: false }));
      return null;
    }
  }, [path]);
  useEffect(() => {
    setState((s) => ({ ...s, loading: true }));
    load();
  }, [load]);
  return { ...state, reload: load };
}

export function Kpi({ label, value, sub }) {
  return (
    <div className="card kpi-card">
      <div className="k">{label}</div>
      <div className="kv">{value}</div>
      <div className="ks">{sub}</div>
    </div>
  );
}

export function Modal({ title, onClose, wide, children }) {
  return (
    <div className="modal show" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'modalCard' + (wide ? ' wide' : '')}>
        <div className="modalHead">
          <h3>{title}</h3>
          <button className="close" onClick={onClose}>&times;</button>
        </div>
        <div>{children}</div>
      </div>
    </div>
  );
}

export const money = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');

// Leads/niches/cities performance table (used on the Dashboard).
export function BreakdownTable({ rows, kind }) {
  const sorted = [...rows].filter((r) => r.lead_count > 0).sort((a, b) => b.lead_count - a.lead_count);
  if (!sorted.length) return <div className="empty">No leads yet - add some to see this breakdown.</div>;
  return (
    <div className="tableWrap">
      <table className="table">
        <thead>
          <tr><th>{kind === 'city' ? 'Location' : 'Niche'}</th><th>Leads</th><th>Hot</th><th>Warm</th><th>Parked</th><th>Avg score</th></tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={kind === 'city' ? r.city : r.niche}>
              <td>{kind === 'city' ? <>{r.city} <span className="mini">P{r.priority}</span></> : r.niche_label}</td>
              <td>{r.lead_count}</td><td>{r.hot}</td><td>{r.warm}</td><td>{r.parked}</td><td>{r.avg_score ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
