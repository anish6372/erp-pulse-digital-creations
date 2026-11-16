// Reads a content-plan spreadsheet (.xlsx or .csv) into rows the calendar import understands.
// Column headers are matched loosely ("Date", "Post date", "Planned date" all work), so the
// client does not have to reshape their own sheet.
import { readSheet } from 'read-excel-file/browser';
import { toIsoDate } from './dates.js';

const ALIASES = {
  date: ['date', 'post date', 'posting date', 'planned date', 'schedule', 'scheduled date', 'publish date', 'publishing date', 'go live', 'day'],
  title: ['title', 'topic', 'idea', 'content', 'content idea', 'post', 'reel', 'name', 'theme', 'concept'],
  kind: ['format', 'type', 'kind', 'content type', 'post type'],
  caption: ['caption', 'copy', 'post copy'],
  script: ['script', 'shot list', 'brief', 'notes', 'description', 'details'],
  link: ['link', 'drive link', 'media link', 'video link', 'url', 'draft link'],
  stage: ['stage', 'status'],
};

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ');

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

/** Read a File into { items, problems } where items are ready to POST to /api/content/import. */
export async function readContentSheet(file) {
  const lower = file.name.toLowerCase();
  let table;
  if (lower.endsWith('.csv')) table = parseCsv(await file.text());
  else if (lower.endsWith('.xlsx')) table = await readSheet(file);
  else throw new Error('Please upload an Excel (.xlsx) or CSV file. Old .xls files: open and Save As .xlsx first.');
  if (!table || table.length < 2) throw new Error('The sheet has no data rows under the header.');

  const headers = table[0].map(norm);
  const colOf = {};
  for (const [field, names] of Object.entries(ALIASES)) {
    const idx = headers.findIndex((h) => names.includes(h));
    if (idx >= 0) colOf[field] = idx;
  }
  if (colOf.title === undefined) throw new Error('Could not find a title column. Add a header such as "Title", "Topic" or "Idea".');

  const items = [];
  const problems = [];
  table.slice(1).forEach((r, i) => {
    const cell = (f) => (colOf[f] === undefined ? '' : r[colOf[f]]);
    const title = String(cell('title') ?? '').trim();
    if (!title && !r.some((x) => String(x ?? '').trim())) return; // fully blank row
    const rawDate = cell('date');
    const date = toIsoDate(rawDate);
    if (String(rawDate ?? '').trim() && !date) problems.push(`Row ${i + 2}: could not read the date "${rawDate}"`);
    items.push({
      title,
      date,
      kind: String(cell('kind') ?? '').trim(),
      caption: String(cell('caption') ?? '').trim(),
      script: String(cell('script') ?? '').trim(),
      link: String(cell('link') ?? '').trim(),
      stage: String(cell('stage') ?? '').trim(),
    });
  });
  return { items, problems, hasDate: colOf.date !== undefined };
}

export const TEMPLATE_CSV =
  'Date,Title,Format,Caption,Script,Link\n' +
  '2026-12-01,Cold coffee pour slow motion,Reel,Summer is here,Hook: steam rising. Shots: pour / swirl / sip,\n' +
  '2026-12-03,Menu highlight carousel,Carousel,Our top 5 this month,,\n';
