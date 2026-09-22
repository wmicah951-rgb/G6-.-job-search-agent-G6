import { NextRequest, NextResponse } from "next/server";
import { currentWorkspace } from "@/lib/workspace";
import { nanoid } from "nanoid";
import { db, ensureSchema, getActiveProfile, loadHarnessOverrides } from "@/lib/db";
import { resolveSettings } from "@/lib/harnessSettings";
import { runAgent } from "@/lib/agent";
import { getModelName } from "@/lib/llmEvaluator";
import { jobHash, loadMemory, saveMemory } from "@/lib/memory";

// An agent run makes several model calls (read the posting, score the fit, choose the action,
// advise the human). On a cold serverless function that can pass the platform default.
export const maxDuration = 60;

const MAX_POSTING_CHARS = 40000;

export async function GET() {
  await ensureSchema();
  const workspaceId = await currentWorkspace();
  const c = db();
  // Only this browser's postings (see src/lib/workspace.ts).
  const res = await c.execute({
    sql: `
      SELECT j.id, j.title, j.source_url, j.created_at,
             e.stage, e.fit_score, e.injection_detected, e.profile_name
      FROM jobs j
      LEFT JOIN evaluations e ON e.job_id = j.id
      WHERE j.workspace_id = ?
      ORDER BY j.created_at DESC
    `,
    args: [workspaceId],
  });
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

  if (rawText.length > MAX_POSTING_CHARS) {
    return NextResponse.json(
      {
        error: `Posting is ${rawText.length} characters; the limit is ${MAX_POSTING_CHARS}. Paste the role description rather than the whole page.`,
      },
      { status: 400 }
    );
  }

  const workspaceId = await currentWorkspace();
  const c = db();

  // THE SAME POSTING IS THE SAME JOB. Pasting a posting twice used to create a second job with
  // its own fresh evaluation — exactly how two different scores for one posting appeared. The
  // content hash makes the second paste reopen the first job instead.
  const hash = jobHash(rawText);
  const dupe = await c.execute({
    sql: "SELECT id FROM jobs WHERE workspace_id = ? AND content_hash = ? LIMIT 1",
    args: [workspaceId, hash],
  });
  if (dupe.rows.length > 0) {
    return NextResponse.json({ id: dupe.rows[0].id, duplicateOf: dupe.rows[0].id });
  }

  const id = nanoid(10);
  await c.execute({
    sql: "INSERT INTO jobs (id, title, raw_text, source_url, workspace_id, content_hash) VALUES (?, ?, ?, ?, ?, ?)",
    args: [id, title, rawText, sourceUrl, workspaceId, hash],
  });

  // Snapshot which profile (and its exact resume text) evaluated this job, so
  // that later switching the active profile or editing its resume can never
  // retroactively change what an already-evaluated job was actually graded
  // against, or what a later-approved draft is grounded in.
  const profile = await getActiveProfile(workspaceId);
  const settings = resolveSettings(await loadHarnessOverrides(profile.id));
  // What the agent already knows about this posting: the requirement list frozen the first
  // time it was read, and any verdict already reached for this exact résumé. See
  // src/lib/memory.ts — this is what stops the score drifting between runs.
  const memory = await loadMemory({
    jobText: rawText,
    resumeText: profile.resumeText,
    settings,
    model: getModelName(),
  });
  const result = await runAgent(id, rawText, profile.resumeText, profile.preferencesText, settings, memory);
  await saveMemory({
    jobText: rawText,
    resumeText: profile.resumeText,
    settings,
    model: getModelName(),
    fit: result.fit,
    score: result.state.fitScore,
    stage: result.state.stage,
    workspaceId,
    profileId: profile.id,
    profileName: profile.name,
  });

  await c.execute({
    sql: `INSERT INTO evaluations
      (job_id, stage, fit_score, matched_skills, missing_skills, fit_rationale,
       hard_constraint_violations, injection_detected, injection_snippets, approval_note,
       draft, profile_id, profile_name, resume_snapshot, trace_json, state_json, workspace_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
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
      workspaceId,
    ],
  });

  return NextResponse.json({ id, evaluation: result });
}
