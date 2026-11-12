// Reads a content-plan spreadsheet (.xlsx or .csv) into rows the calendar import understands.
// Column headers are matched loosely ("Date", "Post date", "Planned date" all work), so the
// client does not have to reshape their own sheet.
import { readSheet } from 'read-excel-file/browser';

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

const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : '';
};
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

// Turn whatever is in a date cell into YYYY-MM-DD ('' if it can't be understood).
// Slash dates are read day-first (12/11/2026 = 12 Nov), the convention in India.
export function toIsoDate(v) {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : iso(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
  if (typeof v === 'number') {
    // Excel serial day number (days since 1899-12-30)
    if (v > 20000 && v < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
      return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
    return '';
  }
  const s = String(v ?? '').trim();
  if (!s) return '';
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (m) return iso(+m[3] < 100 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([A-Za-z]{3,9})[\s,-]+(\d{4})$/);
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) return iso(+m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1]);
  m = s.match(/^([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/);
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) return iso(+m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2]);
  return '';
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
