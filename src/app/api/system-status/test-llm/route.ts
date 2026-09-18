import { NextResponse } from "next/server";
import { testLlmConnection } from "@/lib/llmEvaluator";

// Deliberately a separate, POST-only, manually-triggered endpoint — this is
// the one check that actually spends a token, so it must never run
// automatically (see /api/system-status for the free checks that do run on
// every dashboard load).
export async function POST() {
  const result = await testLlmConnection();
  return NextResponse.json(result);
}
