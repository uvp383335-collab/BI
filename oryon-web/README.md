# oryon-web

The driverinsights web app in the Oryon AI design. It replaces `frontend/`: every page and flow
from that app is here, plus the Oryon portfolio screens, under one shell.

| Route | Page | Source |
|---|---|---|
| `/login`, `/signup`, `/verify-email`, `/forgot-password`, `/reset-password`, `/accept-invitation` | Auth flows | carried over from `frontend/` |
| `/` | Portfolio overview (KPIs, the read, health, charts, product comparison, alert map) | Oryon |
| `/portfolio/VC`, `/portfolio/CB`, `/portfolio/CM` | Metric family cards + metric drawer | Oryon |
| `/portfolio/alerts` | All flags | Oryon |
| `/analytics` (and `/dashboard`, the OAuth callback target) | Detailed analytics: every chart, drill-down, Excel export, AI Analyze, sync progress | carried over |
| `/connect`, `/invitations`, `/settings` | Data sources, team, settings | carried over |

Stack: React 19, TypeScript, React Router, TanStack Query, React Hook Form + Zod, Tailwind 4,
Recharts (analytics) and d3 (portfolio charts).

## How the design is applied

- `src/features/portfolio/oryon.css` is the Oryon design system, imported into Tailwind's
  components layer.
- The Tailwind theme tokens the carried-over components use (`surface*`, `ink*`, `line*`,
  `brand`, `success`, ...) are mapped onto the Oryon variables in `src/style.css`, so every page,
  chart and form takes the Oryon palette and fonts in both light and dark themes.
- `src/widgets/AppShell.tsx` is the Oryon sidebar + top bar for every signed-in page.

## Run

```bash
# backend on :4000 first (cd backend && npm run dev)
cd oryon-web
npm install
npm run dev          # http://localhost:5173
```

Port 5173 is what the backend's `FRONTEND_URL` points at (CORS, email links, OAuth redirects),
so no backend change is needed. Stop the old `frontend/` dev server first; both use 5173.

```bash
npm test             # vitest
npm run build        # tsc + vite build -> dist/
```
