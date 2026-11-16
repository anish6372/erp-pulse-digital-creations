// Date parsing for imported spreadsheets: Excel date cells, Excel serial numbers and common text formats.

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
