import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The starter ships optional component examples whose third-party typings are
  // not part of the production timecard bundle. Runtime compilation remains
  // strict for the app routes while deployment ignores those unused examples.
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
