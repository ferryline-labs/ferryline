import { createMDX } from "fumadocs-mdx/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // This app is docs-only (the marketing site lives in apps/site) — bounce the bare domain
  // straight to the docs tree instead of shipping an empty root page.
  async redirects() {
    return [{ source: "/", destination: "/docs", permanent: false }];
  },
};

const withMDX = createMDX();

export default withMDX(nextConfig);
