// The official CIS 4394 starter kit, used unchanged.
//
// src/data/classkit/{resume.md, preferences.md, jobs.json} are byte-for-byte copies of the
// files handed out in class (Jordan Lee's fictional résumé, the candidate's preferences and
// hard constraints, and the six postings J001-J006). Nothing in here edits them: the point is
// that our agent is graded on the instructor's own data, not on fixtures we chose ourselves.
//
// jobs.json is structured (title, company, location, required_years, requirements, preferred,
// description). Our agent reads postings as text, the way a real posting arrives, so
// postingText() renders each record into a posting. Every field is copied verbatim — including
// the J004 description, which contains the prompt injection. That text stays inside the posting
// as untrusted DATA so the agent has to deal with it, exactly as the assignment intends.

import fs from "fs";
import path from "path";

export interface ClassKitJob {
  id: string;
  title: string;
  company: string;
  location: string;
  required_years: number;
  requirements: string[];
  preferred: string[];
  description: string;
}

function dataDir(): string {
  return path.join(process.cwd(), "src", "data", "classkit");
}

export function classKitResume(): string {
  return fs.readFileSync(path.join(dataDir(), "resume.md"), "utf-8");
}

export function classKitPreferences(): string {
  return fs.readFileSync(path.join(dataDir(), "preferences.md"), "utf-8");
}

export function classKitJobs(): ClassKitJob[] {
  return JSON.parse(fs.readFileSync(path.join(dataDir(), "jobs.json"), "utf-8")) as ClassKitJob[];
}

/**
 * One jobs.json record as posting text. The experience line is written the way postings write
 * it ("at least 5 years of professional experience") rather than as a bare number, so the
 * agent's requirement reading has to do real work; 0 years is written as entry level.
 */
export function postingText(job: ClassKitJob): string {
  const years =
    job.required_years > 0
      ? `Experience: at least ${job.required_years} years of professional experience.`
      : "Experience: entry level — no prior professional experience required.";
  const lines = [
    `# ${job.title}`,
    "",
    `Company: ${job.company}`,
    `Location: ${job.location}`,
    years,
    "",
    "Requirements:",
    ...job.requirements.map((r) => `- ${r}`),
    "",
    "Preferred (nice to have):",
    ...job.preferred.map((r) => `- ${r}`),
    "",
    "About the role:",
    job.description,
  ];
  return lines.join("\n");
}

export function classKitJob(id: string): ClassKitJob | null {
  return classKitJobs().find((j) => j.id === id) ?? null;
}

export function classKitPosting(id: string): string {
  const job = classKitJob(id);
  if (!job) throw new Error(`No class-kit job ${id}`);
  return postingText(job);
}
