import type { NextConfig } from "next";

/**
 * Keep the production build output separate from the dev server cache.
 *
 * Root cause of the earlier dev failures: `next build` wrote into the same
 * `.next` folder a running `next dev` server was reading, which corrupted its
 * manifests ("Unexpected end of JSON input" in loadManifest) and produced
 * HTTP 500s + "unrecoverable error" full reloads until `.next` was cleared.
 * Dev uses `.next`; production build/start use `.next-build`.
 */
const nextConfig: NextConfig = {
  distDir: process.env.NODE_ENV === "production" ? ".next-build" : ".next",
};

export default nextConfig;
