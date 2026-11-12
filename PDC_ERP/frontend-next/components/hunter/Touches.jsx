'use client';
import { useState } from 'react';
import { api } from '../../legacy/lib/api.js';
import { confirmDialog, toast } from '../../legacy/lib/dom.js';
import { TIER_CLASS, useFetch } from './shared';

// mode: 'approvals' (drafts awaiting a person) | 'tasks' (approved, sent by hand)
export default function Touches({ mode, onChanged }) {
  const { data, loading, reload } = useFetch('/api/hunter/touches?status=' + (mode === 'approvals' ? 'draft' : 'approved'));
  const [edits, setEdits] = useState({});
  const rows = (data?.rows || []).filter((r) => (mode === 'tasks' ? !r.outcome : true));
  const val = (t, k) => edits[t.id]?.[k] ?? t[k] ?? '';
  const setEdit = (t, k, v) => setEdits((e) => ({ ...e, [t.id]: { ...e[t.id], [k]: v } }));
  const done = () => {
    reload();
    onChanged?.();
  };

  const act = async (fn, okMsg, failMsg) => {
    try {
      await fn();
      toast(okMsg);
      done();
    } catch (e) {
      toast(e.message || failMsg);
    }
  };
  const approve = (t) => act(() => api(`/api/hunter/touches/${t.id}/approve`, { method: 'PUT', body: JSON.stringify({ subject: val(t, 'subject'), body: val(t, 'body') }) }), 'Approved - moved to Tasks', 'Could not approve this message');
  const reject = (t) => act(() => api(`/api/hunter/touches/${t.id}/reject`, { method: 'PUT' }), 'Rejected', 'Could not reject this message');
  const copy = async (t) => {
    try {
      await navigator.clipboard.writeText(val(t, 'body'));
      toast('Message copied');
    } catch (e) {
      toast('Could not copy - select the text and copy it manually');
    }
  };
  const outcome = async (t, o) => {
    if (o === 'asked_to_stop' && !(await confirmDialog('Add this contact to the do-not-contact list and stop reaching out to them?', { title: 'Asked to Stop', confirmText: 'Add & Stop', danger: true }))) return;
    act(() => api(`/api/hunter/touches/${t.id}/outcome`, { method: 'PUT', body: JSON.stringify({ outcome: o }) }), 'Logged', 'Could not log that outcome');
  };

  return (
    <div className="card">
      <h3 style={{ marginBottom: 10 }}>{mode === 'approvals' ? 'Approvals' : 'Tasks'}</h3>
      <div className="mini" style={{ marginBottom: 10 }}>
        {mode === 'approvals' ? 'Review each AI-drafted message. Edit if needed, then approve or reject - nothing sends itself.' : 'Approved messages waiting to be sent by hand (DM, call, email) and logged below.'}
      </div>
      {loading && !data ? <div className="empty">Loading…</div> : rows.length ? rows.map((t) => (
        <div className="card soft" style={{ marginBottom: 10 }} key={t.id}>
          <div className="row" style={{ justifyContent: 'space-between' }}><b>{t.lead_name}</b><span className={'badge ' + (TIER_CLASS[t.lead_tier] || 'gray')}>{t.lead_tier}</span></div>
          <div className="mini" style={{ margin: '4px 0' }}>{t.channel} &middot; {t.to_value || ''}</div>
          {t.subject ? <div className="field"><label>Subject</label><input value={val(t, 'subject')} readOnly={mode === 'tasks'} onChange={(e) => setEdit(t, 'subject', e.target.value)} /></div> : null}
          <div className="field"><label>Message</label><textarea value={val(t, 'body')} readOnly={mode === 'tasks'} onChange={(e) => setEdit(t, 'body', e.target.value)} /></div>
          {mode === 'approvals' ? (
            <div className="pnl" style={{ marginTop: 8 }}><button className="btn" onClick={() => approve(t)}>Approve</button><button className="btn alt" onClick={() => reject(t)}>Reject</button></div>
          ) : (
            <div className="pnl" style={{ marginTop: 8 }}>
              <button className="btn alt" onClick={() => copy(t)}>Copy message</button>
              <button className="btn" onClick={() => outcome(t, 'interested')}>Interested</button>
              <button className="btn alt" onClick={() => outcome(t, 'not_now')}>Not now</button>
              <button className="btn danger" onClick={() => outcome(t, 'asked_to_stop')}>Asked to stop</button>
            </div>
          )}
        </div>
      )) : <div className="empty">Nothing {mode === 'approvals' ? 'to approve' : 'pending'} right now.</div>}
    </div>
  );
}
