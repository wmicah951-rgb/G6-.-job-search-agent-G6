import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The agent reads its rulebook (src/data/agent-guidelines.md) at run time; make sure the
  // serverless bundle ships it. The agent falls back to a built-in default if it is missing.
  outputFileTracingIncludes: {
    "/api/**/*": ["./src/data/agent-guidelines.md"],
  },
};

export default nextConfig;
