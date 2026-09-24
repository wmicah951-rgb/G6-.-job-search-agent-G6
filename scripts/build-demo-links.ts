// Builds the Live Demo's list of real LinkedIn postings for each sample candidate, with the score
// the agent actually gives each one — so a presenter knows in advance which link lands near 80%,
// which near 50%, and which is rejected.
//
//   set -a && source .env.local && set +a && npx tsx scripts/build-demo-links.ts
//
// For every link it:
//   1. reads the page through the LIVE site's link reader — proving it opens without a login (the
//      agent never signs in to job boards; that is a class rule);
//   2. runs the agent as that candidate, with the same memory the app uses, so the live site
//      reproduces the same score for the same posting text;
//   3. for a posting that reaches approval, approves it and records the re-score after tailoring;
//   4. keeps a copy of the posting text, so the demo still works if LinkedIn takes the job down.
// Then it picks one high, one middle and one low link per candidate and writes
// src/data/demo-links.json. Then run scripts/fill-demo-outcomes.ts so every link also has its
// after-tailoring number (down-ranked and question-asking jobs included).

import fs from "fs";
import path from "path";
import { runAgent, applyHumanDecision } from "../src/lib/agent";
import { DEFAULT_SETTINGS } from "../src/lib/harnessSettings";
import { getModelName } from "../src/lib/llmEvaluator";
import { loadMemory, saveMemory } from "../src/lib/memory";
import { SAMPLE_PROFILES, sampleProfileText } from "../src/lib/samples";

const LIVE = process.env.LIVE_URL ?? "https://g6-job-search-agent-g6.vercel.app";
const V = (slug: string) => `https://www.linkedin.com/jobs/view/${slug}`;

