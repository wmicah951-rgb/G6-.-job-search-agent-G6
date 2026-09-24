import { NextRequest, NextResponse } from "next/server";
import { currentWorkspace } from "@/lib/workspace";
import { db, ensureSchema, getActiveProfile, loadHarnessOverrides } from "@/lib/db";
import { resolveSettings } from "@/lib/harnessSettings";
import { applyHumanDecision, type EvaluationResult } from "@/lib/agent";

// Human-in-the-loop steps re-enter the agent (drafting, verifying, re-scoring): several model
// calls, so allow more than the platform default.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  await ensureSchema();
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  const jobId = (body.jobId ?? "").toString();
  const decision = (body.decision ?? "").toString();
  const editNote = body.editNote ? body.editNote.toString() : null;

  if (!["approve", "edit", "reject"].includes(decision)) {
    return NextResponse.json(
      { error: "decision must be one of: approve, edit, reject" },
      { status: 400 }
    );
  }

  const workspaceId = await currentWorkspace();
  const c = db();
  // Scoped to this browser's workspace: a job id from someone else's workspace is a 404 here.
  const jobRes = await c.execute({
    sql: "SELECT raw_text FROM jobs WHERE id = ? AND (workspace_id = ? OR workspace_id IS NULL)",
    args: [jobId, workspaceId],
  });
  const evalRes = await c.execute({
    sql: "SELECT trace_json, state_json, resume_snapshot FROM evaluations WHERE job_id = ?",
    args: [jobId],
  });

  if (jobRes.rows.length === 0 || evalRes.rows.length === 0) {
    return NextResponse.json({ error: "Job or evaluation not found." }, { status: 404 });
  }

  const jobText = jobRes.rows[0].raw_text as string;
  // The resume snapshot from evaluation time — used for LLM drafting so the
  // draft is grounded in the exact resume that was evaluated, not whatever
  // profile happens to be active now (which may have changed since).
  const resumeText = (evalRes.rows[0].resume_snapshot as string) || null;

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

  const activeProfile = await getActiveProfile(workspaceId);
  const settings = resolveSettings(await loadHarnessOverrides(activeProfile.id));
  const result = await applyHumanDecision(prior, decision as any, editNote, jobText, resumeText, settings);

  await c.execute({
    sql: `UPDATE evaluations SET stage = ?, approval_note = ?, draft = ?,
          cover_letter = ?, tailored_resume = ?,
          trace_json = ?, state_json = ?, updated_at = datetime('now') WHERE job_id = ?`,
    args: [
      result.state.stage,
      result.state.approvalNote,
      result.state.draft,
      result.state.coverLetter,
      result.state.tailoredResume,
      JSON.stringify(result.trace),
      JSON.stringify(result.state),
      jobId,
    ],
  });

  return NextResponse.json({ evaluation: result });
}

