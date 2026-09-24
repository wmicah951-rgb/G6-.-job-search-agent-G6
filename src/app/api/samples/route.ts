// Ready-made candidates and postings for anyone using the live site (see src/lib/samples.ts).
//
//   GET                                       -> the catalogue
//   POST { action: "profile",  key }          -> adds that candidate to this browser and makes it active
//   POST { action: "postings", set, index? }  -> runs posting number `index` of the set through the
//                                                agent for this browser's active profile, or the
//                                                whole set when no index is given
//
// The page sends one posting per request. A whole set is six agent runs — about 100 seconds —
// which can exceed a serverless function's time limit; one posting is about 15.
//
// Loading postings runs the real agent on each one — the same path as "Add a posting" — so the
// board that results is genuine agent output, ranked, with traces, not canned data.

import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { db, ensureSchema, setActiveProfile } from "@/lib/db";
import { currentWorkspace } from "@/lib/workspace";
import { evaluateAndStore } from "@/lib/evaluateJob";
import { SAMPLE_POSTING_SETS, SAMPLE_PROFILES, samplePostings, sampleProfileText, sampleProfilesWithText } from "@/lib/samples";

// The page sends one posting per request (about 15 seconds); a whole set in one call needs more.
export const maxDuration = 300;

export async function GET() {
  // Full résumé and preferences text for each candidate (all fictional), so the Live Demo can
  // show exactly what a posting is being judged against.
  return NextResponse.json({
    profiles: sampleProfilesWithText(),
    postingSets: SAMPLE_POSTING_SETS.map((s) => ({ ...s, count: samplePostings(s.key).length })),
  });
}

export async function POST(req: NextRequest) {
  await ensureSchema();
  const workspaceId = await currentWorkspace();
  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "");

  if (action === "profile") {
    const key = String(body.key ?? "");
    const sample = SAMPLE_PROFILES.find((s) => s.key === key);
    const text = sample ? sampleProfileText(key) : null;
    if (!sample || !text) return NextResponse.json({ error: "Unknown sample profile." }, { status: 400 });

    const c = db();
    // Loading the same sample twice switches back to it rather than making a copy.
    const existing = await c.execute({
      sql: "SELECT id FROM profiles WHERE workspace_id = ? AND name = ? LIMIT 1",
      args: [workspaceId, sample.name],
    });
    let id = existing.rows[0]?.id as string | undefined;
    if (!id) {
      id = nanoid(10);
      await c.execute({
        sql: `INSERT INTO profiles (id, name, resume_text, preferences_text, is_active, workspace_id, updated_at)
              VALUES (?, ?, ?, ?, 0, ?, datetime('now'))`,
        args: [id, sample.name, text.resumeText, text.preferencesText, workspaceId],
      });
    }
    await setActiveProfile(workspaceId, id);
    return NextResponse.json({ id, name: sample.name, postingSet: sample.postingSet, reused: !!existing.rows[0] });
  }

  if (action === "postings") {
    const set = String(body.set ?? "");
    const all = samplePostings(set);
    if (all.length === 0) return NextResponse.json({ error: "Unknown posting set." }, { status: 400 });
    const index = body.index === undefined ? null : Number(body.index);
    if (index !== null && !(Number.isInteger(index) && index >= 0 && index < all.length)) {
      return NextResponse.json({ error: `index must be 0-${all.length - 1}.` }, { status: 400 });
    }
    const postings = index === null ? all : [all[index]];

    const results: { title: string; id: string; stage?: string; fitScore?: number | null; duplicate?: boolean; error?: string }[] = [];
    for (const p of postings) {
      try {
        const outcome = await evaluateAndStore({ workspaceId, title: p.title, rawText: p.rawText });
        results.push(
          outcome.kind === "duplicate"
            ? { title: p.title, id: outcome.id, duplicate: true }
            : {
                title: p.title,
                id: outcome.id,
                stage: outcome.evaluation.state.stage,
                fitScore: outcome.evaluation.state.fitScore,
              }
        );
      } catch (err) {
        results.push({ title: p.title, id: "", error: String(err).slice(0, 160) });
      }
    }
    return NextResponse.json({ set, total: all.length, results });
  }

  return NextResponse.json({ error: "action must be 'profile' or 'postings'." }, { status: 400 });
}
