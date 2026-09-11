# LetsPoly

Interactive polyhedron construction — explore 3D solids, unfold them into 2D nets, and generate printable paper templates.

![Explorer — interactive 3D polyhedron](screenshots/01-explorer-3d-model.png)

## Features

- **Explorer** (`/`) — the main app: rotate and zoom 3D polyhedra, play the fold/unfold transition, and use the net panel (the `app/generator/components/*` pieces) to pick a solid, size the template and print it.
- **`/explorer`** — permanent redirect to `/`, kept so older links keep working.
- **`/home`** — the original landing page, preserved but not linked from the app.
- **Report widget** — the floating button (bottom-right) emails anonymous bug reports / feedback to the project inbox through [FormSubmit](https://formsubmit.co), straight from the browser.

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
| `npm run hearts:check` | Diagnose the shared heart counter (env + store + running app) |

The dev/production output folders are kept separate (`next.config.ts`) so a production build can never corrupt a running dev server's `.next` cache.

## Mobile & touch

- **One finger drag rotates** the model; **two fingers pinch to zoom**. The 3D stage sets `touch-action: none`, so the page never scrolls away while you drag (this was the "can't rotate on a phone" bug — without it the browser claims the gesture and fires `pointercancel`).
- **Phones get the full viewport width.** The `min(90vw, 1600px)` desktop cap only applies from `sm` up, and the header, sticky picker, workspace and footer share one container, so the picker chips line up with the page content instead of hanging out over the left edge. Wasting 10% of a 390px screen also used to squeeze the structure-info cards until their labels spilled out of the 2-column grid.
- Below the `xl` breakpoint the layout stacks and reorders: a **sticky shape picker** (`/`), then the live preview, then the structure info. The full structures list is desktop-only.
- **The Transition view keeps a real model area on phones.** Its step pills (`3D Model / Partial Fold / Flat Net`) are a single compact row below `sm`, the fold controls drop their `3D`/`Flat` end labels, and the box is at least `58svh` tall. Before this the three pills stacked into ~156px of a 291px square and the fold controls needed 142px of a 134px area, so the canvas was never sized (it stayed at the 300×150 default and got clipped) and the model was effectively invisible. There is deliberately no `aspect-square` on the mobile transition box: with a definite `min-height` it also forces the *width*, which overflowed the column.
- The picker **scrolls the selected chip into view** (it is centred on load and after every tap). It is the only way to change the solid on a phone, and the header badge that names it is desktop-only — so an off-screen chip left no indication of what was loaded.
- Text fields are **16px on phones** (14px from `sm` up) so iOS Safari does not zoom the viewport when one is focused; that zoom used to shift the whole layout while entering a net size.
- All controls are at least **40px** tall, and the fold slider has a 40px touch area.
- The `?` badge next to the preview toggles a gesture cheat-sheet (it is tappable, not hover-only).

## Anonymous bug reports / feedback

The floating button (bottom-right) posts to [FormSubmit](https://formsubmit.co) **from the browser**:

```
POST https://formsubmit.co/ajax/letspolymake@gmail.com     (JSON in, JSON out)
```

No API key, no server route, no environment variables — the recipient address in that URL *is* the whole configuration (`FORM_ENDPOINT` in `app/components/SiteFooter.tsx`).

| Form field | Sent as | Notes |
| --- | --- | --- |
| Feedback | `Feedback` | The textarea. Required, 3–2000 characters. |
| Email *(optional)* | `email` + `_replyto` | Omitted entirely when left blank, so the report stays anonymous. When given, it is what "Reply" in the inbox addresses. |
| Page | `Page` | The page the report came from. |
| Subject | `_subject` | `Let's Poly Make — Bug / Feedback Report`. |
| Layout | `_template: "table"` | Readable rows rather than a wall of text. |

The email address input is the only thing asked for beyond the report itself, and it is optional: leave it empty and the submission is still sent, with nothing identifying collected.

**First-time activation (one click).** The first submission makes FormSubmit email an **"Activate Form"** link to `letspolymake@gmail.com`. Until that link is clicked it answers `{"success":"false","message":"This form needs Activation…"}` and nothing is delivered — the panel shows that message rather than a false success. Click it once and every later report is emailed straight through.

**Success is the body, not the status code.** FormSubmit answers `HTTP 200` even when it refuses a submission, so the panel only treats a report as sent when the body says `success: "true"`. Anything else (activation pending, spam filtering) is shown as an error, the visitor's text stays in the box, and the UI never claims the report went through.

**No mail-client handoff.** Nothing opens the visitor's own mail app: the report is relayed from the page itself, so there is no `mailto:` link and no fallback that depends on which mail client someone happens to have.

> **Not used: Web3Forms.** Its free plan rejects server-side calls, and posting from the browser would expose its key. FormSubmit takes no key at all, which is why it fits here.

## Anonymous hearts (shared counter)

The “leave your mark” heart in the report panel is counted **globally**: every
distinct visitor adds one, and each visitor can add only one.

- `GET /api/hearts` → `{ ok, configured, count, hint? }`
- `POST /api/hearts` `{ id }` → `{ ok, configured, counted, count }`

How it stays honest without accounts:

- The browser generates a random anonymous id (localStorage) — no personal data.
  The server records it once with `SET … NX`, so a repeat click, reload or a
  second visit returns `counted: false` and leaves the total untouched.
- A per‑network **burst** budget applies to **new** hearts only. It is a short,
  time‑bucketed window (60 new hearts per 10 minutes), so it heals on its own
  instead of locking a whole address out — carriers, schools, offices and CGNAT
  put thousands of genuine visitors behind one IP, and the old 25‑per‑*day* cap
  froze the counter for everyone on such a network until midnight.
- If the platform tells the route nothing about the caller (no
  `x-forwarded-for` / `x-real-ip` / `cf-connecting-ip`), the network budget is
  **skipped** rather than hashing a missing header — one shared bucket would
  otherwise let a single budget rate‑limit the entire site. The visitor id is
  the real guard.
- Visitors whose browser blocks storage (Safari private browsing, “block all
  cookies”) still get an id for the page view, so their heart is counted instead
  of being dropped for having nothing to de‑duplicate on.
- A heart that could not be counted is **never silently swallowed**: the panel
  says why (burst limit / store unreachable) and the retry lock is released. The
  total also never moves backwards if a late response arrives after a click.
- Storage is Redis over the Upstash/Vercel KV REST API (no npm dependency).
  Env: `KV_REST_API_URL` + `KV_REST_API_TOKEN`, or the Upstash equivalents.

### Turning counting on (1 minute, free)

The shared total needs a store — without one the route cannot know about other
visitors, and it says so (`configured: false` plus a `hint` naming what is
missing).

1. **Create a Redis database** at [upstash.com](https://upstash.com) (or add
   Storage → Redis in Vercel). The free tier is plenty.
2. **Copy the REST URL and the write token** from that same database. Use the
   write token, not the read‑only one, and don’t mix a URL from one integration
   with a token from another — both answer `401 Unauthorized`, which looks
   exactly like “the counter is broken”.
3. **Add them in Vercel** → Settings → Environment Variables for **Production
   and Preview**:
   `KV_REST_API_URL` + `KV_REST_API_TOKEN` (Vercel KV) **or**
   `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (Upstash).
4. **Redeploy.** Environment changes only apply to new deployments, so a push or
   a “Redeploy” in Vercel is required; nothing changes in a running one.

Verify whenever you like — the command reports the variables it can see, writes
to the store with temporary keys (never the live total), and asks the deployed
app what it thinks:

```bash
npm run hearts:check -- --url https://<your-site>
```

`configured=true` and a `count` that grows when you open the site on a second
device means every visitor is being counted. For local development put the same
two lines in `.env.local` (copy `.env.example`) so your dev server shares the
counter too.

## Deploy on Vercel

The app is a standard Next.js project, so Vercel needs no extra configuration:

1. Go to [vercel.com/new](https://vercel.com/new) and import `Afifah1924/LetsPoly` (the framework is detected automatically).
2. Add the storage variables above (the Redis pair) to **Production** and **Preview** — bug reports need nothing here, since FormSubmit is configured in the code.
3. Deploy — every `git push` to `main` then ships automatically, and each PR gets a preview URL.

> This project previously deployed to GitHub Pages through a static export. That workflow was removed because a static export cannot host server-side routes such as `/api/hearts`.

