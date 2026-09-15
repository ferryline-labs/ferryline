import type { NextConfig } from "next";

// No basePath/assetPrefix: checked directly against apps/docs (this app's own sibling
// independently-deployable app, docs.ferryline.dev) rather than assumed — its next.config.ts sets
// neither, because it deploys as its own standalone root-domain app, not a sub-path of another
// app. playground.ferryline.dev is the same shape (its own root domain), so it needs the same
// zero deploy-specific config, confirmed rather than copied blind.
const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
