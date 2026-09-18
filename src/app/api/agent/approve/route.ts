import { NextRequest, NextResponse } from "next/server";
import { db, ensureSchema } from "@/lib/db";
import { applyHumanDecision, type EvaluationResult } from "@/lib/agent";

export async function POST(req: NextRequest) {
  await ensureSchema();
  const body = await req.json();
  const jobId = (body.jobId ?? "").toString();
  const decision = (body.decision ?? "").toString();
  const editNote = body.editNote ? body.editNote.toString() : null;

  if (!["approve", "edit", "reject"].includes(decision)) {
    return NextResponse.json(
      { error: "decision must be one of: approve, edit, reject" },
      { status: 400 }
    );
  }

  const c = db();
  const jobRes = await c.execute({
    sql: "SELECT raw_text FROM jobs WHERE id = ?",
    args: [jobId],
  });
  const evalRes = await c.execute({
    sql: "SELECT trace_json, state_json FROM evaluations WHERE job_id = ?",
    args: [jobId],
  });

  if (jobRes.rows.length === 0 || evalRes.rows.length === 0) {
    return NextResponse.json({ error: "Job or evaluation not found." }, { status: 404 });
  }

  const jobText = jobRes.rows[0].raw_text as string;

  const prior: EvaluationResult = {
    state: JSON.parse(evalRes.rows[0].state_json as string),
    trace: JSON.parse(evalRes.rows[0].trace_json as string),
  };

  if (prior.state.stage !== "awaiting_approval") {
    return NextResponse.json(
      {
        error: `This job is in stage "${prior.state.stage}", not "awaiting_approval". Nothing to approve/reject.`,
      },
      { status: 409 }
    );
  }

  // Drafting grounds itself in prior.state.matchedEvidence — the quotes already
  // verified against the resume at evaluation time — not whatever profile
  // happens to be active right now, so switching or editing a profile between
  // evaluation and approval can never change what an already-decided job's
  // draft is grounded in.
  const result = applyHumanDecision(prior, decision as any, editNote, jobText);

  await c.execute({
    sql: `UPDATE evaluations SET stage = ?, approval_note = ?, draft = ?, trace_json = ?,
          state_json = ?, updated_at = datetime('now') WHERE job_id = ?`,
    args: [
      result.state.stage,
      result.state.approvalNote,
      result.state.draft,
      JSON.stringify(result.trace),
      JSON.stringify(result.state),
      jobId,
    ],
  });

  return NextResponse.json({ evaluation: result });
}
