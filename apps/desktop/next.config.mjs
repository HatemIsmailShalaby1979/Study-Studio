import bundleAnalyzer from "@next/bundle-analyzer";

/**
 * Static export — produces ./out for Tauri to bundle.
 * Dev mode (next dev) is unaffected; the export only happens at build time.
 */

// BUNDLER POLICY — read this before changing any `next` script in package.json.
//
//   dev / dev:host      Turbopack (no flag)
//   build / build:prod  webpack (`--webpack`)
//
// `dev` used to carry `--webpack` too, and not for a real reason: Next 16 enables
// Turbopack by default, and @next/bundle-analyzer 14.x injected a `webpack` config
// unconditionally, which Turbopack refuses outright —
//
//   ERROR: This build is using Turbopack, with a `webpack` config and no
//          `turbopack` config.
//
// Upgrading the analyzer to 16.x, matching Next, removed that injection, so
// `next dev` now starts clean on Turbopack. Verified 2026-09-30: /, /generate/,
// /lesson/, /journey/, /library/ and /settings/ all return 200.
//
// `build` keeps the flag deliberately, and it is NOT redundant. Turbopack's static
// export emits no `out/_next/static/css/`, so `scripts/check-tokens.mjs` fails
// with "no compiled stylesheet found" — that gate reads the emitted CSS to prove
// every token defined in globals.css resolves in tailwind.config.ts, which is why
// the CI build job runs it straight after `build:prod`. Removing the flag turns
// the design-token gate red. Both directions verified 2026-09-30.
const nextConfig = {
  output: "export",
  images: {
    unoptimized: true,
  },
  trailingSlash: true,
  experimental: {
    webpackBuildWorker: true,
  },
};

// `npm run analyze` opens the treemap. Without ANALYZE=true this is a
// pass-through wrapper, so normal builds are unaffected.
const withAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
  openAnalyzer: true,
});

export default withAnalyzer(nextConfig);
