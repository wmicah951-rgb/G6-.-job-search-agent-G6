// One profile. Every query is scoped to the caller's workspace, so a profile id belonging to
// someone else's browser simply does not exist here.

import { NextRequest, NextResponse } from "next/server";
import { db, ensureSchema, setActiveProfile, getActiveProfile } from "@/lib/db";
import { currentWorkspace } from "@/lib/workspace";

const MAX_RESUME_CHARS = 30_000;
const MAX_PREFS_CHARS = 20_000;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await ensureSchema();
  const workspaceId = await currentWorkspace();
  const { id } = await params;
  const c = db();
  const res = await c.execute({
    sql: "SELECT id, name, resume_text, preferences_text, updated_at FROM profiles WHERE id = ? AND workspace_id = ?",
    args: [id, workspaceId],
  });
  if (res.rows.length === 0) {
    return NextResponse.json({ error: "Profile not found." }, { status: 404 });
  }
  const active = await getActiveProfile(workspaceId);
  const row = res.rows[0];
  return NextResponse.json({
    id: row.id,
    name: row.name,
    resumeText: row.resume_text,
    preferencesText: row.preferences_text,
    isActive: row.id === active.id,
    updatedAt: row.updated_at,
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await ensureSchema();
  const workspaceId = await currentWorkspace();
  const { id } = await params;
  const body = await req.json();
  const c = db();

  const existing = await c.execute({
    sql: "SELECT id FROM profiles WHERE id = ? AND workspace_id = ?",
    args: [id, workspaceId],
  });
  if (existing.rows.length === 0) {
    return NextResponse.json({ error: "Profile not found." }, { status: 404 });
  }

  if (body.setActive === true) await setActiveProfile(workspaceId, id);

  if (
    (typeof body.resumeText === "string" && body.resumeText.length > MAX_RESUME_CHARS) ||
    (typeof body.preferencesText === "string" && body.preferencesText.length > MAX_PREFS_CHARS)
  ) {
    return NextResponse.json(
      { error: `Résumé must be under ${MAX_RESUME_CHARS} characters and preferences under ${MAX_PREFS_CHARS}.` },
      { status: 400 }
    );
  }

  const fields: string[] = [];
  const args: string[] = [];
  if (typeof body.name === "string" && body.name.trim()) {
    fields.push("name = ?");
    args.push(body.name.trim());
  }
  if (typeof body.resumeText === "string") {
    fields.push("resume_text = ?");
    args.push(body.resumeText);
  }
  if (typeof body.preferencesText === "string") {
    fields.push("preferences_text = ?");
    args.push(body.preferencesText);
  }
  if (fields.length > 0) {
    fields.push("updated_at = datetime('now')");
    args.push(id, workspaceId);
    await c.execute({
      sql: `UPDATE profiles SET ${fields.join(", ")} WHERE id = ? AND workspace_id = ?`,
      args,
    });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await ensureSchema();
  const workspaceId = await currentWorkspace();
  const { id } = await params;
  const c = db();

  const countRes = await c.execute({
    sql: "SELECT COUNT(*) as n FROM profiles WHERE workspace_id = ?",
    args: [workspaceId],
  });
  if (Number(countRes.rows[0]?.n ?? 0) <= 1) {
    return NextResponse.json(
      { error: "Can't delete the only remaining profile — create another one first." },
      { status: 400 }
    );
  }

  const target = await c.execute({
    sql: "SELECT id FROM profiles WHERE id = ? AND workspace_id = ?",
    args: [id, workspaceId],
  });
  if (target.rows.length === 0) {
    return NextResponse.json({ error: "Profile not found." }, { status: 404 });
  }
  const active = await getActiveProfile(workspaceId);

  await c.execute({ sql: "DELETE FROM profiles WHERE id = ? AND workspace_id = ?", args: [id, workspaceId] });

  if (active.id === id) {
    // Deleting the active profile must leave another one active, so evaluating a job always
    // has a résumé to read.
    const next = await c.execute({
      sql: "SELECT id FROM profiles WHERE workspace_id = ? ORDER BY created_at ASC LIMIT 1",
      args: [workspaceId],
    });
    if (next.rows.length) await setActiveProfile(workspaceId, next.rows[0].id as string);
  }

  return NextResponse.json({ ok: true });
}
