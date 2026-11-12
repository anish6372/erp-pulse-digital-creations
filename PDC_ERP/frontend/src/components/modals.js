import { api } from '../lib/api.js';
import { state } from '../lib/state.js';
import { $, esc, dateNow, toast, openModal, closeModal, confirmDialog } from '../lib/dom.js';
import { cache } from '../lib/cache.js';
import { refresh, renderPage } from '../router.js';
import { loadATS } from '../pages/ats.js';
import { loadMeetings } from '../pages/meetings.js';
import { refreshGroupList, openGroupChat } from '../pages/chat.js';
import { reloadMarketingTab } from '../pages/marketing.js';

export function openTaskModal() {
  const us = state.boot.users.filter((u) => u.active && u.role !== 'Admin');
  const cs = state.boot.clients.filter((c) => c.active);
  openModal(
    'Assign Task',
    `<form id="taskForm"><div class="fgrid">
      <div class="field full"><label>Title</label><input id="ft1" required></div>
      <div class="field"><label>Assignee</label><select id="ft2">${us.map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Client</label><select id="ft3"><option value="">Internal</option>${cs.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Priority</label><select id="ft4"><option>High</option><option selected>Medium</option><option>Low</option></select></div>
      <div class="field"><label>Due Date</label><input id="ft5" type="date" value="${dateNow()}" required></div>
      <div class="field"><label>Category</label><input id="ft6" value="Other"></div>
      <div class="field full"><label>Instructions</label><textarea id="ft7"></textarea></div>
    </div><button class="btn" style="margin-top:10px">Assign</button></form>`
  );
  $('taskForm').addEventListener('submit', createTask);
}

async function createTask(e) {
  e.preventDefault();
  const btn = e.submitter;
  try {
    if (btn) btn.disabled = true;
    await api('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title: $('ft1').value,
        description: $('ft7').value,
        assignee_id: $('ft2').value,
        client_id: $('ft3').value || null,
        priority: $('ft4').value,
        category: $('ft6').value,
        due_date: $('ft5').value,
      }),
    });
    closeModal();
    await refresh();
    toast('Task assigned — employee notified');
  } catch (err) {
    toast(err.message || 'Task assignment failed');
  } finally {
    if (btn) btn.disabled = false;
  }
}

export function openReportModal() {
  const mine = state.boot.tasks.filter((t) => t.assignee_id === state.me.id && t.status !== 'Done');
  openModal(
    'Submit Daily Work',
    `<form id="reportForm"><div class="fgrid">
      <div class="field"><label>Date</label><input id="fr1" type="date" value="${dateNow()}" required></div>
      <div class="field"><label>Task</label><select id="fr2"><option value="">General Work</option>${mine.map((t) => `<option value="${t.id}">${esc(t.title)}</option>`).join('')}</select></div>
      <div class="field"><label>Client</label><select id="fr3"><option value="">Internal</option>${state.boot.clients.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Hours</label><input id="fr4" type="number" step="0.25" min="0" value="1"></div>
      <div class="field full"><label>What did you complete?</label><textarea id="fr5" required></textarea></div>
      <div class="field"><label>Work / Video Drive Link</label><input id="fr6" placeholder="https://drive.google.com/..." type="url"></div>
      <div class="field"><label>Poster / Image Drive Link</label><input id="fr7" placeholder="https://drive.google.com/..." type="url"></div>
      <div class="field full"><label>Upload attachment (optional)</label><input id="fr8" type="file" accept="image/*,video/*,.pdf,.doc,.docx,.xlsx"><span class="mini">Upload up to 10 MB to the ERP, or paste Google Drive links above.</span></div>
      <div class="field full"><label><input id="fr9" type="checkbox"> Mark selected task Done</label></div>
    </div><button class="btn" style="margin-top:10px">Submit Work</button></form>`
  );
  $('reportForm').addEventListener('submit', createReport);
}

