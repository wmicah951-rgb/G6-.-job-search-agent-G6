import { NextRequest, NextResponse } from "next/server";
import { db, ensureSchema } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await ensureSchema();
  const { id } = await params;
  const c = db();
  const res = await c.execute({
    sql: "SELECT id, name, resume_text, preferences_text, is_active, updated_at FROM profiles WHERE id = ?",
    args: [id],
  });
  if (res.rows.length === 0) {
    return NextResponse.json({ error: "Profile not found." }, { status: 404 });
  }
  const row = res.rows[0];
  return NextResponse.json({
    id: row.id,
    name: row.name,
    resumeText: row.resume_text,
    preferencesText: row.preferences_text,
    isActive: !!row.is_active,
    updatedAt: row.updated_at,
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await ensureSchema();
  const { id } = await params;
  const body = await req.json();
  const c = db();

  const existing = await c.execute({ sql: "SELECT id FROM profiles WHERE id = ?", args: [id] });
  if (existing.rows.length === 0) {
    return NextResponse.json({ error: "Profile not found." }, { status: 404 });
  }

  if (body.setActive === true) {
    await c.execute("UPDATE profiles SET is_active = 0");
    await c.execute({ sql: "UPDATE profiles SET is_active = 1, updated_at = datetime('now') WHERE id = ?", args: [id] });
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
    args.push(id);
    await c.execute({ sql: `UPDATE profiles SET ${fields.join(", ")} WHERE id = ?`, args });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await ensureSchema();
  const { id } = await params;
  const c = db();

  const countRes = await c.execute("SELECT COUNT(*) as n FROM profiles");
  if (Number(countRes.rows[0]?.n ?? 0) <= 1) {
    return NextResponse.json(
      { error: "Can't delete the only remaining profile — create another one first." },
      { status: 400 }
    );
  }

  const target = await c.execute({ sql: "SELECT is_active FROM profiles WHERE id = ?", args: [id] });
  if (target.rows.length === 0) {
    return NextResponse.json({ error: "Profile not found." }, { status: 404 });
  }
  const wasActive = !!target.rows[0].is_active;

  await c.execute({ sql: "DELETE FROM profiles WHERE id = ?", args: [id] });

  if (wasActive) {
    // Deleting the active profile must leave some other profile active, so job
    // evaluation always has one to read from.
    await c.execute("UPDATE profiles SET is_active = 1 WHERE id = (SELECT id FROM profiles ORDER BY created_at ASC LIMIT 1)");
  }

  return NextResponse.json({ ok: true });
}
