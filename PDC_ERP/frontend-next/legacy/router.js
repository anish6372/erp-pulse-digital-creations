// Replaces the old hash-less router.js. The Next.js shell owns navigation now; legacy page
// modules that still call refresh() / renderPage() are pointed at the shell through this shim.
let handlers = { renderPage: async () => {}, refresh: async () => {} };
export const registerRouter = (h) => {
  handlers = h;
};
export const renderPage = (p) => handlers.renderPage(p);
export const refresh = () => handlers.refresh();
