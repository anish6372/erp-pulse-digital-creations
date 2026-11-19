// Bridge between the plain-JS router and this React page: the router calls renderProspect()
// like any other page, and we mount (once) a React root into the page's <section>.
import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { state } from '../../lib/state.js';
import ProspectAnalyzer from './ProspectAnalyzer';

let root: Root | null = null;
let generation = 0;

export async function renderProspect(): Promise<void> {
  if (state.me?.role !== 'Admin') return;
  const el = document.getElementById('page-prospect');
  if (!el) return;
  if (!root) root = createRoot(el);
  // A new key remounts the page, so every visit reloads fresh data (same as the other pages).
  generation += 1;
  root.render(
    <StrictMode>
      <ProspectAnalyzer key={generation} />
    </StrictMode>
  );
}
