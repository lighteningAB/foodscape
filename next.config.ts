import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin Turbopack root to this project — a stray ~/package-lock.json was making
  // it infer the home dir as the workspace root.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
