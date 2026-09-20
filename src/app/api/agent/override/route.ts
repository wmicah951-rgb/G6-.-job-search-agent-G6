import { NextRequest, NextResponse } from "next/server";
import { db, ensureSchema, getActiveProfile, loadHarnessOverrides } from "@/lib/db";
import { resolveSettings } from "@/lib/harnessSettings";
import { applyLowFitOverride, type EvaluationResult } from "@/lib/agent";

// The human overrules the agent's own low-fit auto-rejection ("Apply anyway").
//
// This does NOT weaken the agent: runAgent still auto-rejects every below-threshold
// posting on its own, which is one of the four required action sequences. This route is
// a separate human action taken afterwards, and it is recorded as its own trace step so
// the decision is attributable to the person, never to the agent.
//
// Guarded to stage "rejected_low_fit" only — a hard-constraint rejection (years,
// clearance, on-site) is NOT overridable here, because those are the candidate's own
// stated non-negotiables rather than a heuristic score.
export async function POST(req: NextRequest) {
  await ensureSchema();
  const body = await req.json();
  const jobId = (body.jobId ?? "").toString();
  const reason = body.reason ? body.reason.toString() : null;

  const c = db();
  const evalRes = await c.execute({
    sql: "SELECT trace_json, state_json, resume_snapshot FROM evaluations WHERE job_id = ?",
    args: [jobId],
  });

  if (evalRes.rows.length === 0) {
    return NextResponse.json({ error: "Job or evaluation not found." }, { status: 404 });
  }

  const prior: EvaluationResult = {
    state: JSON.parse(evalRes.rows[0].state_json as string),
    trace: JSON.parse(evalRes.rows[0].trace_json as string),
  };

  if (prior.state.stage !== "rejected_low_fit") {
    return NextResponse.json(
      {
        error:
          `This job is in stage "${prior.state.stage}", not "rejected_low_fit". ` +
          `Only an automatic LOW-FIT rejection can be overridden — hard-constraint ` +
          `rejections (years, clearance, on-site) stand, because those are your own ` +
          `stated non-negotiables.`,
      },
      { status: 409 }
    );
  }

  const jobRes = await c.execute({ sql: "SELECT raw_text FROM jobs WHERE id = ?", args: [jobId] });
  const activeProfile = await getActiveProfile();
  const settings = resolveSettings(await loadHarnessOverrides(activeProfile.id));
  const result = await applyLowFitOverride(prior, reason, {
    resumeText: (evalRes.rows[0].resume_snapshot as string) || null,
    jobText: (jobRes.rows[0]?.raw_text as string) ?? "",
    settings,
  });

  await c.execute({
    sql: `UPDATE evaluations SET stage = ?, approval_note = ?, trace_json = ?,
          state_json = ?, updated_at = datetime('now') WHERE job_id = ?`,
    args: [
      result.state.stage,
      result.state.approvalNote,
      JSON.stringify(result.trace),
      JSON.stringify(result.state),
      jobId,
    ],
  });

  return NextResponse.json({ evaluation: result });
}
