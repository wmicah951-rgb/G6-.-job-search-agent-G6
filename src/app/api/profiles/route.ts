// The candidate profiles this browser owns — its "accounts".
//
// Every profile belongs to a workspace (src/lib/workspace.ts), so two people using the public
// site at the same time each keep their own résumés, and which one is ACTIVE is per browser
// too. Before this, "active" was a single global flag shared by every visitor.

import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { db, ensureSchema, setActiveProfile, getActiveProfile } from "@/lib/db";
import { currentWorkspace } from "@/lib/workspace";
import { SAMPLE_PROFILES } from "@/lib/samples";

const MAX_RESUME_CHARS = 30_000;
const MAX_PREFS_CHARS = 20_000;

export async function GET() {
  await ensureSchema();
  const workspaceId = await currentWorkspace();
  // Seeds the class-kit profile on a first visit, and tells us which one is active.
  const active = await getActiveProfile(workspaceId);
  const c = db();
  const res = await c.execute({
    sql: "SELECT id, name, updated_at FROM profiles WHERE workspace_id = ? ORDER BY created_at ASC",
    args: [workspaceId],
  });
  return NextResponse.json({
    profiles: res.rows.map((r) => ({
      id: r.id,
      name: r.name,
      isActive: r.id === active.id,
      updatedAt: r.updated_at,
    })),
  });
}

export async function POST(req: NextRequest) {
  await ensureSchema();
  const workspaceId = await currentWorkspace();
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  const name = (body.name ?? "").toString().trim();
  const resumeText = (body.resumeText ?? "").toString();
  const preferencesText = (body.preferencesText ?? "").toString();
  const setActive = body.setActive !== false;

  if (!name) {
    return NextResponse.json({ error: "A profile name is required." }, { status: 400 });
  }
  // A new profile cannot take a sample candidate's exact name: that name is how a sample is
  // recognised (and protected), so a personal résumé under it would be mistaken for the sample.
  if (SAMPLE_PROFILES.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
    return NextResponse.json(
      { error: `"${name}" is the name of a sample candidate. Choose a different name for your own profile.` },
      { status: 400 }
    );
  }
  if (resumeText.length > MAX_RESUME_CHARS || preferencesText.length > MAX_PREFS_CHARS) {
    return NextResponse.json(
      { error: `Résumé must be under ${MAX_RESUME_CHARS} characters and preferences under ${MAX_PREFS_CHARS}.` },
      { status: 400 }
    );
  }

  const c = db();
  const id = nanoid(10);
  await c.execute({
    sql: `INSERT INTO profiles (id, name, resume_text, preferences_text, is_active, workspace_id, updated_at)
          VALUES (?, ?, ?, ?, 0, ?, datetime('now'))`,
    args: [id, name, resumeText, preferencesText, workspaceId],
  });
  if (setActive) await setActiveProfile(workspaceId, id);
  return NextResponse.json({ id });
}
