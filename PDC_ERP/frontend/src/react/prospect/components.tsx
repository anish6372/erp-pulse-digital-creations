// Presentational pieces of the Prospect Analyzer. They only take props and call callbacks;
// all data loading lives in ProspectAnalyzer.tsx.
import { useState, type ChangeEvent, type FormEvent } from 'react';
import { icon } from '../../lib/icons.js';
import { EMPTY_FORM, POSTING_FREQUENCIES, type Report, type ReportForm, type ReportRow } from './types';

/** The app's icons are trusted inline SVG strings from lib/icons.js. */
export function Icon({ name }: { name: string }) {
  return <span style={{ display: 'inline-flex' }} dangerouslySetInnerHTML={{ __html: icon(name) }} />;
}

// ---------------- new report form ----------------

interface FormProps {
  disabled: boolean;
  busy: boolean;
  onSubmit: (form: ReportForm) => Promise<boolean>;
}

export function NewReportForm({ disabled, busy, onSubmit }: FormProps) {
  const [form, setForm] = useState<ReportForm>(EMPTY_FORM);

  // One change handler for every field, keyed by the input's name attribute.
  const update = (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await onSubmit(form)) setForm(EMPTY_FORM);
  };

  return (
    <div className="card">
      <h3 style={{ marginBottom: 10 }}>New Report</h3>
      <form onSubmit={submit}>
        <div className="fgrid">
          <div className="field full">
            <label>Business Name *</label>
            <input name="business_name" value={form.business_name} onChange={update} required placeholder="e.g. The Daily Grind Cafe" />
          </div>
          <div className="field full">
            <label>Website URL</label>
            <input name="website_url" type="url" value={form.website_url} onChange={update} placeholder="https://theirsite.com" />
          </div>
          <div className="field full">
            <label>Instagram Handle</label>
            <input name="instagram_handle" value={form.instagram_handle} onChange={update} placeholder="@theirhandle (optional)" />
          </div>
          <div className="field">
            <label>Followers</label>
            <input name="instagram_followers" type="number" min={0} value={form.instagram_followers} onChange={update} placeholder="e.g. 4200" />
          </div>
          <div className="field">
            <label>Last post (roughly)</label>
            <input name="instagram_last_post" value={form.instagram_last_post} onChange={update} placeholder="e.g. 3 days ago" />
          </div>
          <div className="field full">
            <label>Posting frequency (your impression)</label>
            <select name="instagram_posting_frequency" value={form.instagram_posting_frequency} onChange={update}>
              <option value="">Not noted</option>
              {POSTING_FREQUENCIES.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </div>
          <div className="field full">
            <label>Other Instagram notes</label>
            <textarea name="instagram_notes" value={form.instagram_notes} onChange={update} placeholder="e.g. Good food photos but no reels, bio has no link" />
          </div>
        </div>
        <div className="mini" style={{ margin: '6px 0 10px' }}>
          Instagram fields are filled in by hand - look at the prospect's public profile yourself and note what you see; the app never scrapes an account that hasn't authorized it.
        </div>
        <button className="btn" disabled={disabled || busy}>
          <Icon name="search" />
          <span>{busy ? 'Generating…' : 'Generate Report'}</span>
        </button>
      </form>
      {busy && (
        <div className="mini" style={{ marginTop: 14 }}>
          Analyzing the website and generating the strategy - usually takes 10-20 seconds…
        </div>
      )}
    </div>
  );
}

// ---------------- past reports ----------------

interface HistoryProps {
  rows: ReportRow[];
  selectedId?: number;
  onView: (row: ReportRow) => void;
  onDelete: (row: ReportRow) => void;
}

