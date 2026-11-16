// Pagination helper: 20 rows per page, clamped page numbers, pager bar only when needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { paginate, bindPager, resetPage, pageWindow, PAGE_SIZE } from '../src/lib/paginate.js';

const items = (n) => Array.from({ length: n }, (_, i) => i + 1);

test('pagination: 20 rows per page', () => {
  assert.equal(PAGE_SIZE, 20);
  resetPage('t1');
  const p = paginate('t1', items(45));
  assert.equal(p.rows.length, 20);
  assert.equal(p.pages, 3);
  assert.equal(p.total, 45);
  assert.deepEqual([p.rows[0], p.rows[19]], [1, 20]);
});

test('pagination: no pager bar when everything fits on one page', () => {
  resetPage('t2');
  assert.equal(paginate('t2', items(20)).html, '');
  assert.equal(paginate('t2', []).rows.length, 0);
  assert.notEqual(paginate('t2', items(21)).html, '');
});

// A stand-in for the page container: hands bindPager one fake button per data-pg value.
const fakeRoot = (key, targets) => {
  const buttons = targets.map((t) => ({ dataset: { pg: t }, onclick: null }));
  return { buttons, querySelectorAll: (sel) => (sel.includes(`data-pager="${key}"`) ? buttons : []) };
};

test('pagination: Next / number buttons move between pages and the last page holds the remainder', () => {
  resetPage('t3');
  assert.equal(paginate('t3', items(45)).page, 1);
  const root = fakeRoot('t3', ['next', '3']);
  let renders = 0;
  bindPager(root, 't3', () => renders++);
  root.buttons[0].onclick(); // Next -> page 2
  assert.equal(paginate('t3', items(45)).page, 2);
  root.buttons[1].onclick(); // page 3
  const last = paginate('t3', items(45));
  assert.equal(last.page, 3);
  assert.equal(last.rows.length, 5);
  assert.deepEqual(last.rows, [41, 42, 43, 44, 45]);
  assert.equal(renders, 2);
});

test('pagination: page number is clamped when the list shrinks, and resetPage goes back to 1', () => {
  resetPage('t4');
  paginate('t4', items(60));
  const root = fakeRoot('t4', ['3']);
  bindPager(root, 't4', () => {});
  root.buttons[0].onclick();
  assert.equal(paginate('t4', items(60)).page, 3);
  const shrunk = paginate('t4', items(5)); // e.g. rows were deleted
  assert.equal(shrunk.page, 1);
  assert.equal(shrunk.rows.length, 5);
  root.buttons[0].onclick();
  resetPage('t4'); // e.g. a filter changed
  assert.equal(paginate('t4', items(60)).page, 1);
});

test('pagination: page window shows ellipses for long lists', () => {
  assert.deepEqual(pageWindow(1, 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(pageWindow(5, 12), [1, '…', 4, 5, 6, '…', 12]);
  assert.deepEqual(pageWindow(1, 12), [1, 2, '…', 12]);
});
