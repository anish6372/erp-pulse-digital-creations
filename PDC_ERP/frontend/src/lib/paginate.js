// Client-side pagination shared by every list page: 20 rows per page, remembered per list.
// Usage:
//   const p = paginate('tasks', rows);          // p.rows = this page's slice, p.html = the pager bar
//   ...render p.rows, then append p.html...
//   bindPager(container, 'tasks', renderAgain); // wires the Prev / Next / number buttons
// Call resetPage(key) when a filter or search changes, so the list jumps back to page 1.
export const PAGE_SIZE = 20;

const current = new Map();

export function resetPage(key) {
  current.delete(key);
}

export function pageWindow(page, pages) {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const out = [1];
  const from = Math.max(2, page - 1);
  const to = Math.min(pages - 1, page + 1);
  if (from > 2) out.push('…');
  for (let i = from; i <= to; i++) out.push(i);
  if (to < pages - 1) out.push('…');
  out.push(pages);
  return out;
}

export function paginate(key, items, size = PAGE_SIZE) {
  const list = Array.isArray(items) ? items : [];
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(Math.max(1, current.get(key) || 1), pages);
  current.set(key, page);
  const start = (page - 1) * size;
  const rows = list.slice(start, start + size);
  return { rows, page, pages, total, start, size, html: pagerHtml(key, page, pages, total, start, rows.length) };
}

function pagerHtml(key, page, pages, total, start, count) {
  if (pages <= 1) return '';
  const btn = (label, target, extra = '') =>
    `<button type="button" class="btn alt pg-btn${extra}" data-pg="${target}"${extra.includes('disabled') ? ' disabled' : ''}>${label}</button>`;
  const nums = pageWindow(page, pages)
    .map((n) => (n === '…' ? '<span class="pg-gap">…</span>' : btn(n, n, n === page ? ' active' : '')))
    .join('');
  return `<div class="pager" data-pager="${key}"><span class="mini">Showing ${start + 1}–${start + count} of ${total}</span><div class="pnl">${btn(
    '‹ Prev',
    'prev',
    page === 1 ? ' disabled' : ''
  )}${nums}${btn('Next ›', 'next', page === pages ? ' disabled' : '')}</div></div>`;
}

export function bindPager(root, key, rerender) {
  if (!root) return;
  root.querySelectorAll(`[data-pager="${key}"] [data-pg]`).forEach((b) => {
    b.onclick = () => {
      const t = b.dataset.pg;
      const now = current.get(key) || 1;
      current.set(key, t === 'prev' ? now - 1 : t === 'next' ? now + 1 : Number(t));
      rerender();
    };
  });
}
