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
  // fitMethod/fitReasoning aren't dedicated columns — they live inside the
  // full state_json blob (part of AgentState), read out here for a flattened
  // field the frontend can use directly, same pattern as the other fields.
  const state = evaluation ? JSON.parse(evaluation.state_json as string) : null;

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
          fitMethod: state?.fitMethod ?? "deterministic",
          fitReasoning: state?.fitReasoning ?? null,
          clarificationQuestion: state?.clarificationQuestion ?? null,
          injectionSources: state?.injectionSources ?? [],
          workArrangement: state?.workArrangement ?? "unknown",
          hardConstraintViolations: JSON.parse(
            (evaluation.hard_constraint_violations as string) ?? "[]"
          ),
          injectionDetected: !!evaluation.injection_detected,
          injectionSnippets: JSON.parse((evaluation.injection_snippets as string) ?? "[]"),
          approvalNote: evaluation.approval_note,
          draft: evaluation.draft,
          coverLetter: (evaluation.cover_letter as string) || state?.coverLetter || null,
          tailoredResume: (evaluation.tailored_resume as string) || state?.tailoredResume || null,
          gapNotes: state?.gapNotes ?? [],
          // Nice-to-have gaps, so the UI can label them differently from hard ones.
          missingPreferredSkills: state?.missingPreferredSkills ?? [],
          // "full" vs "partial" (internship/coursework/basics) per matched requirement.
          matchStrength: state?.matchStrength ?? {},
          // Deterministic verification of the generated material (draftVerifier.ts).
          draftVerification: state?.draftVerification ?? null,
          coverLetterVerification: state?.coverLetterVerification ?? null,
          minFit: state?.minFit ?? null,
          rescore: state?.rescore ?? null,
          lowConfidence: state?.lowConfidence ?? false,
          unassessedRequirements: state?.unassessedRequirements ?? [],
          requirementCount: state?.requirementCount ?? null,
          profileName: evaluation.profile_name,
          trace: JSON.parse(evaluation.trace_json as string),
          state,
        }
      : null,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureSchema();
  const { id } = await params;
  const body = await req.json();
  const { coverLetter, tailoredResume, draft } = body;

  const c = db();
  const evalRes = await c.execute({
    sql: "SELECT state_json FROM evaluations WHERE job_id = ?",
    args: [id],
  });
  if (evalRes.rows.length === 0) {
    return NextResponse.json({ error: "Evaluation not found." }, { status: 404 });
  }

  const state = JSON.parse(evalRes.rows[0].state_json as string);
  if (coverLetter !== undefined) state.coverLetter = coverLetter;
  if (tailoredResume !== undefined) state.tailoredResume = tailoredResume;
  if (draft !== undefined) state.draft = draft;

  const updates: string[] = ["state_json = ?", "updated_at = datetime('now')"];
  const args: any[] = [JSON.stringify(state)];

  if (coverLetter !== undefined) {
    updates.push("cover_letter = ?");
    args.push(coverLetter);
  }
  if (tailoredResume !== undefined) {
    updates.push("tailored_resume = ?");
    args.push(tailoredResume);
  }
  if (draft !== undefined) {
    updates.push("draft = ?");
    args.push(draft);
  }

  args.push(id);
  await c.execute({
    sql: `UPDATE evaluations SET ${updates.join(", ")} WHERE job_id = ?`,
    args,
  });

  return NextResponse.json({ success: true, state });
}


// Removes a posting and its evaluation (evaluation first: it references the job).
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureSchema();
  const { id } = await params;
  const c = db();
  const existing = await c.execute({ sql: "SELECT id FROM jobs WHERE id = ?", args: [id] });
  if (existing.rows.length === 0) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }
  await c.execute({ sql: "DELETE FROM evaluations WHERE job_id = ?", args: [id] });
  await c.execute({ sql: "DELETE FROM jobs WHERE id = ?", args: [id] });
  return NextResponse.json({ ok: true });
}
