# LetsPoly

Interactive polyhedron construction — explore 3D solids, unfold them into 2D nets, and generate printable paper templates.

![Explorer — interactive 3D polyhedron](screenshots/01-explorer-3d-model.png)

## Features

- **Explorer** (`/`) — the main app: rotate and zoom 3D polyhedra, play the fold/unfold transition, and use the net panel (the `app/generator/components/*` pieces) to pick a solid, size the template and print it.
- **`/explorer`** — permanent redirect to `/`, kept so older links keep working.
- **`/home`** — the original landing page, preserved but not linked from the app.
- **Report widget** — the floating button (bottom-right) emails anonymous bug reports / feedback to the maintainer through this app's own serverless route.

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

On Windows you can also run the helper script, which installs dependencies and starts the dev server:

```powershell
./run-dev.ps1
```

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Dev server (webpack) writing to `.next` |
| `npm run build` | Production build → `.next-build` locally, `.next` on Vercel |
| `npm start` | Serve the production build |
| `npm run lint` | ESLint |

The dev/production output folders are kept separate (`next.config.ts`) so a production build can never corrupt a running dev server's `.next` cache.

## Mobile & touch

- **One finger drag rotates** the model; **two fingers pinch to zoom**. The 3D stage sets `touch-action: none`, so the page never scrolls away while you drag (this was the "can't rotate on a phone" bug — without it the browser claims the gesture and fires `pointercancel`).
- Below the `xl` breakpoint the layout stacks and reorders: a **sticky shape picker** (`/`), then the live preview, then the structure info. The full structures list is desktop-only.
- All controls are at least **40px** tall, and the fold slider has a 40px touch area.
- The `?` badge next to the preview toggles a gesture cheat-sheet (it is tappable, not hover-only).

## Anonymous report emails

`POST /api/report` (`app/api/report/route.ts`) validates the message, silently drops honeypot spam, applies a light per-IP rate limit (5 reports / 10 minutes) and sends the email through [Resend](https://resend.com) **server-side**, so the API key is never exposed to the browser.

Environment variables — copy `.env.example` to `.env.local` for local testing and add the same keys in Vercel for production. Only the API key is required — reports go to the default project inbox unless `REPORT_TO_EMAIL` overrides it:

| Variable | Required | Purpose |
| --- | --- | --- |
| `RESEND_API_KEY` | yes | Resend API key (`re_...`) |
| `REPORT_TO_EMAIL` | no | Overrides the default project inbox (`letspolymake@gmail.com`) |
| `REPORT_FROM` | no | `From` header (default `LetsPoly Reports <onboarding@resend.dev>`) |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | no | Fallback address in the “or email us” link (default `letspolymake@gmail.com`; empty hides the link) |

## Anonymous hearts (shared counter)

The “leave your mark” heart in the report panel is counted **globally**: every
distinct visitor adds one, and each visitor can add only one.

- `GET /api/hearts` → `{ ok, configured, count }`
- `POST /api/hearts` `{ id }` → `{ ok, configured, counted, count }`

How it stays honest without accounts:

- The browser generates a random anonymous id (localStorage) — no personal data.
  The server records it once with `SET … NX`, so a repeat click, reload or a
  second visit returns `counted: false` and leaves the total untouched.
- A per‑IP daily budget applies to **new** hearts only, so shared networks
  (school/office/mobile) are not blocked and one person cannot inflate the total.
- Storage is Redis over the Upstash/Vercel KV REST API (no npm dependency).
  Env: `KV_REST_API_URL` + `KV_REST_API_TOKEN`, or the Upstash equivalents.

**Setup (1 minute, free):** create a Redis database at
[upstash.com](https://upstash.com) (or add Vercel KV to the project) and copy the
two REST values into the Vercel environment variables, then redeploy.

With no store configured the route reports `configured: false` and the UI keeps
the older per‑browser counter, so nothing breaks.

## Deploy on Vercel

The app is a standard Next.js project, so Vercel needs no extra configuration:

1. Go to [vercel.com/new](https://vercel.com/new) and import `Afifah1924/LetsPoly` (the framework is detected automatically).
2. Add the environment variables above to **Production** and **Preview**.
3. Deploy — every `git push` to `main` then ships automatically, and each PR gets a preview URL.

Resend sandbox note: while sending from `onboarding@resend.dev`, mail is only delivered to the Resend account owner's address. Verify a domain in Resend to send from `@yourdomain` to any recipient.

> This project previously deployed to GitHub Pages through a static export. That workflow was removed because a static export cannot host server-side routes such as `/api/report`.

