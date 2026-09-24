// ONE POSTING IN, ONE STORED EVALUATION OUT.
//
// Shared by "Add a posting" (/api/jobs) and the sample loader (/api/samples), so a posting added
// by hand and one loaded from the class kit go through exactly the same agent, the same memory
// and the same storage. There is one way to evaluate a posting, not two that could drift apart.

import { nanoid } from "nanoid";
import { db, getActiveProfile, loadHarnessOverrides } from "./db";
import { resolveSettings } from "./harnessSettings";
import { runAgent, type EvaluationResult } from "./agent";
import { getModelName } from "./llmEvaluator";
import { jobHash, loadMemory, saveMemory } from "./memory";

export const MAX_POSTING_CHARS = 40000;

export type EvaluateOutcome =
  | { kind: "evaluated"; id: string; evaluation: EvaluationResult }
  | { kind: "duplicate"; id: string };

export async function evaluateAndStore(opts: {
  workspaceId: string;
  title: string;
  rawText: string;
  sourceUrl?: string | null;
}): Promise<EvaluateOutcome> {
  const { workspaceId, title, rawText } = opts;
  const c = db();
  const profile = await getActiveProfile(workspaceId);

  // THE SAME POSTING, FOR THE SAME CANDIDATE, IS THE SAME JOB. Pasting a posting twice used to
  // create a second job with its own fresh evaluation — exactly how two different scores for one
  // posting appeared. The content hash makes the second paste reopen the first job. The candidate
  // is part of the key: the same posting judged for a different profile is a different question,
  // and gets its own evaluation. So is the résumé: after the profile's résumé is replaced (say,
  // with the tailored version the agent drafted) the same posting is a new question too, and must
  // be scored against the new text rather than reopening the old résumé's score.
  const hash = jobHash(rawText);
  const dupe = await c.execute({
    sql: `SELECT j.id FROM jobs j JOIN evaluations e ON e.job_id = j.id
          WHERE j.workspace_id = ? AND j.content_hash = ? AND e.profile_id = ? AND e.resume_snapshot = ? LIMIT 1`,
    args: [workspaceId, hash, profile.id, profile.resumeText],
  });
  if (dupe.rows.length > 0) return { kind: "duplicate", id: dupe.rows[0].id as string };

  const id = nanoid(10);
  await c.execute({
    sql: "INSERT INTO jobs (id, title, raw_text, source_url, workspace_id, content_hash) VALUES (?, ?, ?, ?, ?, ?)",
    args: [id, title, rawText, opts.sourceUrl ?? null, workspaceId, hash],
  });

  // Snapshot which profile (and its exact résumé text) evaluated this job, so that later
  // switching the active profile or editing its résumé can never retroactively change what an
  // already-evaluated job was graded against, or what a later-approved draft is grounded in.
  const settings = resolveSettings(await loadHarnessOverrides(profile.id));
  // What the agent already knows about this posting: the requirement list frozen the first time
  // it was read, and any verdict already reached for this exact résumé (src/lib/memory.ts).
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

  return { kind: "evaluated", id, evaluation: result };
}
