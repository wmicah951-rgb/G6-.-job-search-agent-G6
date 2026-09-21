import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Files the server reads from disk at run time, which Next's tracer cannot see on its own:
  // the agent's rulebook, the demo resume/preferences (seed profile + Test Lab), and every
  // test posting the Test Lab loads — including the class-page scenarios in jobs/spec/.
  // Without this the Vercel bundle can ship without them.
  outputFileTracingIncludes: {
    "/api/**/*": [
      "./src/data/agent-guidelines.md",
      "./src/data/resume.md",
      "./src/data/preferences.md",
      "./src/data/jobs/**/*.md",
    ],
  },
};

export default nextConfig;
