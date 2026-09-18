import { NextResponse } from "next/server";
import { ensureSchema, isTursoConfigured, testDbConnection } from "@/lib/db";
import { isLlmConfigured, getModelName } from "@/lib/llmEvaluator";

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
      mode: isTursoConfigured() ? "turso" : "local-file",
      message: db.message,
    },
    llm: {
      configured: isLlmConfigured(),
      model: getModelName(),
    },
    scraper: {
      // No API key or external account needed — always available, best-effort
      // per-site (see docs/architecture/10-setup-and-deployment.md).
      available: true,
    },
  });
}
