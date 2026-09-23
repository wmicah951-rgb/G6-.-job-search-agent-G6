import { NextResponse } from "next/server";
import { ensureSchema, isDegraded, isTursoConfigured, testDbConnection } from "@/lib/db";
import { isLlmConfigured, getModelName, backupStatus } from "@/lib/llmEvaluator";

// Auto-run checks only — the database check is a free SELECT 1, cheap enough
// to run on every dashboard load. The LLM check is deliberately NOT run here:
// see /api/system-status/test-llm, which only fires on an explicit click, so
// simply opening the dashboard never spends a token.
export async function GET() {
  await ensureSchema();
  const db = await testDbConnection();

  return NextResponse.json({
    database: {
      ok: db.ok,
      // "temporary" means the configured database refused us and the app fell back to
      // in-memory storage: fully working, nothing saved (see src/lib/db.ts).
      mode: isDegraded() ? "temporary" : isTursoConfigured() ? "turso" : "local-file",
      degraded: isDegraded(),
      message: db.message,
    },
    llm: {
      configured: isLlmConfigured(),
      model: getModelName(),
      // The last-resort backup brain, and how often it has had to step in (see llmEvaluator.ts).
      backup: backupStatus(),
    },
    scraper: {
      // No API key or external account needed — always available, best-effort
      // per-site (see docs/architecture/10-setup-and-deployment.md).
      available: true,
    },
  });
}
