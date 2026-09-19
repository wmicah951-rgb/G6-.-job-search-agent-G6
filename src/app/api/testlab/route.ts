import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { runAgent } from "@/lib/agent";
import { getActiveProfile, ensureSchema, loadHarnessOverrides } from "@/lib/db";
import { resolveSettings } from "@/lib/harnessSettings";
import { isLlmConfigured, getModelName } from "@/lib/llmEvaluator";
import { TEST_CASES } from "@/lib/testCases";

// Runs a built-in test posting through the real agent and reports expected vs actual.
//
// Deliberately does NOT save anything: the Test Lab is for proving behaviour, not for
// filling the job board with fixtures. Use the "Load onto board" action on the
// dashboard (scripts/seed-clickthrough.mjs) when you want to click through them.

function jobsDir() {
  return path.join(process.cwd(), "src", "data", "jobs");
}

export async function GET() {
  return NextResponse.json({
    cases: TEST_CASES,
    llmConfigured: isLlmConfigured(),
    model: getModelName(),
  });
}

export async function POST(req: NextRequest) {
  await ensureSchema();
  const body = await req.json();
  const ids: string[] = Array.isArray(body.ids) ? body.ids : [body.id];

  const profile = await getActiveProfile();
  // Test Lab runs under the SAME harness settings the app uses, so editing a prompt
  // and re-running here actually proves whether the gates still behave.
  const settings = resolveSettings(await loadHarnessOverrides(profile.id));
  const results = [];

  for (const id of ids) {
    const c = TEST_CASES.find((t) => t.id === id);
    if (!c) {
      results.push({ id, error: "Unknown test case." });
      continue;
    }
    if (c.requires === "llm" && !isLlmConfigured()) {
      results.push({
        id,
        skipped: true,
        note: "Needs a configured model. The keyword floor genuinely cannot detect this — that is why it is a floor, not the whole defence.",
      });
      continue;
    }

    let jobText: string;
    try {
      jobText = fs.readFileSync(path.join(jobsDir(), `${id}.md`), "utf-8");
    } catch {
      results.push({ id, error: `Fixture ${id}.md not found on the server.` });
      continue;
    }

    const started = Date.now();
    try {
      const r = await runAgent(`testlab-${id}`, jobText, profile.resumeText, profile.preferencesText, settings);
      const sequence = r.trace.map((t) => t.selectedAction).join(">");
      const problems: string[] = [];
      if (sequence !== c.sequence) problems.push(`sequence was ${sequence}`);
      if (r.state.injectionDetected !== c.injection) {
        problems.push(
          c.injection
            ? "injection was NOT detected (expected it to be)"
            : "injection WAS detected (this posting is innocent)"
        );
      }
      if (c.arrangement && r.state.workArrangement !== c.arrangement) {
        problems.push(`read the work arrangement as ${r.state.workArrangement}`);
      }
      results.push({
        id,
        pass: problems.length === 0,
        problems,
        ms: Date.now() - started,
        actual: {
          stage: r.state.stage,
          sequence,
          fitScore: r.state.fitScore,
          injectionDetected: r.state.injectionDetected,
          injectionSources: r.state.injectionSources,
          injectionSnippets: r.state.injectionSnippets.slice(0, 3),
          workArrangement: r.state.workArrangement,
          matchedSkills: r.state.matchedSkills,
          missingSkills: r.state.missingSkills,
          matchStrength: r.state.matchStrength ?? {},
          fitReasoning: r.state.fitReasoning,
        },
      });
    } catch (err) {
      results.push({ id, error: String(err).slice(0, 300) });
    }
  }

  return NextResponse.json({
    results,
    profileName: profile.name,
    model: getModelName(),
    llmConfigured: isLlmConfigured(),
  });
}
