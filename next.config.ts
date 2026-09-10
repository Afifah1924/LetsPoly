import type { NextConfig } from "next";

/**
 * Keep the production build output separate from the dev server cache.
 *
 * Root cause of the earlier dev failures: `next build` wrote into the same
 * `.next` folder a running `next dev` server was reading, which corrupted its
 * manifests ("Unexpected end of JSON input" in loadManifest) and produced
 * HTTP 500s + "unrecoverable error" full reloads until `.next` was cleared.
 * Dev uses `.next`; production build/start use `.next-build`.
 *
 * `GITHUB_PAGES=true` produces a fully static export in `out/` for GitHub
 * Pages (project site is served from /<repo>/, hence the basePath).
 */
const isPages = process.env.GITHUB_PAGES === "true";

const nextConfig: NextConfig = {
  // With `output: "export"` Next writes the static site into `distDir`, so the
  // Pages build targets `out/` (conventional, and what the workflow uploads).
  distDir: isPages ? "out" : process.env.NODE_ENV === "production" ? ".next-build" : ".next",
  ...(isPages
    ? {
        output: "export" as const,
        basePath: "/LetsPoly",
        assetPrefix: "/LetsPoly/",
        trailingSlash: true,
        images: { unoptimized: true },
      }
    : {}),
};

export default nextConfig;
