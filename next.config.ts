import type { NextConfig } from "next";

/**
 * Build-output routing:
 *  - Vercel (process.env.VERCEL) uses the default `.next` so the platform picks
 *    up the build normally, and serverless routes in `app/api/**` are supported.
 *  - Locally, a production build goes to `.next-build` so it can never corrupt
 *    the `.next` folder a running `next dev` server is reading (that collision
 *    previously produced HTTP 500s + "unrecoverable error" full reloads).
 */
const onVercel = Boolean(process.env.VERCEL);

const nextConfig: NextConfig = {
  distDir: onVercel ? ".next" : process.env.NODE_ENV === "production" ? ".next-build" : ".next",
};

export default nextConfig;
