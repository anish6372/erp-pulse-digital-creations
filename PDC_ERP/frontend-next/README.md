# PDC ERP - Next.js frontend

A Next.js (App Router) + React rewrite of the original plain-JavaScript frontend. The Express
backend is unchanged; Next proxies `/api`, `/uploads` and `/socket.io` to it (`next.config.mjs`).

```
npm install
BACKEND_URL=http://localhost:4000 npm run dev    # http://localhost:5173
npm run build && npm start
```

## Migration status

Done as a gradual (strangler-style) migration so the whole ERP works from day one:

| Area | State |
| --- | --- |
| App shell: sidebar, top bar, command palette (Ctrl+K), theme, idle logout, notification polling | React (`components/Shell.jsx`) |
| Auth: password, register, mobile OTP, Google | React (`components/Login.jsx`, `AuthContext.jsx`) |
| Routing | Next.js routes (`/dashboard`, `/hunter`, ...), public `/onboard/[token]` and `/review/[token]` |
| **Client Hunter** (dashboard, market map, leads, approvals, tasks, hunts, add leads + bulk CSV, compliance) | **React** (`components/hunter/`) |
| All other pages (dashboard, tasks, chat, payroll, ATS, ...) | Original modules in `legacy/`, mounted through `components/LegacyPage.jsx` |

To convert another page: build a React component, render it in `Shell.jsx` instead of
`LegacyPage`, and delete its module from `legacy/pages/`. `legacy/router.js` is a shim that
points the old `refresh()` / `renderPage()` calls at the Next shell.
