import type { NextConfig } from "next";

/**
 * Build-output routing.
 *
 * Hosted/CI builds (Vercel, GitHub Actions, …) must use the conventional
 * `.next` directory, because the platform looks for it after the build.
 * Vercel failed with 'The Next.js output directory ".next" was not found'
 * when a production build was redirected to `.next-build`.
 *
 * Only a *local* production build is redirected to `.next-build`, so it can
 * never corrupt the `.next` folder a running `next dev` server is reading
 * (that collision previously produced HTTP 500s + "unrecoverable error" full
 * reloads until `.next` was cleared).
 */
const isolatedLocalProdBuild =
  process.env.NODE_ENV === "production" && !process.env.VERCEL && !process.env.CI;

const nextConfig: NextConfig = {
  distDir: isolatedLocalProdBuild ? ".next-build" : ".next",
  /**
   * The interactive app used to live at /explorer. It is now the home page, so
   * /explorer permanently redirects to / to keep old links working.
   */
  async redirects() {
    return [{ source: "/explorer", destination: "/", permanent: true }];
  },
};

export default nextConfig;
