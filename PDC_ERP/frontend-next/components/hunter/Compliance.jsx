'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../legacy/lib/api.js';
import { confirmDialog, toast } from '../../legacy/lib/dom.js';
import Icon from '../Icon';

const RULES = [
  'A person reviews and sends every first outreach message - nothing goes out automatically.',
  'The do-not-contact list is checked before a lead or prospect is contacted.',
  'An access or erasure request is fulfilled the same day it is logged here.',
  "Erasure removes a contact's name, phone and email from leads/candidates, but keeps the business record and a do-not-contact entry so they are never reached again.",
  'Every add, delete, access and erasure action here is written to the activity log below.',
];
const VERB = { CREATE: 'added', DELETE: 'removed', ACCESS: 'ran an access request for', UPDATE: 'updated' };

export default function Compliance() {
  const [c, setC] = useState({ dnc: [], requests: [], activity: [] });
  const [last, setLast] = useState(null);
  const [dr, setDr] = useState({ kind: 'access', value: '' });
  const [dnc, setDnc] = useState({ type: 'email', value: '', reason: '' });

  const load = useCallback(async () => {
    try {
      const [d, r, a] = await Promise.all([api('/api/compliance/dnc'), api('/api/compliance/data-requests'), api('/api/compliance/activity')]);
      setC({ dnc: d.rows || [], requests: r.rows || [], activity: a.rows || [] });
    } catch (e) {
      setC({ dnc: [], requests: [], activity: [] });
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const submitRequest = async (e) => {
    e.preventDefault();
    const value = dr.value.trim();
    if (!value) return;
    if (dr.kind === 'delete' && !(await confirmDialog(`Erase all personal data for "${value}"? Their name, phone and email will be removed from leads/candidates and they will be added to the do-not-contact list. This cannot be undone.`, { title: 'Erase Personal Data', confirmText: 'Erase', danger: true }))) return;
    try {
      const r = await api('/api/compliance/data-requests', { method: 'POST', body: JSON.stringify({ kind: dr.kind, contact_value: value }) });
      setLast(r);
      toast(dr.kind === 'delete' ? 'Erased and added to the do-not-contact list' : 'Access request completed');
      load();
    } catch (err) {
      toast(err.message || 'Could not run that request');
    }
  };
  const addDnc = async (e) => {
    e.preventDefault();
    if (!dnc.value.trim()) return;
    try {
      await api('/api/compliance/dnc', { method: 'POST', body: JSON.stringify({ type: dnc.type, value: dnc.value.trim(), reason: dnc.reason.trim() }) });
      toast('Added to the do-not-contact list');
      setDnc({ ...dnc, value: '', reason: '' });
      load();
    } catch (err) {
      toast(err.message || 'Could not add that entry');
    }
  };
  const removeDnc = async (d) => {
    if (!(await confirmDialog(`Remove ${d.value} from the do-not-contact list?`, { title: 'Remove Entry', confirmText: 'Remove' }))) return;
    try {
      await api('/api/compliance/dnc/' + d.id, { method: 'DELETE' });
      toast('Removed');
      load();
    } catch (err) {
      toast(err.message || 'Could not remove that entry');
    }
  };

  const rowsOf = (arr, field) =>
    arr.length ? arr.map((x, i) => <div className="statline" key={i}><span>{x[field] || '-'}</span><span className="mini">{x.phone || ''} {x.email || ''}</span></div>) : <div className="mini">None found.</div>;

  return (
    <>
      <div className="notice" style={{ marginBottom: 12 }}>Do-not-contact list, data subject requests (DPDP Act / GDPR style), and a record of who did what - the guardrails for this module&apos;s outreach.</div>
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <div>
          <div className="card" style={{ marginBottom: 14 }}>
            <h3 style={{ marginBottom: 10 }}>Data Request</h3>
            <form className="row" style={{ gap: 8, flexWrap: 'wrap' }} onSubmit={submitRequest}>
              <select value={dr.kind} onChange={(e) => setDr({ ...dr, kind: e.target.value })}>
                <option value="access">Access - show what we hold</option><option value="delete">Erasure - delete and never contact</option>
              </select>
              <input value={dr.value} onChange={(e) => setDr({ ...dr, value: e.target.value })} placeholder="Email or phone" required style={{ flex: 1, minWidth: 200 }} />
              <button className="btn"><Icon raw="search" /><span>Run</span></button>
            </form>
            {last && (
              <div className={'notice ' + (last.kind === 'delete' ? 'warn' : 'ok')} style={{ marginTop: 12 }}>
                <b>{last.kind === 'delete' ? 'Erasure' : 'Access'} request for {last.contact_value}</b>{last.kind === 'delete' ? ' - personal fields removed, added to the do-not-contact list.' : ''}
                <div style={{ marginTop: 8 }}><div className="mini" style={{ textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>Leads</div>{rowsOf(last.result?.leads || [], 'business_name')}</div>
                <div style={{ marginTop: 8 }}><div className="mini" style={{ textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>Candidates</div>{rowsOf(last.result?.candidates || [], 'name')}</div>
              </div>
            )}
            {c.requests.length > 0 && (
              <>
                <div className="mini" style={{ marginTop: 12 }}>Recent requests</div>
                <div className="tableWrap" style={{ marginTop: 4 }}>
                  <table className="table">
                    <thead><tr><th>Kind</th><th>Contact</th><th>When</th></tr></thead>
                    <tbody>{c.requests.slice(0, 8).map((r) => <tr key={r.id}><td className="mini">{r.kind}</td><td className="mini">{r.contact_value}</td><td className="mini">{new Date(r.created_at).toLocaleDateString('en-IN')}</td></tr>)}</tbody>
                  </table>
                </div>
              </>
            )}
          </div>
          <div className="card">
            <h3 style={{ marginBottom: 10 }}>Do-Not-Contact List</h3>
            <form className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 10 }} onSubmit={addDnc}>
              <select value={dnc.type} onChange={(e) => setDnc({ ...dnc, type: e.target.value })}>{['email', 'phone', 'domain', 'instagram'].map((t) => <option key={t}>{t}</option>)}</select>
              <input value={dnc.value} onChange={(e) => setDnc({ ...dnc, value: e.target.value })} placeholder="Value" required style={{ flex: 1, minWidth: 150 }} />
              <input value={dnc.reason} onChange={(e) => setDnc({ ...dnc, reason: e.target.value })} placeholder="Reason (optional)" style={{ flex: 1, minWidth: 150 }} />
              <button className="btn"><Icon raw="plus" /><span>Add</span></button>
            </form>
            {c.dnc.length ? (
              <div className="tableWrap">
                <table className="table">
                  <thead><tr><th>Value</th><th>Type</th><th>Reason</th><th>Added</th><th></th></tr></thead>
                  <tbody>
                    {c.dnc.map((d) => (
                      <tr key={d.id}>
                        <td>{d.value}</td><td className="mini">{d.type}</td><td className="mini">{d.reason || '-'}</td>
                        <td className="mini">{new Date(d.created_at).toLocaleDateString('en-IN')}{d.added_by_name ? ' by ' + d.added_by_name : ''}</td>
                        <td><button className="btn danger" style={{ padding: '3px 9px', fontSize: 11 }} onClick={() => removeDnc(d)}><Icon raw="trash" /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="empty">Nobody is on the list yet.</div>}
          </div>
        </div>
        <div>
          <div className="card" style={{ marginBottom: 14 }}>
            <h3 style={{ marginBottom: 8 }}>Built-in Rules</h3>
            <ul style={{ margin: 0, paddingLeft: 18 }}>{RULES.map((r) => <li key={r} className="mini" style={{ marginBottom: 6, color: 'var(--ink)' }}>{r}</li>)}</ul>
          </div>
          <div className="card">
            <h3 style={{ marginBottom: 8 }}>Activity</h3>
            {c.activity.length ? c.activity.slice(0, 20).map((x, i) => (
              <div className="statline" key={i} style={{ display: 'block', padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
                <div className="mini">{new Date(x.created_at).toLocaleString('en-IN')} &middot; {x.actor || 'System'}</div>
                <div>{VERB[x.action] || x.action.toLowerCase()} {x.entity_type.replace('_', ' ')}{x.meta ? ' - ' + x.meta : ''}</div>
              </div>
            )) : <div className="empty">Nothing logged yet.</div>}
          </div>
        </div>
      </div>
    </>
  );
}
