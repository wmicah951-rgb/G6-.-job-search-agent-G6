import { NextRequest, NextResponse } from "next/server";
import { db, ensureSchema } from "@/lib/db";
import { applyClarificationAnswer, type EvaluationResult } from "@/lib/agent";

// Resolves an ASK_USER pause (see detectLocationAmbiguity in agent.ts) — the
// one point where the agent stops mid-evaluation to ask a clarifying question,
// distinct from /api/agent/approve which only ever asks "proceed or not?"
// after a full evaluation is already done.
export async function POST(req: NextRequest) {
  await ensureSchema();
  const body = await req.json();
  const jobId = (body.jobId ?? "").toString();
  const answer = (body.answer ?? "").toString();

  if (!["compatible", "violation"].includes(answer)) {
    return NextResponse.json(
      { error: "answer must be one of: compatible, violation" },
      { status: 400 }
    );
  }

  const c = db();
  const evalRes = await c.execute({
    sql: "SELECT trace_json, state_json FROM evaluations WHERE job_id = ?",
    args: [jobId],
  });

  if (evalRes.rows.length === 0) {
    return NextResponse.json({ error: "Job or evaluation not found." }, { status: 404 });
  }

  const prior: EvaluationResult = {
    state: JSON.parse(evalRes.rows[0].state_json as string),
    trace: JSON.parse(evalRes.rows[0].trace_json as string),
  };

  if (prior.state.stage !== "awaiting_clarification") {
    return NextResponse.json(
      {
        error: `This job is in stage "${prior.state.stage}", not "awaiting_clarification". Nothing to clarify.`,
      },
      { status: 409 }
    );
  }

  const result = applyClarificationAnswer(prior, answer as "compatible" | "violation");

  await c.execute({
    sql: `UPDATE evaluations SET stage = ?, hard_constraint_violations = ?, trace_json = ?,
          state_json = ?, updated_at = datetime('now') WHERE job_id = ?`,
    args: [
      result.state.stage,
      JSON.stringify(result.state.hardConstraintViolations),
      JSON.stringify(result.trace),
      JSON.stringify(result.state),
      jobId,
    ],
  });

  return NextResponse.json({ evaluation: result });
}
