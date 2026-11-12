'use client';
import { useEffect, useState } from 'react';
import { api } from '../../legacy/lib/api.js';
import { useApp } from '../AuthContext';
import AddLeads from './AddLeads';
import Compliance from './Compliance';
import Dashboard from './Dashboard';
import Hunts from './Hunts';
import { LeadDetail, LeadsList } from './Leads';
import Market from './Market';
import Touches from './Touches';

// Client Hunter: a scored prospect pipeline with AI-drafted outreach that a person must
// approve. Rewritten from the original imperative module as React components.
export default function HunterPage({ markRendered }) {
  const { me } = useApp();
  const isAdmin = me.role === 'Admin';
  const [cfg, setCfg] = useState(null);
  const [tab, setTab] = useState('dashboard');
  const [filters, setFilters] = useState({ q: '', tier: '', niche: '', status: '' });
  const [openLead, setOpenLead] = useState(null);
  const [bump, setBump] = useState(0); // incremented when data changes so lists reload

  useEffect(() => {
    api('/api/hunter/config')
      .then(setCfg)
      .catch(() => setCfg({ enabled: false }))
      .finally(() => markRendered('hunter'));
  }, [markRendered]);

  if (!cfg) return <div className="empty">Loading…</div>;

  const tabs = [['dashboard', 'Dashboard'], ['market', 'Market'], ['leads', 'Leads'], ['approvals', 'Approvals'], ['tasks', 'Tasks'], ['hunts', 'Hunts'], ['add', 'Add leads'], ...(isAdmin ? [['compliance', 'Compliance']] : [])];
  const changed = () => setBump((b) => b + 1);

  return (
    <section className="page active">
      <div className="title">
        <h1>Client Hunter</h1>
        <p>A scored prospect pipeline for marketing outreach - every message is drafted, never auto-sent, and checked against the do-not-contact list.</p>
      </div>
      {cfg.enabled === false && <div className="notice warn">AI drafting isn&apos;t configured (no Anthropic API key set). Leads can still be added and scored - you just won&apos;t get AI-drafted outreach messages.</div>}
      {cfg.hunts_enabled === false && <div className="notice warn">Automatic lead discovery isn&apos;t configured (no Apify token set). Add leads by hand in the meantime - everything else still works.</div>}
      <div className="pnl" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
        {tabs.map(([id, label]) => (
          <button key={id} className={'btn ' + (tab === id ? '' : 'alt')} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {tab === 'dashboard' && <Dashboard key={bump} />}
      {tab === 'market' && <Market key={bump} onOpenLead={setOpenLead} />}
      {tab === 'leads' && <LeadsList filters={filters} setFilters={setFilters} onOpenLead={setOpenLead} onAdd={() => setTab('add')} reloadKey={bump} />}
      {tab === 'approvals' && <Touches key={'a' + bump} mode="approvals" onChanged={changed} />}
      {tab === 'tasks' && <Touches key={'t' + bump} mode="tasks" onChanged={changed} />}
      {tab === 'hunts' && <Hunts cfg={cfg} />}
      {tab === 'add' && <AddLeads cfg={cfg} onAdded={(goToLeads = true) => { changed(); if (goToLeads) setTab('leads'); }} />}
      {tab === 'compliance' && isAdmin && <Compliance />}

      {openLead != null && <LeadDetail id={openLead} cfg={cfg} onClose={() => setOpenLead(null)} onChanged={changed} />}
    </section>
  );
}
