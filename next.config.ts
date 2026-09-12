import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingExcludes: {
    '*': ['./data/browser-profile/**'],
  },
};

export default nextConfig;