const CANDIDATES: Record<string, string[]> = {
  classkit: [
    V("data-analyst-speed-to-customer-at-the-home-depot-4462315195"),
    V("business-data-analyst-i-google-global-infrastructure-strategy-and-operations-at-google-4467625689"),
    V("data-analyst-at-pricebook-digital-4467631636"),
    V("business-data-analyst-i-predictive-modeling-statistics-finance-strategic-planning-at-global-payments-inc-4470227163"),
    V("business-analyst-i-full-time-united-states-at-cisco-4468290891"),
    V("2027-business-analyst-at-textron-4462055935"),
    V("data-analyst-ii-at-emory-healthcare-4435173069"),
    V("senior-data-analyst-at-invesco-4467947659"),
    V("marketing-coordinator-at-icsc-4467660362"),
  ],
  demo: [
    V("data-analyst-ii-at-corvel-corporation-4469938510"),
    V("associate-data-analyst-at-ust-4468941841"),
    V("data-analyst-at-truescripts-management-services-4466017033"),
    V("data-analyst-clinical-analytics-and-reporting-at-davita-kidney-care-4459334989"),
    V("data-analyst-metrics-reporting-at-live-nation-entertainment-4461530021"),
    V("senior-data-analyst-at-quinstreet-4404437297"),
    V("sr-data-analyst-bi-transportation-at-the-home-depot-4448548679"),
  ],
  nursing: [
    V("registered-nurse-med-surg-ortho-at-tucson-medical-center-4459897838"),
    V("telemetry-registered-nurse-rn-%E2%80%93-hospital-at-northwest-healthcare-4443542861"),
    V("registered-nurse-rn-ms-telemetry-tele-at-talented-medical-solutions-4437722014"),
    V("registered-nurse-rn-full-time-at-banner-rehabilitation-hospital-4450240878"),
    V("registered-nurse-rn-ir-at-carondelet-health-network-4462056784"),
    V("registered-nurse-rn-neuro-icu-at-carondelet-health-network-4469172819"),
    V("nurse-practitioner-advanced-practice-provider-at-oak-street-health-part-of-cvs-health-4424171657"),
  ],
  teaching: [
    V("2026-2027-middle-school-math-teacher-at-whitehall-preparatory-and-fitness-academy-at-performance-academies-4398836623"),
    V("middle-school-math-teacher-metro-schools-at-educational-service-center-of-central-ohio-4408171967"),
    V("2026-27-high-school-math-teacher-9-12-at-columbus-city-schools-ohio-4316018219"),
    V("4th-grade-math-science-teacher-2026-27-at-united-schools-4468817227"),
    V("6th-8th-grade-math-teacher-at-accel-schools-4457506236"),
    V("adjunct-mathematics-statistics-at-columbus-state-community-college-4264296902"),
  ],
  software: [
    V("software-engineer-ii-backend-platform-team-at-rippling-4463786876"),
    V("software-engineer-backend-all-teams-at-doordash-4409218723"),
    V("backend-engineer-intelligent-commerce-at-stripe-4467945100"),
    V("software-engineer-backend-at-snowflake-4214697219"),
    V("senior-software-engineer-backend-at-plaid-4410262237"),
    V("staff-software-engineer-backend-at-doordash-4327194708"),
  ],
  trades: [
    V("hvac-service-technician-at-blaze-heating-cooling-electrical-plumbing-4383761372"),
    V("hvac-service-technician-at-maynor-service-company-4467832555"),
    V("hvac-service-tech-at-american-residential-services-4466046932"),
    V("hvac-service-technician-ii-at-daikin-applied-americas-4464652912"),
    V("hvac-service-technician-iii-senior-chiller-mechanic-at-daikin-applied-americas-4414906039"),
    V("hvac-install-technician-lead-at-blaze-heating-cooling-electrical-plumbing-4397342038"),
  ],
  retail: [
    V("store-manager-sally-beauty-03334-at-sally-beauty-4062750859"),
    V("store-manager-orlando-east-fl-at-starbucks-4466895025"),
    V("store-manager-at-panda-restaurant-group-4456264888"),
    V("store-manager-10632-at-sally-beauty-4326434961"),
    V("store-manager-orlando-tourism-fl-at-starbucks-4469477463"),
    V("inventory-management-pricing-analyst-at-travel-%2B-leisure-co-4467225778"),
  ],
  "finance-entry": [
    V("financial-analyst-at-jeld-wen-inc-4461415055"),
    V("financial-analyst-core-fp-a-at-sonoco-4459091211"),
    V("financial-analyst-fixed-income-currency-commodities-at-u-s-bank-4462456726"),
    V("fp-a-senior-financial-analyst-at-truist-4467936521"),
    V("senior-financial-analyst-at-xylem-4462020485"),
  ],
  "marketing-ops": [
    V("marketing-project-operations-coordinator-at-harbor-health-4467409269"),
    V("senior-marketing-operations-analyst-at-closinglock-4443323369"),
    V("manager-marketing-operations-at-togetherwork-4462440866"),
    V("senior-marketing-operations-manager-reporting-and-analytics-at-vestwell-4467612707"),
    V("marketing-automation-engineer-braze-at-inkind-4468294366"),
    V("director-personalization-amp-crm-marketing-operations-at-realtor-com-4470285361"),
  ],
};

export interface DemoLink {
  profile: string;
  url: string;
  title: string;
  company: string;
  score: number | null;
  stage: string;
  band: "high" | "mid" | "low" | "rejected" | "asks";
  afterTailoring: number | null;
  violations: string[];
  gaps: string[];
  featured: boolean;
  checkedAt: string;
  postingText: string;
}

function bandOf(score: number | null, stage: string): DemoLink["band"] {
  if (stage === "rejected_hard_constraint") return "rejected";
  if (stage === "awaiting_clarification") return "asks";
  // A job the agent down-ranked is a weak fit whatever its number: the candidate's own fit bar
  // decides that, not a fixed 40%. Calling a 46% down-ranked job "partial fit" hid it from the
  // weak-fit pick, so the Trades row once had no weak example at all.
  if (stage === "rejected_low_fit" || score === null) return "low";
  if (score >= 0.7) return "high";
  if (score >= 0.4) return "mid";
  return "low";
}

