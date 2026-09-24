// TURNING A REAL RÉSUMÉ FILE INTO TEXT THE AGENT CAN QUOTE.
//
// People do not keep their résumé as markdown. They have a PDF from Word, a .docx, or a plain
// text export, often in two columns. The agent's whole grounding rule is that every claim it
// makes must be a literal quote from the résumé, so the text it holds has to be the text the
// person actually wrote — extracted, never paraphrased and never invented.
//
// That is why this file only EXTRACTS and TIDIES:
//   - PDF  : unpdf (pdf.js under the hood), page text joined in order
//   - DOCX : mammoth, which keeps headings and bullet structure
//   - MD/TXT: used as-is
// Then tidy() fixes the mechanical damage extraction does — hyphen-split words at line ends,
// bullet glyphs, runs of blank lines, non-breaking spaces. It never rewrites a sentence.
//
// Two-column PDFs are the one case extraction cannot always fix: text may interleave. The
// caller shows the extracted text for the person to correct before anything is saved, and
// warnings() flags the signs of a bad extraction so they know to look.

export type ResumeFileKind = "pdf" | "docx" | "text";

export function kindFor(filename: string, mimeType?: string): ResumeFileKind | null {
  const name = filename.toLowerCase();
  if (name.endsWith(".pdf") || mimeType === "application/pdf") return "pdf";
  if (
    name.endsWith(".docx") ||
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "docx";
  }
  if (/\.(md|markdown|txt|text)$/.test(name) || mimeType?.startsWith("text/")) return "text";
  return null;
}

/** Mechanical clean-up of extracted text. Nothing here changes wording. */
export function tidy(raw: string): string {
  const cleaned = raw
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    // Common bullet glyphs become "- " so the résumé reads like the markdown the rest of the app
    // expects. The words are untouched.
    .replace(/^[ \t]*[•▪◦·‣∙]\s*/gm, "- ")
    // A word split across a line break by a hyphen ("analy-\nsis") is one word.
    .replace(/([a-z])-\n([a-z])/g, "$1$2")
    .replace(/[ \t]+/g, " ");

  // STRUCTURE FIRST. A résumé's line breaks carry meaning: the name, the contact line, each
  // heading, each role, each bullet. An earlier version joined every line that did not end in
  // punctuation onto the next, to repair sentences a PDF had wrapped — and it fused a real
  // résumé's name, contact line and summary into one line and buried the degree inside the skills
  // section, so the matcher could no longer find the education section. Now a line is joined to the
  // one before it ONLY when it is plainly the rest of a wrapped sentence.
  const isHeading = (l: string) => /^[A-Z][A-Z &/+,'-]{2,40}:?$/.test(l) || /^#{1,3}\s/.test(l);
  const isBullet = (l: string) => /^[-*]\s/.test(l);
  const looksLikeRoleOrContact = (l: string) => /\||@|\b(19|20)\d{2}\b|\bpresent\b/i.test(l);
  const out: string[] = [];
  for (const rawLine of cleaned.split("\n")) {
    const line = rawLine.trim();
    const prev = out.length ? out[out.length - 1] : "";
    const continues =
      !!line &&
      !!prev &&
      !/[.;:!?]$/.test(prev) &&
      !isHeading(prev) &&
      !isHeading(line) &&
      !isBullet(line) &&
      !looksLikeRoleOrContact(line) &&
      // the rest of a sentence starts in lower case, or it continues a bullet that has not ended
      (/^[a-z(]/.test(line) || (isBullet(prev) && prev.length > 60));
    if (continues) out[out.length - 1] = `${prev} ${line}`;
    else out.push(line);
  }
  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Signs that an extraction went wrong, in plain words for the person to check. */
export function warnings(text: string): string[] {
  const out: string[] = [];
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 80) {
    out.push(
      "Only a little text came out of this file. If your résumé is a scan or an image, the text cannot be read from it — paste the text instead."
    );
  }
  const longWords = words.filter((w) => w.length > 28).length;
  if (longWords > 3) {
    out.push("Some words ran together, which usually means a multi-column layout. Check the text below before saving.");
  }
  if (!/experience|education|skills|summary|projects/i.test(text)) {
    out.push("No usual résumé headings (Experience, Education, Skills) were found — check that the right file was picked.");
  }
  if (/\f/.test(text)) out.push("Page breaks were left in the text; they are harmless but you can delete them.");
  const longest = Math.max(0, ...text.split("\n").map((l) => l.length));
  if (longest > 400) {
    out.push(
      "Some sections seem to have run together into one very long line. Check that your name, each heading and each job start on their own line before saving — the agent reads the résumé's structure."
    );
  }
  return out;
}

/**
 * Extracts the text of a résumé file. Returns the tidied text plus any warnings.
 * Throws with a plain-English message when the file type is not supported or is unreadable.
 */
export async function extractResumeText(
  bytes: Uint8Array,
  filename: string,
  mimeType?: string
): Promise<{ text: string; kind: ResumeFileKind; warnings: string[] }> {
  const kind = kindFor(filename, mimeType);
  if (!kind) {
    throw new Error("Only PDF, Word (.docx), Markdown and plain-text résumés can be read. A .doc or .pages file needs saving as PDF or .docx first.");
  }

  let raw: string;
  if (kind === "pdf") {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    raw = Array.isArray(text) ? text.join("\n") : text;
  } else if (kind === "docx") {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    raw = result.value;
  } else {
    raw = new TextDecoder().decode(bytes);
  }

  const text = tidy(raw);
  if (!text.trim()) {
    throw new Error("No text could be read from that file. If it is a scan or a photo, paste the text instead.");
  }
  return { text, kind, warnings: warnings(text) };
}
