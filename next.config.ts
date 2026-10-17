import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: __dirname,
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
};

export default nextConfig;
