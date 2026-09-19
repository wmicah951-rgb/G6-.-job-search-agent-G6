import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { db, ensureSchema, getActiveProfile, loadHarnessOverrides } from "@/lib/db";
import { resolveSettings } from "@/lib/harnessSettings";
import { runAgent } from "@/lib/agent";

export async function GET() {
  await ensureSchema();
  const c = db();
  const res = await c.execute(`
    SELECT j.id, j.title, j.source_url, j.created_at,
           e.stage, e.fit_score, e.injection_detected, e.profile_name
    FROM jobs j
    LEFT JOIN evaluations e ON e.job_id = j.id
    ORDER BY j.created_at DESC
  `);
  return NextResponse.json({ jobs: res.rows });
}

export async function POST(req: NextRequest) {
  await ensureSchema();
  const body = await req.json();
  const title = (body.title ?? "Untitled posting").toString();
  const rawText = (body.rawText ?? "").toString();
  const sourceUrl = body.sourceUrl ? body.sourceUrl.toString() : null;

  if (!rawText.trim()) {
    return NextResponse.json({ error: "rawText is required." }, { status: 400 });
  }

  const id = nanoid(10);
  const c = db();
  await c.execute({
    sql: "INSERT INTO jobs (id, title, raw_text, source_url) VALUES (?, ?, ?, ?)",
    args: [id, title, rawText, sourceUrl],
  });

  // Snapshot which profile (and its exact resume text) evaluated this job, so
  // that later switching the active profile or editing its resume can never
  // retroactively change what an already-evaluated job was actually graded
  // against, or what a later-approved draft is grounded in.
  const profile = await getActiveProfile();
  const settings = resolveSettings(await loadHarnessOverrides(profile.id));
  const result = await runAgent(id, rawText, profile.resumeText, profile.preferencesText, settings);

  await c.execute({
    sql: `INSERT INTO evaluations
      (job_id, stage, fit_score, matched_skills, missing_skills, fit_rationale,
       hard_constraint_violations, injection_detected, injection_snippets, approval_note,
       draft, profile_id, profile_name, resume_snapshot, trace_json, state_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    args: [
      id,
      result.state.stage,
      result.state.fitScore,
      JSON.stringify(result.state.matchedSkills),
      JSON.stringify(result.state.missingSkills),
      JSON.stringify(result.state.fitRationale),
      JSON.stringify(result.state.hardConstraintViolations),
      result.state.injectionDetected ? 1 : 0,
      JSON.stringify(result.state.injectionSnippets),
      result.state.approvalNote,
      result.state.draft,
      profile.id,
      profile.name,
      profile.resumeText,
      JSON.stringify(result.trace),
      JSON.stringify(result.state),
    ],
  });

  return NextResponse.json({ id, evaluation: result });
}
