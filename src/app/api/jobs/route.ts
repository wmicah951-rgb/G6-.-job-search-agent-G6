import { NextRequest, NextResponse } from "next/server";
import { currentWorkspace } from "@/lib/workspace";
import { db, ensureSchema } from "@/lib/db";
import { evaluateAndStore, MAX_POSTING_CHARS } from "@/lib/evaluateJob";

// An agent run makes several model calls (read the posting, score the fit, choose the action,
// advise the human). On a cold serverless function that can pass the platform default.
export const maxDuration = 60;


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
  // One shared path for every posting, added by hand or loaded from a sample set.
  const outcome = await evaluateAndStore({ workspaceId, title, rawText, sourceUrl });
  if (outcome.kind === "duplicate") {
    return NextResponse.json({ id: outcome.id, duplicateOf: outcome.id });
  }
  return NextResponse.json({ id: outcome.id, evaluation: outcome.evaluation });
}
