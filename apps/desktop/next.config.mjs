/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export — produces ./out directory for Tauri to bundle.
  // Dev mode (next dev) is unaffected; the export only happens at build time.
  output: "export",
  images: {
    unoptimized: true,
  },
  trailingSlash: true,
  experimental: {
    webpackBuildWorker: true,
  },
};

export default nextConfig;