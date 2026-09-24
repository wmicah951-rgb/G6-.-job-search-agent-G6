// READY-MADE CANDIDATES AND POSTINGS, SO ANYONE CAN USE THE LIVE SITE IN ONE CLICK.
//
// A grader, a teammate or a classmate opening the site should not have to write a résumé and
// find six job postings before they can see the agent do anything. Everything here is data
// that already lives in the repo and is already covered by tests:
//
//   - the OFFICIAL class kit (Jordan Lee + jobs.json J001-J006), which the assignment grades on
//   - our demo candidate (Jordan Ellis) and the four required-test postings built for him
//   - six candidates from other fields (scripts/category-matrix.ts), each with a posting they
//     fit, one needing qualifications they lack, and one that breaks a hard constraint
//
// All of it is fictional. Loading a sample creates an ordinary profile / ordinary postings in
// the visitor's own workspace, so nothing here is shared or can be changed for anyone else.

import fs from "fs";
import path from "path";
import { classKitJobs, classKitPosting, classKitPreferences, classKitResume } from "./classKit";

const dataDir = () => path.join(process.cwd(), "src", "data");
const read = (...p: string[]) => fs.readFileSync(path.join(dataDir(), ...p), "utf-8");

export interface SampleProfile {
  key: string;
  name: string;
  field: string;
  blurb: string;
  /** The posting set that goes with this candidate. */
  postingSet: string;
}

export const SAMPLE_PROFILES: SampleProfile[] = [
  {
    key: "classkit",
    name: "Class kit — Jordan Lee",
    field: "Data / business analytics (official class kit)",
    blurb: "The instructor's own starter-kit candidate: GSU CIS senior, analytics internship, Atlanta.",
    postingSet: "classkit",
  },
  {
    key: "demo",
    name: "Demo — Jordan Ellis",
    field: "Data analyst, 2 years",
    blurb: "Our original demo candidate, used by the four required tests (J001–J004).",
    postingSet: "required",
  },
  {
    key: "nursing",
    name: "Nursing — Alicia Moreno",
    field: "Registered nurse, med-surg",
    blurb: "RN with 3 years on a med-surg unit, charge nurse, Tucson.",
    postingSet: "nursing",
  },
  {
    key: "teaching",
    name: "Teaching — Daniel Okafor",
    field: "Middle-school maths teacher",
    blurb: "Licensed grade 7–8 maths teacher, team lead, Columbus.",
    postingSet: "teaching",
  },
  {
    key: "software",
    name: "Software — Wei Chen",
    field: "Backend engineer",
    blurb: "Python/TypeScript services on AWS, 2 years, remote or hybrid only.",
    postingSet: "software",
  },
  {
    key: "trades",
    name: "Skilled trades — Marcus Bell",
    field: "HVAC service technician",
    blurb: "EPA 608 Universal, 6 years residential and light commercial, Greensboro.",
    postingSet: "trades",
  },
  {
    key: "retail",
    name: "Retail — Sofia Ramirez",
    field: "Store manager",
    blurb: "Runs a $3.2M specialty-apparel store with a team of 18, Orlando.",
    postingSet: "retail",
  },
  {
    key: "finance-entry",
    name: "Finance — Priya Raghavan",
    field: "Entry-level financial analyst",
    blurb: "FP&A and accounts-payable co-ops, Charlotte.",
    postingSet: "finance",
  },
  {
    key: "marketing-ops",
    name: "Marketing ops — Marcus Okonkwo",
    field: "Marketing operations",
    blurb: "Marketing operations and campaign reporting, Austin.",
    postingSet: "marketing",
  },
];

export function sampleProfileText(key: string): { resumeText: string; preferencesText: string } | null {
  if (key === "classkit") return { resumeText: classKitResume(), preferencesText: classKitPreferences() };
  if (key === "demo") return { resumeText: read("resume.md"), preferencesText: read("preferences.md") };
  const sample = SAMPLE_PROFILES.find((s) => s.key === key);
  if (!sample) return null;
  return {
    resumeText: read("profiles", key, "resume.md"),
    preferencesText: read("profiles", key, "preferences.md"),
  };
}

/** Every sample candidate with its full résumé and preferences — what each test runs against. */
export function sampleProfilesWithText(): (SampleProfile & { resumeText: string; preferencesText: string })[] {
  return SAMPLE_PROFILES.map((p) => ({ ...p, ...(sampleProfileText(p.key) ?? { resumeText: "", preferencesText: "" }) }));
}

export interface SamplePostingSet {
  key: string;
  label: string;
  description: string;
}

export const SAMPLE_POSTING_SETS: SamplePostingSet[] = [
  {
    key: "classkit",
    label: "Class kit J001–J006",
    description: "The six postings from the official starter kit's jobs.json, unchanged — including J004's prompt injection.",
  },
  {
    key: "required",
    label: "The four required tests (J001–J004)",
    description: "Obvious fit, partial fit, hard constraint and prompt injection, written for the demo candidate.",
  },
  { key: "nursing", label: "Nursing (3 postings)", description: "A fit, a partial fit and a hard-constraint posting." },
  { key: "teaching", label: "Teaching (3 postings)", description: "A fit, a partial fit and a hard-constraint posting." },
  { key: "software", label: "Software (3 postings)", description: "A fit, a partial fit and a hard-constraint posting." },
  { key: "trades", label: "Skilled trades (3 postings)", description: "A fit, a partial fit and a hard-constraint posting." },
  { key: "retail", label: "Retail (3 postings)", description: "A fit, a partial fit and a hard-constraint posting." },
  { key: "finance", label: "Finance (1 posting)", description: "A realistic entry-level financial-analyst posting." },
  { key: "marketing", label: "Marketing ops (1 posting)", description: "A realistic marketing-operations posting." },
];

/** The postings in a set, as { title, rawText }, ready to hand to the agent. */
export function samplePostings(set: string): { title: string; rawText: string }[] {
  const titleOf = (text: string, fallback: string) => (text.match(/^#\s*(.+)$/m)?.[1] ?? fallback).trim();
  if (set === "classkit") {
    return classKitJobs().map((j) => ({ title: `${j.id} — ${j.title}`, rawText: classKitPosting(j.id) }));
  }
  if (set === "required") {
    return ["J001", "J002", "J003", "J004"].map((id) => {
      const rawText = read("jobs", `${id}.md`);
      return { title: `${id} — ${titleOf(rawText, id)}`, rawText };
    });
  }
  if (set === "finance") {
    const rawText = read("jobs", "realistic", "R-finance-analyst.md");
    return [{ title: titleOf(rawText, "Financial Analyst"), rawText }];
  }
  if (set === "marketing") {
    const rawText = read("jobs", "realistic", "R-marketing-ops.md");
    return [{ title: titleOf(rawText, "Marketing Operations"), rawText }];
  }
  if (["nursing", "teaching", "software", "trades", "retail"].includes(set)) {
    return (["fit", "partial", "constraint"] as const).map((kind) => {
      const rawText = read("jobs", "sectors", `${set}-${kind}.md`);
      return { title: titleOf(rawText, `${set} ${kind}`), rawText };
    });
  }
  return [];
}
