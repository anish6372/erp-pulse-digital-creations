'use client';
import { BreakdownTable, Kpi, NICHES, STATUS_LABEL, TIER_CLASS, useFetch } from './shared';

export default function Dashboard() {
  const { data: d, error, loading } = useFetch('/api/hunter/dashboard');
  if (loading) return <div className="empty">Loading…</div>;
  if (error || !d) return <div className="card"><div className="err">{error}</div></div>;
  return (
    <>
      <div className="grid g4" style={{ marginBottom: 14 }}>
        <Kpi label="Hot leads" value={d.hot_leads} sub="score 70+ and reachable" />
        <Kpi label="Drafts to approve" value={d.drafts_to_approve} sub="nothing sends without you" />
        <Kpi label="Tasks pending" value={d.tasks_pending} sub="DMs, calls, follow-ups" />
        <Kpi label="Approved today" value={d.approved_today} sub="messages approved today" />
      </div>
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <div className="card">
          <h3 style={{ marginBottom: 10 }}>Call these first</h3>
          {d.call_these_first.length ? (
            d.call_these_first.map((l) => (
              <div className="statline" key={l.id}>
                <span><b>{l.score}</b> <span className={'badge ' + (TIER_CLASS[l.tier] || 'gray')}>{l.tier}</span> {l.name}</span>
                <span className="mini">{NICHES[l.niche] || l.niche} &middot; {l.city || '—'}</span>
              </div>
            ))
          ) : (
            <div className="empty">No leads yet - add one to get started.</div>
          )}
        </div>
        <div className="card">
          <h3 style={{ marginBottom: 10 }}>Pipeline</h3>
          {d.funnel.map((f) => (
            <div className="statline" key={f.status}><span>{STATUS_LABEL[f.status] || f.status}</span><span className="badge gray">{f.count}</span></div>
          ))}
        </div>
      </div>
      <div className="grid g2" style={{ alignItems: 'start', marginTop: 14 }}>
        <div className="card"><h3 style={{ marginBottom: 8 }}>Performance by Location</h3><BreakdownTable rows={d.cities} kind="city" /></div>
        <div className="card"><h3 style={{ marginBottom: 8 }}>Performance by Niche</h3><BreakdownTable rows={d.niches} kind="niche" /></div>
      </div>
    </>
  );
}