async function createReport(e) {
  e.preventDefault();
  try {
    let attachment_path = '',
      attachment_name = '';
    const file = $('fr8').files[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        toast('File must be 10 MB or less');
        return;
      }
      const data = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      const up = await api('/api/uploads', { method: 'POST', body: JSON.stringify({ name: file.name, data }) });
      attachment_path = up.url;
      attachment_name = up.name;
    }
    await api('/api/reports', {
      method: 'POST',
      body: JSON.stringify({
        task_id: $('fr2').value || null,
        client_id: $('fr3').value || null,
        work_date: $('fr1').value,
        hours: Number($('fr4').value || 0),
        work_text: $('fr5').value,
        work_drive_link: $('fr6').value,
        poster_drive_link: $('fr7').value,
        mark_done: $('fr9').checked,
        attachment_path,
        attachment_name,
      }),
    });
    closeModal();
    await refresh();
    toast('Work submitted successfully — Admin notified');
  } catch (err) {
    toast(err.message || 'Work submission failed');
  }
}

export function openLeaveModal() {
  openModal(
    'Leave / Half-Day Request',
    `<form id="leaveForm"><div class="fgrid">
      <div class="field"><label>Date</label><input id="fl1" type="date" value="${dateNow()}" required></div>
      <div class="field"><label>Type</label><select id="fl2"><option>Full Day</option><option>Half Day</option></select></div>
      <div class="field full"><label>Reason</label><textarea id="fl3" required></textarea></div>
    </div><button class="btn" style="margin-top:10px">Submit Request</button></form>`
  );
  $('leaveForm').addEventListener('submit', createLeave);
}

async function createLeave(e) {
  e.preventDefault();
  const btn = e.submitter;
  try {
    if (btn) btn.disabled = true;
    await api('/api/leaves', { method: 'POST', body: JSON.stringify({ leave_date: $('fl1').value, leave_type: $('fl2').value, reason: $('fl3').value }) });
    closeModal();
    await refresh();
    toast('Leave request sent — HR/Admin notified');
  } catch (err) {
    toast(err.message || 'Leave request failed');
  } finally {
    if (btn) btn.disabled = false;
  }
}

export function openUserModal(id) {
  const x = id ? state.boot.users.find((u) => u.id === id) : null;
  openModal(
    x ? 'Edit Employee' : 'Add Employee',
    `<form id="userForm"><div class="fgrid">
      <div class="field"><label>Name</label><input id="fu1" required value="${esc(x?.name || '')}"></div>
      <div class="field"><label>Employee ID</label><input id="fu2" required value="${esc(x?.employee_code || '')}"></div>
      <div class="field"><label>Role</label><select id="fu3"><option ${x?.role === 'Employee' ? 'selected' : ''}>Employee</option><option ${x?.role === 'Admin' ? 'selected' : ''}>Admin</option></select></div>
      <div class="field"><label>Department</label><input id="fu4" value="${esc(x?.department || '')}"></div>
      <div class="field"><label>Designation</label><input id="fu5" value="${esc(x?.designation || '')}"></div>
      <div class="field"><label>Joining Date</label><input id="fu6" type="date" value="${esc(x?.joining_date || dateNow())}"></div>
      <div class="field"><label>Salary / Month</label><input id="fu7" type="number" min="0" step="0.01" value="${x?.monthly_salary || 0}"></div>
      <div class="field"><label>Employment Type</label><input id="fu8" value="${esc(x?.employment_type || 'Full Time')}"></div>
      <div class="field"><label>Monthly Task Target</label><input id="fu9" type="number" min="0" value="${x?.monthly_target_tasks || 0}"></div>
      <div class="field"><label>Monthly Hours Target</label><input id="fu10" type="number" min="0" step="0.5" value="${x?.monthly_target_hours || 0}"></div>
      <div class="field"><label>Phone</label><input id="fu11" value="${esc(x?.phone || '')}"></div>
      <div class="field"><label>Email</label><input id="fu12" type="email" value="${esc(x?.email || '')}"></div>
      <div class="field full"><label>New Password ${x ? '(leave blank to keep existing)' : ''}</label><input id="fu13" type="password" autocomplete="new-password"></div>
      <div class="field"><label>Active</label><select id="fu14"><option value="1" ${x?.active !== 0 ? 'selected' : ''}>Active</option><option value="0" ${x?.active === 0 ? 'selected' : ''}>Inactive</option></select></div>
    </div><button class="btn" style="margin-top:10px">Save Employee</button></form>`
  );
  $('userForm').addEventListener('submit', (e) => saveUser(e, id || 0));
}

