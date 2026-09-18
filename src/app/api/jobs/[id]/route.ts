import { NextRequest, NextResponse } from "next/server";
import { db, ensureSchema } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureSchema();
  const { id } = await params;
  const c = db();
  const jobRes = await c.execute({
    sql: "SELECT id, title, raw_text, source_url, created_at FROM jobs WHERE id = ?",
    args: [id],
  });
  if (jobRes.rows.length === 0) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }
  const evalRes = await c.execute({
    sql: "SELECT * FROM evaluations WHERE job_id = ?",
    args: [id],
  });

  const job = jobRes.rows[0];
  const evaluation = evalRes.rows[0] ?? null;

  return NextResponse.json({
    job: {
      id: job.id,
      title: job.title,
      rawText: job.raw_text,
      sourceUrl: job.source_url,
      createdAt: job.created_at,
    },
    evaluation: evaluation
      ? {
          stage: evaluation.stage,
          fitScore: evaluation.fit_score,
          matchedSkills: JSON.parse((evaluation.matched_skills as string) ?? "[]"),
          missingSkills: JSON.parse((evaluation.missing_skills as string) ?? "[]"),
          fitRationale: JSON.parse((evaluation.fit_rationale as string) ?? "[]"),
          hardConstraintViolations: JSON.parse(
            (evaluation.hard_constraint_violations as string) ?? "[]"
          ),
          injectionDetected: !!evaluation.injection_detected,
          injectionSnippets: JSON.parse((evaluation.injection_snippets as string) ?? "[]"),
          approvalNote: evaluation.approval_note,
          draft: evaluation.draft,
          profileName: evaluation.profile_name,
          trace: JSON.parse(evaluation.trace_json as string),
          state: JSON.parse(evaluation.state_json as string),
        }
      : null,
  });
}
