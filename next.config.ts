import type { NextConfig } from "next";

// The site is exported as static files (out/) for GitHub Pages. A project page is served below
// /<repository>/, so the build reads that prefix from NEXT_PUBLIC_BASE_PATH (empty for local use).
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  trailingSlash: true,
  images: { unoptimized: true },
  turbopack: { root: process.cwd() },
};

export default nextConfig;
