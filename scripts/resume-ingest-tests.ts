// Does a real PDF résumé survive being read back?
//
// The agent may only quote the résumé it holds, so if extraction mangles the text, every quote
// check downstream is built on sand. This renders each sample résumé to a genuine PDF with the
// same renderer the app uses for downloads (all three document styles), reads it back with the
// extractor the upload route uses, and checks the words actually came through. It also feeds the
// extracted text to the agent, because "the text looks fine" and "the agent can still quote it"
// are different claims.
//
//   npx tsx scripts/resume-ingest-tests.ts

import fs from "fs";
import path from "path";
import { renderMarkdownPdf, type DocStyle } from "../src/lib/pdfRender";
import { extractResumeText, tidy, warnings } from "../src/lib/resumeIngest";
import { runAgent } from "../src/lib/agent";

const root = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, "src", "data", p), "utf-8");

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n      ${detail}` : ""}`);
};

// renderMarkdownPdf() calls doc.save(), which writes a file in Node. Render into a temp dir and
// read the bytes back, so the test uses the real code path rather than a copy of it.
function renderToBytes(text: string, style: DocStyle): Uint8Array {
  const dir = fs.mkdtempSync(path.join(root, ".pdf-test-"));
  const cwd = process.cwd();
  try {
    process.chdir(dir);
    renderMarkdownPdf(text, "resume.pdf", "resume", style);
    return new Uint8Array(fs.readFileSync(path.join(dir, "resume.pdf")));
  } finally {
    process.chdir(cwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Share of the résumé's own content words that survived the round trip. */
function recovery(original: string, extracted: string): number {
  const words = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9%$./\s-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3);
  const got = new Set(words(extracted));
  const want = words(original);
  if (want.length === 0) return 1;
  return want.filter((w) => got.has(w)).length / want.length;
}

async function main() {
  const samples: [string, string][] = [
    ["class kit (Jordan Lee)", read("classkit/resume.md")],
    ["nursing (Alicia Moreno)", read("profiles/nursing/resume.md")],
    ["trades (Marcus Bell)", read("profiles/trades/resume.md")],
  ];
  const styles: DocStyle[] = ["modern", "classic", "compact"];

  for (const [label, resume] of samples) {
    for (const style of styles) {
      const bytes = renderToBytes(resume, style);
      const { text } = await extractResumeText(bytes, "resume.pdf", "application/pdf");
      const share = recovery(resume, text);
      check(
        `${label} survives a ${style} PDF round trip`,
        share >= 0.9,
        `${Math.round(share * 100)}% of content words recovered, ${text.length} chars`
      );
    }
  }

  // The extracted text must still work as a résumé: the agent has to be able to quote it.
  const kit = read("classkit/resume.md");
  const bytes = renderToBytes(kit, "modern");
  const { text } = await extractResumeText(bytes, "resume.pdf", "application/pdf");
  const posting = read("jobs/J001.md");
  const r = await runAgent("ingest-test", posting, text, read("classkit/preferences.md"));
  const quotesOk = Object.entries(r.state.matchedEvidence).every(([, q]) =>
    text.toLowerCase().includes(q.toLowerCase())
  );
  check("the agent can evaluate an extracted-from-PDF résumé", r.state.stage !== "start", `stage=${r.state.stage}`);
  check("and every quote it used is literally in that extracted text", quotesOk);

  // Non-PDF paths and the mechanical clean-up.
  const md = await extractResumeText(new TextEncoder().encode(kit), "resume.md", "text/markdown");
  check("a markdown résumé is read unchanged", md.text.includes("Jordan Lee"), `${md.text.length} chars`);
  const messy = tidy("Analy-\nsis of data\n• Built a report\n extra   spaces");
  check("hyphen-split words are rejoined", messy.includes("Analysis"), messy.slice(0, 60));
  check("bullet glyphs become markdown bullets", messy.includes("- Built a report"), messy);
  check(
    "a scan with no text layer is called out rather than accepted",
    warnings("Name\nOnly a few words here").some((w) => /scan|image|little text/i.test(w))
  );
  let rejected = false;
  try {
    await extractResumeText(new Uint8Array([1, 2, 3]), "resume.doc", "application/msword");
  } catch {
    rejected = true;
  }
  check("an unsupported file type is refused with a plain message", rejected);

  console.log(`\n${failures === 0 ? "ALL RÉSUMÉ-INGEST TESTS PASSED" : `${failures} TEST(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
