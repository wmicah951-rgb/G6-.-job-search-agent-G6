// WHAT THE AGENT REMEMBERS ABOUT A POSTING.
//
// The problem this solves: a fit score that moved on its own. Every evaluation asked the model
// to read the requirements out of the posting, and a model does not return the same list twice
// — it merges two bullets, splits another, re-words a third. The denominator changed, so the
// same résumé against the same posting scored 42% one minute and 58% the next, and a tailored
// draft could look "worse" than the original for reasons that had nothing to do with the
// résumé. Nobody can trust a number that moves.
//
// So the first evaluation of a posting writes down the requirement list it found (the LEDGER),
// and every later evaluation of that posting is judged against that stored list, with the same
// priorities and weights. Only the résumé side can move the score. On top of that, a verdict
// already reached for this exact posting + résumé + matcher prompt is reused outright, so a
// re-run returns the identical number without paying for another model call.
//
// Keys:
//   job_hash  - the posting text, whitespace-normalised, sha256. The same posting pasted twice
//               (or re-run in the Test Lab) is the same job as far as memory is concerned.
//   fit_key   - résumé + matcher prompt + model name. Change the résumé, the prompt or the
//               model and the saved verdicts no longer apply, so a fresh judgement is made
//               against the SAME stored requirement list.
//
// Nothing here can change a decision: memory only supplies the yardstick and the verdicts.
// Every gate in agent.ts still runs on every run.

import crypto from "crypto";
import { db, ensureSchema } from "./db";
import type { AgentMemory, FitEvaluation, KnownEvidence, LedgerItem } from "./agent";
import type { HarnessSettings } from "./harnessSettings";

export function hashText(text: string): string {
  return crypto.createHash("sha256").update(text.replace(/\s+/g, " ").trim()).digest("hex").slice(0, 32);
}

/**
 * Job boards wrap a posting in text that changes daily without the job changing: "2 weeks ago",
 * "Be among the first 25 applicants", "Over 200 applicants", "See who X has hired for this role".
 * Left in, the same LinkedIn posting read on Tuesday and on Wednesday hashed differently, so the
 * agent treated it as a new job and re-judged it. These phrases are removed before hashing only —
 * the agent still reads the posting exactly as fetched.
 */
export function withoutVolatileText(text: string): string {
  return text
    .replace(/\b\d+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago\b/gi, " ")
    .replace(/\b(?:be among the first|over)\s+\d[\d,]*\s+applicants\b/gi, " ")
    .replace(/\b\d[\d,]*\s+applicants\b/gi, " ")
    .replace(/\bsee who .{0,80}? has hired for this role\b/gi, " ")
    .replace(/\breposted\b/gi, " ");
}

export function jobHash(jobText: string): string {
  return hashText(withoutVolatileText(jobText));
}

// Bumped whenever the code that TURNS a model answer into a verdict changes (quote checking,
// weighting, alignment to the ledger). A saved verdict from older logic is then simply not found,
// and the posting is judged afresh against the same stored requirement list. Without this, a
// verdict produced by a since-fixed bug would stay frozen forever - the price of never drifting.
//   v2: quotes are checked whitespace-insensitively, so wrapped resume lines no longer lose matches
//   v3: near-exact quotes recovered to the resume's own line; only clean verdicts are saved
//   v4: a majority of three independent readings decides each requirement
//   v5: verdicts answered by the backup brain are never saved (drops the ones saved during an outage)
//   v6: quote recovery compares sentence-sized pieces, so a flattened resume cannot over-match
export const MATCHER_VERSION = "v6";

export function fitKey(resumeText: string, settings: HarnessSettings, model: string): string {
  return hashText([MATCHER_VERSION, resumeText, settings.prompts.fit, model].join(" | "));
}

