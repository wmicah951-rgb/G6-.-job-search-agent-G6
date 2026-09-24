import { createClient } from "@libsql/client";
import { isPostgresConfigured, postgresClient, type SqlClient } from "./pgClient";
import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";

// In production (Vercel), set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN env vars
// and this connects to your real Turso database. Locally, with no env vars set,
// it falls back to a file-based libSQL db (file:local.db) so the whole app runs
// and can be QA'd without a Turso account.
let client: SqlClient | null = null;

// DB_PROVIDER=turso forces Turso even when a Postgres URL is also configured (Vercel still holds
// the Supabase one). G6_TURSO_URL / G6_TURSO_TOKEN come first so the current Turso database wins
// over any older TURSO_* values left in the Vercel dashboard.
// Values pasted into a dashboard often carry stray spaces or quotes; strip them.
const env = (name: string) => (process.env[name] ?? "").trim().replace(/^["']|["']$/g, "").trim();
// Setting G6_TURSO_URL alone is enough to choose Turso.
const forceTurso = () => env("DB_PROVIDER").toLowerCase() === "turso" || !!env("G6_TURSO_URL");
const usePostgres = () => !forceTurso() && isPostgresConfigured();
const tursoUrl = () => env("G6_TURSO_URL") || env("TURSO_DATABASE_URL");
const tursoToken = () => (env("G6_TURSO_URL") ? env("G6_TURSO_TOKEN") : env("TURSO_AUTH_TOKEN")) || undefined;

// TEMPORARY-STORAGE MODE. A hosted database can refuse to serve: a Turso free plan that has hit
// its limit returns BLOCKED for every statement, reads included. Before this, that turned the
// whole site into a 500 — the agent itself was fine, but nobody could reach it. Now the first
// failure swaps in an in-memory libSQL database (same client, same SQL, no refactor) so the app
// keeps working: postings are evaluated, the Test Lab runs, drafts are produced. What is lost is
// persistence — this database lives inside one server instance and disappears with it — so the
// UI must say so plainly rather than let anyone believe their work is saved.
let degraded = false;
let degradedReason = "";

export function isDegraded(): boolean {
  return degraded;
}
export function degradedMessage(): string {
  return degradedReason;
}

export function db(): SqlClient {
  if (client) return client;
  // Postgres (Supabase) when a connection string is configured; otherwise libSQL — Turso in
  // production, or a local file for development. Both are reached through the same small
  // interface (src/lib/pgClient.ts), so nothing else in the app knows the difference.
  if (usePostgres()) {
    client = postgresClient();
    return client;
  }
  const url = tursoUrl() || "file:local.db";
  const authToken = tursoToken();
  client = createClient(
    authToken ? { url, authToken } : { url }
  );
  return client;
}

/** Swap to in-memory storage after the real database refused to serve. */
function fallBackToMemory(err: unknown) {
  if (degraded) return;
  degraded = true;
  degradedReason = String(err).slice(0, 200);
  client = createClient({ url: ":memory:" });
  console.error(
    `[db] The configured database refused the request (${degradedReason}). ` +
      `Falling back to TEMPORARY in-memory storage: the app keeps working, but nothing is saved.`
  );
}

export async function ensureSchema() {
  try {
    await ensureSchemaOn(db());
  } catch (err) {
    // Blocked plan, bad token, network: keep the app alive on temporary storage.
    fallBackToMemory(err);
    await ensureSchemaOn(db());
  }
}

async function ensureSchemaOn(c: SqlClient) {
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

  // Per-profile harness overrides. Sparse on purpose: a row exists ONLY for a setting
  // the user has actually changed, so the shipped defaults stay the single source of
  // truth and "Reset" is a DELETE rather than a copy of the defaults.
  await c.executeMultiple(`
    CREATE TABLE IF NOT EXISTS harness_settings (
      profile_id TEXT NOT NULL,
      key        TEXT NOT NULL,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (profile_id, key)
    );
  `);

  // Which profile each browser (workspace) is currently working as. This used to be one
  // global profiles.is_active flag, which meant one visitor switching résumé changed what
  // every other visitor's runs were scored against. See src/lib/workspace.ts.
  await c.executeMultiple(`
    CREATE TABLE IF NOT EXISTS workspace_state (
      workspace_id      TEXT PRIMARY KEY,
      active_profile_id TEXT,
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Migrations — ALTER TABLE is not idempotent, so catch "duplicate column"
  // errors silently. These columns were added after the initial schema.
  const migrations = [
    "ALTER TABLE evaluations ADD COLUMN cover_letter TEXT",
    "ALTER TABLE evaluations ADD COLUMN tailored_resume TEXT",
    "ALTER TABLE profiles ADD COLUMN workspace_id TEXT",
    "ALTER TABLE jobs ADD COLUMN workspace_id TEXT",
    // Hash of the posting text: the same posting pasted twice is one job, with one evaluation
    // and one remembered score, instead of two rows that disagree.
    "ALTER TABLE jobs ADD COLUMN content_hash TEXT",
    "ALTER TABLE evaluations ADD COLUMN workspace_id TEXT",
  ];
  for (const sql of migrations) {
    try { await c.execute(sql); } catch { /* column already exists — fine */ }
  }
}

// Seeds one profile the first time a given browser (workspace) uses the app, so there is
// always something to evaluate against. It is the OFFICIAL class starter kit — Jordan Lee's
// résumé and the kit's preferences and hard constraints — because that is the data the
// assignment is graded on. Any further profile (a different candidate, a different job
// sector) is created by the user on the Resume & Preferences screen and belongs to that
// same workspace.
async function ensureWorkspaceProfile(c: SqlClient, workspaceId: string) {
  const res = await c.execute({
    sql: "SELECT COUNT(*) as n FROM profiles WHERE workspace_id = ?",
    args: [workspaceId],
  });
  if (Number(res.rows[0]?.n ?? 0) > 0) return;

  const resumeText = fs.readFileSync(path.join(process.cwd(), "src/data/classkit/resume.md"), "utf-8");
  const preferencesText = fs.readFileSync(
    path.join(process.cwd(), "src/data/classkit/preferences.md"),
    "utf-8"
  );
  const id = nanoid(10);
  await c.execute({
    sql: `INSERT INTO profiles (id, name, resume_text, preferences_text, is_active, workspace_id)
          VALUES (?, ?, ?, ?, 0, ?)`,
    args: [id, "Class kit — Jordan Lee", resumeText, preferencesText, workspaceId],
  });
  await setActiveProfile(workspaceId, id);
}

/** Which profile this browser is working as. */
export async function setActiveProfile(workspaceId: string, profileId: string): Promise<void> {
  await db().execute({
    sql: `INSERT INTO workspace_state (workspace_id, active_profile_id, updated_at)
          VALUES (?, ?, datetime('now'))
          ON CONFLICT(workspace_id) DO UPDATE SET active_profile_id = excluded.active_profile_id,
                                                  updated_at = datetime('now')`,
    args: [workspaceId, profileId],
  });
}

export function isTursoConfigured(): boolean {
  return !!tursoUrl();
}

/** Which database the app is actually talking to, for the status panel. */
export function databaseKind(): "postgres" | "turso" | "local-file" {
  if (usePostgres()) return "postgres";
  return isTursoConfigured() ? "turso" : "local-file";
}

// A cheap (SELECT 1) live check — unlike the LLM connection test, this has no
// meaningful cost, so the system-status panel can safely run it on every load.
export async function testDbConnection(): Promise<{ ok: boolean; message: string }> {
  try {
    await db().execute("SELECT 1");
    if (degraded) {
      return {
        ok: false,
        message:
          `The configured database refused the request, so the app is running on TEMPORARY ` +
          `in-memory storage: everything works, but nothing you save will still be here later. ` +
          `Original error: ${degradedReason}`,
      };
    }
    return {
      ok: true,
      message:
        databaseKind() === "postgres"
          ? "Connected to Postgres (Supabase)."
          : databaseKind() === "turso"
            ? "Connected to Turso."
            : "Using local file DB (local.db).",
    };
  } catch (err) {
    return { ok: false, message: String(err).slice(0, 200) };
  }
}

export async function getActiveProfile(workspaceId: string): Promise<{
  id: string;
  name: string;
  resumeText: string;
  preferencesText: string;
}> {
  const c = db();
  await ensureWorkspaceProfile(c, workspaceId);
  const res = await c.execute({
    sql: `SELECT p.id, p.name, p.resume_text, p.preferences_text
          FROM profiles p
          LEFT JOIN workspace_state w ON w.active_profile_id = p.id AND w.workspace_id = ?
          WHERE p.workspace_id = ?
          ORDER BY (w.active_profile_id IS NULL), p.created_at ASC
          LIMIT 1`,
    args: [workspaceId, workspaceId],
  });
  if (res.rows.length === 0) {
    // Should not happen after ensureWorkspaceProfile(), but fall back to the class kit files
    // rather than crash if the profiles table is empty.
    return {
      id: "fallback",
      name: "Class kit — Jordan Lee",
      resumeText: fs.readFileSync(path.join(process.cwd(), "src/data/classkit/resume.md"), "utf-8"),
      preferencesText: fs.readFileSync(
        path.join(process.cwd(), "src/data/classkit/preferences.md"),
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

// ---------- Harness settings (per profile) ----------
// Values are JSON-encoded so a setting can be a number, boolean or long string.

export async function loadHarnessOverrides(profileId: string): Promise<Record<string, unknown>> {
  const c = db();
  const res = await c.execute({
    sql: "SELECT key, value FROM harness_settings WHERE profile_id = ?",
    args: [profileId],
  });
  const out: Record<string, unknown> = {};
  for (const row of res.rows) {
    const key = row.key as string;
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.value as string);
    } catch {
      continue; // unreadable row: fall back to the default rather than crash
    }
    if (key.startsWith("prompts.")) {
      const sub = key.slice("prompts.".length);
      const prompts = (out.prompts ?? {}) as Record<string, unknown>;
      prompts[sub] = parsed;
      out.prompts = prompts;
    } else {
      out[key] = parsed;
    }
  }
  return out;
}

export async function saveHarnessOverrides(
  profileId: string,
  sanitized: Record<string, unknown>
): Promise<void> {
  const c = db();
  for (const [key, value] of Object.entries(sanitized)) {
    if (key === "prompts") {
      for (const [sub, text] of Object.entries(value as Record<string, unknown>)) {
        await upsertSetting(profileId, `prompts.${sub}`, text);
      }
    } else {
      await upsertSetting(profileId, key, value);
    }
  }
}

async function upsertSetting(profileId: string, key: string, value: unknown) {
  await db().execute({
    sql: `INSERT INTO harness_settings (profile_id, key, value, updated_at)
          VALUES (?, ?, ?, datetime('now'))
          ON CONFLICT(profile_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    args: [profileId, key, JSON.stringify(value)],
  });
}

/** Reset: remove the override so the shipped default applies again. */
export async function resetHarnessOverride(profileId: string, key?: string): Promise<void> {
  const c = db();
  if (key) {
    await c.execute({
      sql: "DELETE FROM harness_settings WHERE profile_id = ? AND key = ?",
      args: [profileId, key],
    });
  } else {
    await c.execute({ sql: "DELETE FROM harness_settings WHERE profile_id = ?", args: [profileId] });
  }
}