async function readLive(url: string): Promise<{ title: string; text: string } | { error: string }> {
  try {
    const res = await fetch(`${LIVE}/api/jobs/scrape`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const d = await res.json();
    if (!res.ok) return { error: d.error ?? `HTTP ${res.status}` };
    return { title: d.title, text: d.text };
  } catch (e) {
    return { error: String(e) };
  }
}

async function evaluate(profileKey: string, url: string): Promise<DemoLink | { url: string; error: string }> {
  const page = await readLive(url);
  if ("error" in page) return { url, error: page.error };
  const text = sampleProfileText(profileKey)!;
  const memory = await loadMemory({ jobText: page.text, resumeText: text.resumeText, settings: DEFAULT_SETTINGS, model: getModelName() });
  const r = await runAgent(`demo-${profileKey}`, page.text, text.resumeText, text.preferencesText, DEFAULT_SETTINGS, memory);
  await saveMemory({
    jobText: page.text,
    resumeText: text.resumeText,
    settings: DEFAULT_SETTINGS,
    model: getModelName(),
    fit: r.fit,
    score: r.state.fitScore,
    stage: r.state.stage,
    profileName: SAMPLE_PROFILES.find((p) => p.key === profileKey)?.name ?? profileKey,
  });
  let afterTailoring: number | null = null;
  if (r.state.stage === "awaiting_approval") {
    try {
      const approved = await applyHumanDecision(r, "approve", null, page.text, text.resumeText);
      afterTailoring = approved.state.rescore?.after ?? null;
    } catch {
      afterTailoring = null;
    }
  }
  const company = (page.text.match(new RegExp(`${page.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+(.{2,60}?)\\s+(?:[A-Z][a-z]+, [A-Z]{2}|United States|Remote)`)) ?? [])[1] ?? "";
  const decode = (t: string) =>
    t.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  return {
    profile: profileKey,
    url,
    title: decode(page.title),
    // Some pages repeat the title before the company name ("Title Title Company, City"); drop the repeat.
    company: decode(company.trim().startsWith(page.title) ? company.trim().slice(page.title.length).trim() : company.trim()),
    score: r.state.fitScore,
    stage: r.state.stage,
    band: bandOf(r.state.fitScore, r.state.stage),
    afterTailoring,
    violations: r.state.hardConstraintViolations,
    gaps: r.state.missingSkills.slice(0, 4),
    featured: false,
    checkedAt: new Date().toISOString().slice(0, 10),
    postingText: page.text,
  };
}

async function main() {
  const only = process.argv[2];
  const outPath = path.join(__dirname, "..", "src", "data", "demo-links.json");
  const existing: DemoLink[] = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, "utf-8")) : [];
  const results: DemoLink[] = existing.filter((l) => only && l.profile !== only);

  for (const [profile, urls] of Object.entries(CANDIDATES)) {
    if (only && profile !== only) continue;
    console.log(`\n== ${profile}`);
    const tested: DemoLink[] = [];
    // Three at a time: enough to be quick, few enough to be polite to LinkedIn and the model.
    for (let i = 0; i < urls.length; i += 3) {
      const batch = await Promise.all(urls.slice(i, i + 3).map((u) => evaluate(profile, u)));
      for (const b of batch) {
        if ("error" in b) {
          console.log(`  SKIP  ${b.url.slice(34, 110)}  (${b.error.slice(0, 70)})`);
          continue;
        }
        tested.push(b);
        const s = b.score === null ? " n/a" : `${Math.round(b.score * 100)}%`.padStart(4);
        const after = b.afterTailoring === null ? "" : ` -> ${Math.round(b.afterTailoring * 100)}% after tailoring`;
        console.log(`  ${b.band.padEnd(8)} ${s}${after}  ${b.title.slice(0, 60)}  [${b.stage}]`);
      }
    }
    // Feature one high, one middle, one low/rejected — the spread a demo needs.
    const pick = (bands: DemoLink["band"][]) =>
      tested
        .filter((t) => bands.includes(t.band) && !t.featured)
        .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))[0];
    for (const want of [["high"], ["mid"], ["low", "rejected"]] as DemoLink["band"][][]) {
      const p = pick(want) ?? pick(["high", "mid", "low", "rejected", "asks"]);
      if (p) p.featured = true;
    }
    results.push(...tested);
  }

  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  const featured = results.filter((r) => r.featured).length;
  console.log(`\nWrote ${results.length} tested links (${featured} featured) to src/data/demo-links.json`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
