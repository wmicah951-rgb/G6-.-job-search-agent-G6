import { createClient, type Client } from "@libsql/client";
import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";

// In production (Vercel), set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN env vars
// and this connects to your real Turso database. Locally, with no env vars set,
// it falls back to a file-based libSQL db (file:local.db) so the whole app runs
// and can be QA'd without a Turso account.
let client: Client | null = null;

export function db(): Client {
  if (client) return client;
  const url = process.env.TURSO_DATABASE_URL ?? "file:local.db";
  const authToken = process.env.TURSO_AUTH_TOKEN;
  client = createClient(
    authToken ? { url, authToken } : { url }
  );
  return client;
}

export async function ensureSchema() {
  const c = db();
  await c.executeMultiple(`
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      resume_text TEXT NOT NULL,
      preferences_text TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      raw_text TEXT NOT NULL,
      source_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS evaluations (
      job_id TEXT PRIMARY KEY,
      stage TEXT NOT NULL,
      fit_score REAL,
      matched_skills TEXT,
      missing_skills TEXT,
      fit_rationale TEXT,
      hard_constraint_violations TEXT,
      injection_detected INTEGER NOT NULL DEFAULT 0,
      injection_snippets TEXT,
      approval_note TEXT,
      draft TEXT,
      profile_id TEXT,
      profile_name TEXT,
      resume_snapshot TEXT,
      trace_json TEXT NOT NULL,
      state_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (job_id) REFERENCES jobs(id)
    );
  `);
  await ensureDefaultProfile(c);
}

// Seeds exactly one profile ("Profile 1") from the starter-kit resume.md /
// preferences.md files the first time the app runs against an empty database,
// so there's always an active profile to evaluate jobs against. Every profile
// created after this one is created explicitly by the user from the Resume &
// Preferences screen.
async function ensureDefaultProfile(c: Client) {
  const res = await c.execute("SELECT COUNT(*) as n FROM profiles");
  const count = Number(res.rows[0]?.n ?? 0);
  if (count > 0) return;

  const resumeText = fs.readFileSync(path.join(process.cwd(), "src/data/resume.md"), "utf-8");
  const preferencesText = fs.readFileSync(
    path.join(process.cwd(), "src/data/preferences.md"),
    "utf-8"
  );
  await c.execute({
    sql: `INSERT INTO profiles (id, name, resume_text, preferences_text, is_active)
          VALUES (?, ?, ?, ?, 1)`,
    args: [nanoid(10), "Profile 1", resumeText, preferencesText],
  });
}

export function isTursoConfigured(): boolean {
  return !!process.env.TURSO_DATABASE_URL;
}

// A cheap (SELECT 1) live check — unlike the LLM connection test, this has no
// meaningful cost, so the system-status panel can safely run it on every load.
export async function testDbConnection(): Promise<{ ok: boolean; message: string }> {
  try {
    await db().execute("SELECT 1");
    return {
      ok: true,
      message: isTursoConfigured() ? "Connected to Turso." : "Using local file DB (local.db).",
    };
  } catch (err) {
    return { ok: false, message: String(err).slice(0, 200) };
  }
}

export async function getActiveProfile(): Promise<{
  id: string;
  name: string;
  resumeText: string;
  preferencesText: string;
}> {
  const c = db();
  const res = await c.execute("SELECT id, name, resume_text, preferences_text FROM profiles WHERE is_active = 1 LIMIT 1");
  if (res.rows.length === 0) {
    // Should not happen after ensureDefaultProfile(), but fall back to the
    // starter-kit files rather than crash if the profiles table is empty.
    return {
      id: "fallback",
      name: "Default",
      resumeText: fs.readFileSync(path.join(process.cwd(), "src/data/resume.md"), "utf-8"),
      preferencesText: fs.readFileSync(
        path.join(process.cwd(), "src/data/preferences.md"),
        "utf-8"
      ),
    };
  }
  const row = res.rows[0];
  return {
    id: row.id as string,
    name: row.name as string,
    resumeText: row.resume_text as string,
    preferencesText: row.preferences_text as string,
  };
}
