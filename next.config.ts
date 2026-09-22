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
      // The official class starter kit: the seed profile, the Test Lab's KIT-J001..J006 cases
      // and the ranked-output run all read these at run time (src/lib/classKit.ts).
      "./src/data/classkit/**/*",
      // Supabase's CA certificate, read at run time so the database connection is verified
      // rather than trusted blindly (src/lib/pgClient.ts).
      "./certs/*.crt",
    ],
  },
};

export default nextConfig;
