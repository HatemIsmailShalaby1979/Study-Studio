import bundleAnalyzer from "@next/bundle-analyzer";

/**
 * Static export — produces ./out for Tauri to bundle.
 * Dev mode (next dev) is unaffected; the export only happens at build time.
 */
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
