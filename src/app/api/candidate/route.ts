import { NextRequest, NextResponse } from "next/server";
import { currentWorkspace } from "@/lib/workspace";
import { db, ensureSchema, getActiveProfile } from "@/lib/db";

// Convenience endpoint: always reads/writes whichever profile is currently
// active. For managing multiple named profiles (create/switch/delete), see
// /api/profiles.
export async function GET() {
  await ensureSchema();
  const active = await getActiveProfile(await currentWorkspace());
  return NextResponse.json({
    profileId: active.id,
    profileName: active.name,
    resumeText: active.resumeText,
    preferencesText: active.preferencesText,
  });
}

export async function POST(req: NextRequest) {
  await ensureSchema();
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  const resumeText = (body.resumeText ?? "").toString();
  const preferencesText = (body.preferencesText ?? "").toString();
  if (!resumeText.trim() || !preferencesText.trim()) {
    return NextResponse.json(
      { error: "resumeText and preferencesText are both required." },
      { status: 400 }
    );
  }
  const active = await getActiveProfile(await currentWorkspace());
  const c = db();
  await c.execute({
    sql: `UPDATE profiles SET resume_text = ?, preferences_text = ?, updated_at = datetime('now') WHERE id = ?`,
    args: [resumeText, preferencesText, active.id],
  });
  return NextResponse.json({ ok: true });
}