async function saveUser(e, id) {
  e.preventDefault();
  // Read every form value FIRST, before anything that might touch the modal - confirmDialog()
  // below reuses this same #modal/#modalBody to show its own prompt, which replaces this
  // form's HTML outright and then clears it entirely once answered. Reading $('fu1') etc.
  // AFTER that point returns null (the inputs are gone), which silently broke every save
  // that needed confirmation: the role-change confirm, then `$('fu1').value` throwing on a
  // null element, aborting the function before the API call ever ran.
  const newRole = $('fu3').value;
  const b = {
    name: $('fu1').value,
    employee_code: $('fu2').value.trim().toLowerCase(),
    role: newRole,
    department: $('fu4').value,
    designation: $('fu5').value,
    joining_date: $('fu6').value,
    monthly_salary: Number($('fu7').value || 0),
    employment_type: $('fu8').value,
    monthly_target_tasks: Number($('fu9').value || 0),
    monthly_target_hours: Number($('fu10').value || 0),
    phone: $('fu11').value,
    email: $('fu12').value,
    active: Number($('fu14').value),
  };
  const password = $('fu13').value;

  if (id) {
    const existing = state.boot.users.find((u) => u.id === id);
    if (existing && existing.role !== newRole) {
      const warn =
        newRole === 'Employee'
          ? `Change ${existing.name} from Admin to Employee? They will immediately lose access to Team, Payroll and all other admin-only pages.`
          : `Change ${existing.name} from Employee to Admin? They will get full access to every employee's data, payroll and settings.`;
      if (!(await confirmDialog(warn, { title: 'Confirm Role Change' }))) return;
    }
  }

  // Editing a user with the password field left blank must keep their existing password -
  // only a brand-new employee gets the default. Sending 'Welcome@2026' on every blank edit
  // would silently reset whoever's being edited, which is exactly what the label next to
  // the field promises NOT to do.
  const payload = id ? { ...b, ...(password ? { password } : {}) } : { ...b, password: password || 'Welcome@2026' };
  await api(id ? '/api/users/' + id : '/api/users', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
  closeModal();
  await refresh();
  toast('Employee saved');
}

export function openClientModal(id) {
  const x = id ? state.boot.clients.find((c) => c.id === id) : null;
  openModal(
    x ? 'Edit Client' : 'Add Client',
    `<form id="clientForm"><div class="fgrid">
      <div class="field"><label>Name</label><input id="fc1" required value="${esc(x?.name || '')}"></div>
      <div class="field"><label>Short Name</label><input id="fc2" required value="${esc(x?.short_name || '')}"></div>
      <div class="field"><label>Business Type</label><input id="fc3" placeholder="e.g. Cafe, Restaurant, Retail" value="${esc(x?.business_type || '')}"></div>
      <div class="field"><label>Contact Person</label><input id="fc4" value="${esc(x?.contact_person || '')}"></div>
      <div class="field"><label>Phone</label><input id="fc5" value="${esc(x?.phone || '')}"></div>
      <div class="field"><label>Email</label><input id="fc6" type="email" value="${esc(x?.email || '')}"></div>
      <div class="field full"><label>Address</label><textarea id="fc7">${esc(x?.address || '')}</textarea></div>
      <div class="field full"><label>Brand voice (used by the AI writing tools)</label><textarea id="fc9" maxlength="1000" placeholder="e.g. Warm and playful, short sentences, a few emojis, never salesy. Speaks to young professionals.">${esc(x?.brand_voice || '')}</textarea></div>
      ${x ? `<div class="field"><label>Status</label><select id="fc8"><option value="1" ${x?.active !== 0 ? 'selected' : ''}>Active</option><option value="0" ${x?.active === 0 ? 'selected' : ''}>Inactive</option></select></div>` : ''}
    </div><button class="btn" style="margin-top:10px">${x ? 'Save Changes' : 'Save'}</button></form>`
  );
  $('clientForm').addEventListener('submit', (e) => saveClient(e, id || 0));
}

async function saveClient(e, id) {
  e.preventDefault();
  const b = {
    name: $('fc1').value,
    short_name: $('fc2').value,
    business_type: $('fc3').value,
    contact_person: $('fc4').value,
    phone: $('fc5').value,
    email: $('fc6').value,
    address: $('fc7').value,
    brand_voice: $('fc9').value,
  };
  if (id) b.active = Number($('fc8').value);
  await api(id ? '/api/clients/' + id : '/api/clients', { method: id ? 'PUT' : 'POST', body: JSON.stringify(b) });
  closeModal();
  await refresh();
  renderPage('clients');
  toast(id ? 'Client updated' : 'Client added');
}

export async function removeClient(id) {
  const c = state.boot.clients.find((x) => x.id === id);
  const ok = await confirmDialog(
    `Remove ${c?.name || 'this client'}?\n\nThis deactivates the client - their task and work-report history is kept, not deleted. You can reactivate them later by editing the record.`,
    { title: 'Remove Client', confirmText: 'Remove' }
  );
  if (!ok) return;
  try {
    await api('/api/clients/' + id, { method: 'DELETE' });
    await refresh();
    renderPage('clients');
    toast('Client deactivated');
  } catch (e) {
    toast(e.message || 'Could not remove client');
  }
}

export function openCandidateModal(id) {
  const x = cache.atsRows.find((c) => c.id === id);
  const stages = ['Applied', 'Screening', 'Shortlisted', 'Interview', 'Selected', 'Rejected'];
  openModal(
    x ? 'Edit Candidate' : 'Add Candidate',
    `<form id="candidateForm"><div class="fgrid">
      <div class="field"><label>Name</label><input id="ca1" required value="${esc(x?.name || '')}"></div>
      <div class="field"><label>Position</label><input id="ca2" required value="${esc(x?.position || '')}"></div>
      <div class="field"><label>Phone</label><input id="ca3" value="${esc(x?.phone || '')}"></div>
      <div class="field"><label>Email</label><input id="ca4" value="${esc(x?.email || '')}"></div>
      <div class="field"><label>Source</label><input id="ca5" value="${esc(x?.source || '')}"></div>
      <div class="field"><label>Stage</label><select id="ca6">${stages.map((s) => `<option ${x?.stage === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <div class="field"><label>Interview Date</label><input id="ca7" type="date" value="${esc(x?.interview_date || '')}"></div>
      <div class="field"><label>Resume/Portfolio Drive</label><input id="ca8" type="url" value="${esc(x?.resume_link || '')}"></div>
      <div class="field full"><label>Notes</label><textarea id="ca9">${esc(x?.notes || '')}</textarea></div>
    </div><button class="btn" style="margin-top:10px">Save Candidate</button></form>`
  );
  $('candidateForm').addEventListener('submit', (e) => saveCandidate(e, id || 0));
}

async function saveCandidate(e, id) {
  e.preventDefault();
  const btn = e.submitter;
  try {
    if (btn) btn.disabled = true;
    const b = {
      name: $('ca1').value,
      position: $('ca2').value,
      phone: $('ca3').value,
      email: $('ca4').value,
      source: $('ca5').value,
      stage: $('ca6').value,
      interview_date: $('ca7').value,
      resume_link: $('ca8').value,
      notes: $('ca9').value,
    };
    await api(id ? '/api/ats/' + id : '/api/ats', { method: id ? 'PUT' : 'POST', body: JSON.stringify(b) });
    closeModal();
    await loadATS();
    toast(id ? 'Candidate updated' : 'Candidate added');
  } catch (err) {
    toast(err.message || 'ATS save failed');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function toDatetimeLocalValue(iso) {
  const d = iso ? new Date(iso) : new Date(Date.now() + 30 * 60000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function openMeetingModal(id, existing) {
  openModal(
    existing ? 'Edit Meeting' : 'Schedule Meeting',
    `<form id="meetingForm"><div class="fgrid">
      <div class="field full"><label>Title</label><input id="mt1" required value="${esc(existing?.title || '')}"></div>
      <div class="field full"><label>Description</label><textarea id="mt2">${esc(existing?.description || '')}</textarea></div>
      <div class="field"><label>Date & Time</label><input id="mt3" type="datetime-local" required value="${toDatetimeLocalValue(existing?.scheduled_at)}"></div>
      <div class="field"><label>Duration (minutes)</label><input id="mt4" type="number" min="5" step="5" value="${existing?.duration_minutes || 30}"></div>
      <div class="field full"><label>Meeting Link</label><input id="mt5" type="url" placeholder="https://meet.google.com/xxx-xxxx-xxx" required value="${esc(
        existing?.meeting_link || ''
      )}"><span class="mini">Don't have one? <a href="https://meet.google.com/new" target="_blank" rel="noopener">Create a Google Meet link</a> and paste it here.</span></div>
    </div><button class="btn" style="margin-top:10px">${existing ? 'Save Changes' : 'Schedule Meeting'}</button></form>`
  );
  $('meetingForm').addEventListener('submit', (e) => saveMeeting(e, id || 0));
}

async function saveMeeting(e, id) {
  e.preventDefault();
  const btn = e.submitter;
  try {
    if (btn) btn.disabled = true;
    const b = {
      title: $('mt1').value,
      description: $('mt2').value,
      scheduled_at: new Date($('mt3').value).toISOString(),
      duration_minutes: Number($('mt4').value || 30),
      meeting_link: $('mt5').value,
    };
    await api(id ? '/api/meetings/' + id : '/api/meetings', { method: id ? 'PUT' : 'POST', body: JSON.stringify(b) });
    closeModal();
    await loadMeetings();
    toast(id ? 'Meeting updated' : 'Meeting scheduled — team notified');
  } catch (err) {
    toast(err.message || 'Could not save meeting');
  } finally {
    if (btn) btn.disabled = false;
  }
}

export function openGroupModal() {
  const users = state.boot.users.filter((u) => u.active && u.id !== state.me.id);
  openModal(
    'New Group',
    `<form id="groupForm">
      <div class="field full"><label>Group Name</label><input id="gp1" required placeholder="e.g. Client Launch Squad"></div>
      <div class="field full"><label>Members</label><div class="member-pick">${users
        .map((u) => `<label class="member-pick-row"><input type="checkbox" value="${u.id}"> ${esc(u.name)} <span class="mini">${esc(u.role)}</span></label>`)
        .join('')}</div></div>
      <button class="btn" style="margin-top:10px">Create Group</button>
    </form>`
  );
  $('groupForm').addEventListener('submit', createGroup);
}

async function createGroup(e) {
  e.preventDefault();
  const btn = e.submitter;
  const ids = Array.from(document.querySelectorAll('#groupForm input[type=checkbox]:checked')).map((el) => Number(el.value));
  if (!ids.length) {
    toast('Select at least one member');
    return;
  }
  try {
    if (btn) btn.disabled = true;
    const d = await api('/api/chat/groups', { method: 'POST', body: JSON.stringify({ name: $('gp1').value, member_ids: ids }) });
    closeModal();
    toast('Group created');
    await refreshGroupList();
    await openGroupChat(d.id);
  } catch (err) {
    toast(err.message || 'Could not create group');
  } finally {
    if (btn) btn.disabled = false;
  }
}

export function openReelModal(clientId, existing) {
  openModal(
    existing ? 'Edit Reel' : 'Log Reel Performance',
    `<form id="reelForm"><div class="fgrid">
      <div class="field full"><label>Reel Title / Caption</label><input id="rl1" required value="${esc(existing?.title || '')}"></div>
      <div class="field full"><label>Instagram Link (optional)</label><input id="rl2" type="url" placeholder="https://instagram.com/reel/..." value="${esc(existing?.reel_url || '')}"></div>
      <div class="field"><label>Posted Date</label><input id="rl3" type="date" required value="${esc(existing?.posted_at || dateNow())}"></div>
      <div class="field"><label>Reach</label><input id="rl4" type="number" min="0" value="${existing?.reach || 0}"></div>
      <div class="field"><label>Plays</label><input id="rl5" type="number" min="0" value="${existing?.plays || 0}"></div>
      <div class="field"><label>Likes</label><input id="rl6" type="number" min="0" value="${existing?.likes || 0}"></div>
      <div class="field"><label>Comments</label><input id="rl7" type="number" min="0" value="${existing?.comments || 0}"></div>
      <div class="field"><label>Shares</label><input id="rl8" type="number" min="0" value="${existing?.shares || 0}"></div>
      <div class="field"><label>Saves</label><input id="rl9" type="number" min="0" value="${existing?.saves || 0}"></div>
    </div><span class="mini">Copy these numbers from Instagram &rarr; the reel &rarr; View Insights.</span><button class="btn" style="margin-top:10px">${
      existing ? 'Save Changes' : 'Log Reel'
    }</button></form>`
  );
  $('reelForm').addEventListener('submit', (e) => saveReel(e, clientId, existing?.id || 0));
}

async function saveReel(e, clientId, id) {
  e.preventDefault();
  const btn = e.submitter;
  try {
    if (btn) btn.disabled = true;
    const b = {
      client_id: clientId,
      title: $('rl1').value,
      reel_url: $('rl2').value,
      posted_at: $('rl3').value,
      reach: Number($('rl4').value || 0),
      plays: Number($('rl5').value || 0),
      likes: Number($('rl6').value || 0),
      comments: Number($('rl7').value || 0),
      shares: Number($('rl8').value || 0),
      saves: Number($('rl9').value || 0),
    };
    await api(id ? '/api/marketing/reels/' + id : '/api/marketing/reels', { method: id ? 'PUT' : 'POST', body: JSON.stringify(b) });
    closeModal();
    await reloadMarketingTab();
    toast(id ? 'Reel updated' : 'Reel logged');
  } catch (err) {
    toast(err.message || 'Could not save reel');
  } finally {
    if (btn) btn.disabled = false;
  }
}

export function openAudienceModal(clientId) {
  openModal(
    'Add Audience Breakdown',
    `<form id="audienceForm"><div class="fgrid">
      <div class="field"><label>Scope</label><select id="ag1"><option value="country">Country</option><option value="city">City</option><option value="age">Age group</option><option value="gender">Gender</option></select></div>
      <div class="field"><label>Date Logged</label><input id="ag2" type="date" value="${dateNow()}" required></div>
      <div class="field full"><label>Location Name</label><input id="ag3" placeholder="e.g. India, Mumbai, 18-24, Female" required></div>
      <div class="field full"><label>Percentage of Audience</label><input id="ag4" type="number" min="0" max="100" step="0.1" required></div>
    </div><span class="mini">From Instagram &rarr; Professional Dashboard &rarr; Total Followers &rarr; Top Cities / Top Countries.</span><button class="btn" style="margin-top:10px">Add</button></form>`
  );
  $('audienceForm').addEventListener('submit', (e) => saveAudience(e, clientId));
}

async function saveAudience(e, clientId) {
  e.preventDefault();
  const btn = e.submitter;
  try {
    if (btn) btn.disabled = true;
    const b = { client_id: clientId, scope: $('ag1').value, snapshot_date: $('ag2').value, label: $('ag3').value, percentage: Number($('ag4').value || 0) };
    await api('/api/marketing/audience', { method: 'POST', body: JSON.stringify(b) });
    closeModal();
    await reloadMarketingTab();
    toast('Audience breakdown added');
  } catch (err) {
    toast(err.message || 'Could not save audience data');
  } finally {
    if (btn) btn.disabled = false;
  }
}

export function openGrowthModal(clientId) {
  openModal(
    'Log Monthly Followers',
    `<form id="growthForm"><div class="fgrid">
      <div class="field"><label>Month</label><input id="gr1" type="month" value="${dateNow().slice(0, 7)}" required></div>
      <div class="field"><label>Total Followers</label><input id="gr2" type="number" min="0" required></div>
    </div><span class="mini">Logging the same month again updates it rather than duplicating.</span><button class="btn" style="margin-top:10px">Save</button></form>`
  );
  $('growthForm').addEventListener('submit', (e) => saveGrowth(e, clientId));
}

async function saveGrowth(e, clientId) {
  e.preventDefault();
  const btn = e.submitter;
  try {
    if (btn) btn.disabled = true;
    const b = { client_id: clientId, month: $('gr1').value, followers: Number($('gr2').value || 0) };
    await api('/api/marketing/growth', { method: 'POST', body: JSON.stringify(b) });
    closeModal();
    await reloadMarketingTab();
    toast('Followers logged');
  } catch (err) {
    toast(err.message || 'Could not save growth data');
  } finally {
    if (btn) btn.disabled = false;
  }
}
