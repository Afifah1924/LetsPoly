# LetsPoly

Interactive polyhedron construction — explore 3D solids, unfold them into 2D nets, and generate printable paper templates.

![Explorer — interactive 3D polyhedron](screenshots/01-explorer-3d-model.png)

## Features

- **Home** (`/`) — landing page.
- **Explorer** (`/explorer`) — rotate and zoom 3D polyhedra, play the fold/unfold transition, and use the net panel (the `app/generator/components/*` pieces) to pick a solid, size the template and print it.
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

## Anonymous report emails

`POST /api/report` (`app/api/report/route.ts`) validates the message, silently drops honeypot spam, applies a light per-IP rate limit (5 reports / 10 minutes) and sends the email through [Resend](https://resend.com) **server-side**, so the API key is never exposed to the browser.

Environment variables — copy `.env.example` to `.env.local` for local testing and add the same keys in Vercel for production. The inbox address is **not** committed to the repo, so it lives only in these variables:

| Variable | Required | Purpose |
| --- | --- | --- |
| `RESEND_API_KEY` | yes | Resend API key (`re_...`) |
| `REPORT_TO_EMAIL` | yes | Inbox that receives the reports |
| `REPORT_FROM` | no | `From` header (default `LetsPoly Reports <onboarding@resend.dev>`) |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | no | Address shown in the browser's “or email us” fallback link; unset = link hidden |

## Deploy on Vercel

The app is a standard Next.js project, so Vercel needs no extra configuration:

1. Go to [vercel.com/new](https://vercel.com/new) and import `Afifah1924/LetsPoly` (the framework is detected automatically).
2. Add the environment variables above to **Production** and **Preview**.
3. Deploy — every `git push` to `main` then ships automatically, and each PR gets a preview URL.

Resend sandbox note: while sending from `onboarding@resend.dev`, mail is only delivered to the Resend account owner's address. Verify a domain in Resend to send from `@yourdomain` to any recipient.

> This project previously deployed to GitHub Pages through a static export. That workflow was removed because a static export cannot host server-side routes such as `/api/report`.