export async function ensureMemorySchema(): Promise<void> {
  // ensureSchema() first, because it is what notices a database that refuses to serve and
  // swaps the process onto temporary in-memory storage. Without this, a blocked database made
  // memory quietly do nothing — every call threw, every caller caught it, and the fit score
  // started drifting again with no visible cause.
  await ensureSchema();
  await db().executeMultiple(`
    CREATE TABLE IF NOT EXISTS requirement_ledgers (
      job_hash   TEXT PRIMARY KEY,
      ledger_json TEXT NOT NULL,
      source     TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS fit_cache (
      job_hash   TEXT NOT NULL,
      fit_key    TEXT NOT NULL,
      fit_json   TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (job_hash, fit_key)
    );

    CREATE TABLE IF NOT EXISTS eval_history (
      job_hash     TEXT NOT NULL,
      workspace_id TEXT,
      profile_id   TEXT,
      profile_name TEXT,
      score        REAL,
      stage        TEXT,
      at           TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

/** Everything remembered about this posting for this résumé. Never throws: with no database
 *  (or a brand-new one) the agent simply has no memory and behaves as it always did. */
export async function loadMemory(opts: {
  jobText: string;
  resumeText: string;
  settings: HarnessSettings;
  model: string;
}): Promise<AgentMemory> {
  try {
    await ensureMemorySchema();
    const c = db();
    const jh = jobHash(opts.jobText);
    const key = fitKey(opts.resumeText, opts.settings, opts.model);
    const [ledgerRow, cacheRow, history, verdicts] = await Promise.all([
      c.execute({ sql: "SELECT ledger_json FROM requirement_ledgers WHERE job_hash = ?", args: [jh] }),
      c.execute({
        sql: "SELECT fit_json FROM fit_cache WHERE job_hash = ? AND fit_key = ?",
        args: [jh, key],
      }),
      c.execute({
        sql: "SELECT score, profile_name, at FROM eval_history WHERE job_hash = ? ORDER BY at DESC LIMIT 5",
        args: [jh],
      }),
      // Every saved verdict on this posting: which résumé sentences proved which requirement.
      c.execute({
        sql: "SELECT fit_json FROM fit_cache WHERE job_hash = ? ORDER BY created_at DESC LIMIT 50",
        args: [jh],
      }),
    ]);
    const knownEvidence: KnownEvidence[] = [];
    const seen = new Set<string>();
    for (const row of verdicts.rows) {
      try {
        const f = JSON.parse(row.fit_json as string) as FitEvaluation;
        for (const m of f.matched ?? []) {
          const quote = f.matchedEvidence?.[m];
          const key = `${m}\u0000${quote}`;
          if (!quote || seen.has(key)) continue;
          seen.add(key);
          knownEvidence.push({ requirement: m, quote, strength: f.matchStrength?.[m] ?? "full" });
        }
      } catch {
        // one unreadable row is not a reason to lose the rest
      }
    }
    const ledger = ledgerRow.rows.length
      ? (JSON.parse(ledgerRow.rows[0].ledger_json as string) as LedgerItem[])
      : null;
    const cachedFit = cacheRow.rows.length
      ? (JSON.parse(cacheRow.rows[0].fit_json as string) as FitEvaluation)
      : null;
    return {
      ledger,
      cachedFit,
      knownEvidence,
      history: history.rows.map((r) => ({
        score: r.score === null ? null : Number(r.score),
        profile: (r.profile_name as string) ?? null,
        at: r.at as string,
      })),
    };
  } catch {
    return {};
  }
}

/** Stores the requirement list (first time only — it is a fixed yardstick, not a cache) and
 *  this run's verdicts, plus a history row so the UI can show that the score held steady. */
export async function saveMemory(opts: {
  jobText: string;
  resumeText: string;
  settings: HarnessSettings;
  model: string;
  fit: FitEvaluation | null | undefined;
  score: number | null;
  stage: string;
  workspaceId?: string | null;
  profileId?: string | null;
  profileName?: string | null;
}): Promise<void> {
  try {
    await ensureMemorySchema();
    const c = db();
    const jh = jobHash(opts.jobText);
    const fit = opts.fit;
    // Memory holds only the PRIMARY brain's judgments. While DeepSeek was out of credit the backup
    // (Haiku) answered, and its verdicts were being saved under DeepSeek's name — so a score from a
    // different, smaller model kept being served as if DeepSeek had made it. A backup answer is
    // good enough to keep the run going; it is not what the posting should be judged by forever.
    if (fit && fit.method === "llm" && !fit.viaBackup && fit.ledger && fit.ledger.length > 0) {
      // INSERT OR IGNORE: the first list read for a posting is the one everybody is judged
      // against. Overwriting it on every run would put the drifting denominator right back.
      await c.execute({
        sql: `INSERT OR IGNORE INTO requirement_ledgers (job_hash, ledger_json, source) VALUES (?, ?, ?)`,
        args: [jh, JSON.stringify(fit.ledger), opts.model],
      });
      // Only a CLEAN verdict is saved for reuse. Freezing the requirement list is always right;
      // freezing one model answer is only right if that answer is sound. A run where a proposed
      // match was thrown out (its quote could not be found) or that was low-confidence is exactly
      // the run most likely to be wrong — the live site once froze a 36% for an obvious-fit job
      // that re-judges at 91%. Such a verdict is used for this run but not remembered, so the next
      // run judges again, against the same stored list, until a clean verdict is reached.
      const clean = (fit.droppedMatches ?? 0) === 0 && !fit.lowConfidence;
      if (clean) {
        await c.execute({
          sql: `INSERT INTO fit_cache (job_hash, fit_key, fit_json, created_at) VALUES (?, ?, ?, datetime('now'))
                ON CONFLICT(job_hash, fit_key) DO UPDATE SET fit_json = excluded.fit_json`,
          args: [jh, fitKey(opts.resumeText, opts.settings, opts.model), JSON.stringify(fit)],
        });
      }
    }
    await c.execute({
      sql: `INSERT INTO eval_history (job_hash, workspace_id, profile_id, profile_name, score, stage)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        jh,
        opts.workspaceId ?? null,
        opts.profileId ?? null,
        opts.profileName ?? null,
        opts.score,
        opts.stage,
      ],
    });
  } catch {
    // Memory is an optimisation and an audit trail, never a dependency: if the write fails the
    // run has already produced its answer.
  }
}

/** Forgets the frozen requirement list for a posting (the "Re-extract requirements" button).
 *  The saved verdicts go with it, because they were judged against that list. */
export async function forgetLedger(jobText: string): Promise<void> {
  await ensureMemorySchema();
  const c = db();
  const jh = jobHash(jobText);
  await c.execute({ sql: "DELETE FROM requirement_ledgers WHERE job_hash = ?", args: [jh] });
  await c.execute({ sql: "DELETE FROM fit_cache WHERE job_hash = ?", args: [jh] });
}

/** Past scores for a posting, newest first — what the UI shows as "Evaluation history". */
export async function scoreHistory(
  jobText: string
): Promise<{ score: number | null; profile: string | null; at: string; stage: string | null }[]> {
  try {
    await ensureMemorySchema();
    const res = await db().execute({
      sql: "SELECT score, profile_name, at, stage FROM eval_history WHERE job_hash = ? ORDER BY at DESC LIMIT 10",
      args: [jobHash(jobText)],
    });
    return res.rows.map((r) => ({
      score: r.score === null ? null : Number(r.score),
      profile: (r.profile_name as string) ?? null,
      at: r.at as string,
      stage: (r.stage as string) ?? null,
    }));
  } catch {
    return [];
  }
}