export function ReportHistory({ rows, selectedId, onView, onDelete }: HistoryProps) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = q ? rows.filter((r) => r.business_name.toLowerCase().includes(q)) : rows;

  return (
    <div className="card">
      <div className="sectionHead">
        <h3>Past Reports</h3>
        <span className="mini">{rows.length} total</span>
      </div>
      {rows.length > 0 && <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search reports…" style={{ width: '100%', marginBottom: 8 }} />}
      {shown.length === 0 ? (
        <div className="empty">{rows.length ? 'No reports match your search.' : 'No reports yet.'}</div>
      ) : (
        <div style={{ maxHeight: 520, overflow: 'auto' }}>
          {shown.map((r) => (
            <div
              key={r.id}
              className="row"
              style={{ justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--line)', background: r.id === selectedId ? 'var(--panel)' : undefined }}
            >
              <div style={{ cursor: 'pointer' }} onClick={() => onView(r)}>
                <b>{r.business_name}</b> {r.hunter_lead_id ? <span className="badge blue">From Client Hunter</span> : null}
                <div className="mini">{new Date(r.created_at).toLocaleDateString('en-IN')}</div>
              </div>
              <button className="btn danger" style={{ padding: '3px 9px', fontSize: 11 }} onClick={() => onDelete(r)} title="Delete report">
                <Icon name="trash" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------- the report itself ----------------

function SignalRow({ label, ok }: { label: string; ok?: boolean }) {
  const badge = ok === true ? <span className="badge green">Yes</span> : ok === false ? <span className="badge red">No</span> : <span className="badge gray">—</span>;
  return (
    <div className="statline">
      <span>{label}</span>
      {badge}
    </div>
  );
}

function ListCard({ title, items }: { title: string; items?: string[] }) {
  return (
    <div className="card">
      <h3 style={{ marginBottom: 8 }}>{title}</h3>
      {items && items.length ? (
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {items.map((i, n) => (
            <li key={n} className="mini" style={{ marginBottom: 6, color: 'var(--ink)' }}>
              {i}
            </li>
          ))}
        </ul>
      ) : (
        <div className="empty">None noted.</div>
      )}
    </div>
  );
}

const SIGNALS: [keyof Report['website_signals'], string][] = [
  ['is_https', 'HTTPS'],
  ['has_mobile_viewport_tag', 'Mobile-friendly tag'],
  ['mentions_online_ordering', 'Online ordering mentioned'],
  ['has_menu_reference', 'Menu referenced'],
  ['links_instagram', 'Instagram link on site'],
  ['links_facebook', 'Facebook link on site'],
  ['links_whatsapp', 'WhatsApp link on site'],
  ['has_contact_info', 'Contact info visible'],
];

export function ReportView({ report }: { report: Report }) {
  const s = report.website_signals;
  const swot = report.swot;
  return (
    <div style={{ marginTop: 16 }}>
      <div className="card" style={{ marginBottom: 14 }}>
        <h3>{report.business_name}</h3>
        {report.website_url && <div className="mini">{report.website_url}</div>}
        {report.instagram.handle && (
          <div className="mini">
            Instagram {report.instagram.handle}
            {report.instagram.followers != null ? ` · ${report.instagram.followers.toLocaleString()} followers` : ''}
          </div>
        )}
        {swot.elevator_pitch && (
          <div className="notice ok" style={{ marginTop: 10 }}>
            <b>Opening line:</b> {swot.elevator_pitch}
          </div>
        )}
      </div>

      {s.reachable !== undefined && (
        <div className="card" style={{ marginBottom: 14 }}>
          <h3 style={{ marginBottom: 8 }}>Website Signals</h3>
          <SignalRow label="Reachable" ok={s.reachable} />
          {s.note && (
            <div className="mini" style={{ color: 'var(--danger)' }}>
              {s.note}
            </div>
          )}
          {SIGNALS.map(([key, label]) => (
            <SignalRow key={key} label={label} ok={s[key] as boolean | undefined} />
          ))}
        </div>
      )}

      <div className="grid g3" style={{ marginBottom: 14 }}>
        <ListCard title="Strengths" items={swot.strengths} />
        <ListCard title="Weaknesses" items={swot.weaknesses} />
        <ListCard title="Opportunities for Pulse" items={swot.opportunities} />
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 8 }}>Suggested Strategy</h3>
        {report.strategy ? (
          report.strategy.split('\n\n').map((p, n) => (
            <p key={n} style={{ margin: '0 0 10px' }}>
              {p}
            </p>
          ))
        ) : (
          <div className="empty">No strategy generated.</div>
        )}
      </div>
    </div>
  );
}
