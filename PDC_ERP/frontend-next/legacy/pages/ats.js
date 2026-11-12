import { api } from '../lib/api.js';
import { state } from '../lib/state.js';
import { $, esc, initials, toast } from '../lib/dom.js';
import { cache } from '../lib/cache.js';
import { openCandidateModal } from '../components/modals.js';

const STAGES = ['Applied', 'Screening', 'Shortlisted', 'Interview', 'Selected', 'Rejected'];

export function renderATS() {
  if (state.me.role !== 'Admin') return;
  const rows = cache.atsRows;
  $('page-ats').innerHTML = `<div class="title"><h1>Applicant Tracking System</h1><p>Add candidates, move them through interview stages, and keep notes in one place.</p></div><div class="card"><div class="sectionHead"><div><h3>Candidate Pipeline</h3><div class="mini">${
    rows.length
  } total candidates</div></div><div class="pnl"><button class="btn alt" id="atsRefreshBtn">Refresh</button><button class="btn" id="addCandidateBtn">+ Add Candidate</button></div></div><div class="ats-grid">${STAGES.map(
    (stage) => {
      const a = rows.filter((x) => x.stage === stage);
      return `<div class="ats-column"><div class="ats-head"><b>${stage}</b><span class="badge gray">${a.length}</span></div>${
        a
          .map(
            (c) =>
              `<div class="ats-card" data-candidate-id="${c.id}"><div class="row"><div class="avatar">${initials(c.name)}</div><div><b>${esc(c.name)}</b><div class="mini">${esc(
                c.position
              )}</div></div></div><div class="mini" style="margin-top:9px">${esc(c.phone || c.email || 'No contact')}</div><div class="mini wrap" style="margin-top:7px">${esc(
                c.notes || 'No notes'
              )}</div><div class="pnl" style="margin-top:10px"><select data-stage-select>${STAGES.map((x) => `<option ${x === c.stage ? 'selected' : ''}>${x}</option>`).join(
                ''
              )}</select><button class="btn alt" data-edit-candidate>Edit</button></div></div>`
          )
          .join('') || '<div class="empty">No candidates</div>'
      }</div>`;
    }
  ).join('')}</div></div>`;
  $('atsRefreshBtn').onclick = loadATS;
  $('addCandidateBtn').onclick = () => openCandidateModal();
  $('page-ats')
    .querySelectorAll('[data-candidate-id]')
    .forEach((card) => {
      const id = Number(card.dataset.candidateId);
      card.querySelector('[data-stage-select]').onchange = (e) => quickCandidateStage(id, e.target.value);
      card.querySelector('[data-edit-candidate]').onclick = () => openCandidateModal(id);
    });
}

export async function loadATS() {
  try {
    const d = await api('/api/ats');
    cache.atsRows = d.rows || [];
    renderATS();
  } catch (err) {
    $('page-ats').innerHTML = `<div class="card"><div class="err">ATS could not load: ${esc(err.message)}</div><button class="btn" id="atsRetryBtn">Try Again</button></div>`;
    $('atsRetryBtn').onclick = loadATS;
  }
}

async function quickCandidateStage(id, stage) {
  try {
    const c = cache.atsRows.find((x) => x.id === id);
    if (!c) return;
    await api('/api/ats/' + id, { method: 'PUT', body: JSON.stringify({ ...c, stage }) });
    await loadATS();
    toast('Candidate stage updated');
  } catch (e) {
    toast(e.message || 'ATS update failed');
  }
}
