import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { db, ensureSchema } from "@/lib/db";

export async function GET() {
  await ensureSchema();
  const c = db();
  const res = await c.execute(
    "SELECT id, name, is_active, updated_at FROM profiles ORDER BY created_at ASC"
  );
  return NextResponse.json({
    profiles: res.rows.map((r) => ({
      id: r.id,
      name: r.name,
      isActive: !!r.is_active,
      updatedAt: r.updated_at,
    })),
  });
}

export async function POST(req: NextRequest) {
  await ensureSchema();
  const body = await req.json();
  const name = (body.name ?? "").toString().trim();
  const resumeText = (body.resumeText ?? "").toString();
  const preferencesText = (body.preferencesText ?? "").toString();
  const setActive = !!body.setActive;

  if (!name) {
    return NextResponse.json({ error: "A profile name is required." }, { status: 400 });
  }

  const c = db();
  const id = nanoid(10);
  if (setActive) {
    await c.execute("UPDATE profiles SET is_active = 0");
  }
  await c.execute({
    sql: `INSERT INTO profiles (id, name, resume_text, preferences_text, is_active, updated_at)
          VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    args: [id, name, resumeText, preferencesText, setActive ? 1 : 0],
  });
  return NextResponse.json({ id });
}
