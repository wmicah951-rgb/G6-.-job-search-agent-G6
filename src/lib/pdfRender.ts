import jsPDF from "jspdf";

// Typesets the agent's markdown-style output into a real document:
//   resume : '# Name', a contact line, '## SECTION' headings with a rule,
//            '**Bold**' role lines, '- ' bullets with hanging indent
//   letter : business-letter paragraphs
//   plain  : simple text (the grounded evidence draft)
// Single column, standard fonts, no images: ATS-friendly.

export type PdfKind = "resume" | "letter" | "plain";

/**
 * How the document LOOKS. All three styles produce the same document: same section order,
 * same single ATS-safe column, same content, same headings. Only typeface, heading treatment
 * and density change, so two people in a group can pick different looks and still hand in
 * work a screening system reads identically.
 *   classic - Times body, ruled section headings (the traditional résumé look)
 *   modern  - Helvetica throughout, heavier headings, a little more air (the default)
 *   compact - Helvetica, tighter leading and margins, for a résumé that must fit one page
 */
export type DocStyle = "classic" | "modern" | "compact";

interface StyleSpec {
  serif: boolean;
  bodySize: number;
  leading: number;
  marginX: number;
  marginY: number;
  nameSize: number;
  headingSize: number;
  rule: boolean;
  uppercaseHeadings: boolean;
}

const STYLES: Record<DocStyle, StyleSpec> = {
  classic: { serif: true, bodySize: 10.5, leading: 1.4, marginX: 54, marginY: 52, nameSize: 20, headingSize: 11, rule: true, uppercaseHeadings: true },
  modern: { serif: false, bodySize: 10, leading: 1.38, marginX: 50, marginY: 48, nameSize: 21, headingSize: 11, rule: true, uppercaseHeadings: true },
  compact: { serif: false, bodySize: 9.2, leading: 1.26, marginX: 42, marginY: 38, nameSize: 17, headingSize: 10, rule: false, uppercaseHeadings: true },
};

export const DOC_STYLE_LABELS: { value: DocStyle; label: string; hint: string }[] = [
  { value: "modern", label: "Modern", hint: "Helvetica, ruled headings — the default" },
  { value: "classic", label: "Classic", hint: "Times body, traditional résumé look" },
  { value: "compact", label: "Compact", hint: "Tighter spacing to fit one page" },
];

// jsPDF's built-in fonts are Latin-1 only: map anything else to a safe form.
function sanitize(t: string): string {
  return t
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/[→⇒]/g, "->")
    .replace(/[–—]/g, "-")
    .replace(/ /g, " ")
    .replace(/[^\x09\x0A\x20-\x7E\xA0-\xFF•]/g, "");
}

type Tok = { text: string; bold: boolean; spaceBefore: boolean };

function tokenize(line: string): Tok[] {
  const clean = line.replace(/(?<!\*)\*(?!\*)/g, "").replace(/`/g, "");
  const parts = clean.split("**");
  const out: Tok[] = [];
  let pendingSpace = false;
  parts.forEach((part, i) => {
    const bold = i % 2 === 1;
    for (const w of part.split(/(\s+)/)) {
      if (!w) continue;
      if (/^\s+$/.test(w)) {
        pendingSpace = true;
        continue;
      }
      out.push({ text: w, bold, spaceBefore: pendingSpace });
      pendingSpace = false;
    }
  });
  return out;
}

export function renderMarkdownPdf(
  rawText: string,
  filename: string,
  kind: PdfKind = "plain",
  style: DocStyle = "modern"
) {
  const spec = STYLES[style] ?? STYLES.modern;
  const face = spec.serif ? "times" : "helvetica";
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const marginX = kind === "resume" ? spec.marginX : spec.marginX + 12;
  const marginY = kind === "resume" ? spec.marginY : spec.marginY + 14;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const maxW = pageW - marginX * 2;
  let y = marginY;

  const body = kind === "resume" ? spec.bodySize : spec.bodySize + 1;
  const lead = body * spec.leading;

  function ensure(space: number) {
    if (y + space > pageH - marginY) {
      doc.addPage();
      y = marginY;
    }
  }

  // Wraps mixed bold/regular words. Spaces are a fixed 0.278em (Helvetica's
  // space width) instead of measured, because jsPDF measures lone spaces badly.
  function rich(text: string, x: number, width: number, size: number, opts?: { hangX?: number; color?: number }) {
    const toks = tokenize(text);
    doc.setFontSize(size);
    doc.setTextColor(opts?.color ?? 20);
    const lh = size * spec.leading;
    const gap = size * 0.278;
    const hang = opts?.hangX ?? x;
    let cx = x;
    let first = true;
    ensure(lh);
    for (const t of toks) {
      doc.setFont(face, t.bold ? "bold" : "normal");
      const w = doc.getTextWidth(t.text);
      const g = !first && t.spaceBefore ? gap : 0;
      if (!first && cx + g + w > x + width) {
        y += lh;
        ensure(lh);
        cx = hang;
        first = true;
      } else {
        cx += g;
      }
      doc.text(t.text, cx, y);
      cx += w;
      first = false;
    }
    y += lh;
  }

  const lines = sanitize(rawText).split("\n");
  let seenName = false;
  let expectContact = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\s+$/, "");
    const trimmed = line.trim();

    if (!trimmed) {
      y += kind === "resume" ? 3 : lead * 0.7;
      continue;
    }
    if (/^-{3,}$/.test(trimmed)) continue;

    if (kind === "resume" && /^#\s+/.test(trimmed) && !seenName) {
      seenName = true;
      expectContact = true;
      const name = trimmed.replace(/^#\s+/, "").replace(/\*\*/g, "");
      doc.setFont(face, "bold");
      doc.setFontSize(spec.nameSize);
      doc.setTextColor(10);
      ensure(30);
      doc.text(name, pageW / 2, y + 4, { align: "center" });
      y += 26;
      continue;
    }

    if (kind === "resume" && expectContact && !/^#/.test(trimmed)) {
      expectContact = false;
      doc.setFont(face, "normal");
      doc.setFontSize(9);
      doc.setTextColor(80);
      const contact = trimmed.replace(/\*\*/g, "");
      const wrapped = doc.splitTextToSize(contact, maxW) as string[];
      for (const w of wrapped) {
        ensure(12);
        doc.text(w, pageW / 2, y, { align: "center" });
        y += 12;
      }
      y += 4;
      continue;
    }

    const h = trimmed.match(/^#{1,3}\s+(.*)$/);
    if (h) {
      const label = h[1].replace(/\*\*/g, "");
      if (kind === "resume") {
        y += 8;
        ensure(26);
        doc.setFont(face, "bold");
        doc.setFontSize(spec.headingSize);
        doc.setTextColor(10);
        doc.text(spec.uppercaseHeadings ? label.toUpperCase() : label, marginX, y);
        y += 3;
        if (spec.rule) {
          doc.setDrawColor(60);
          doc.setLineWidth(0.7);
          doc.line(marginX, y, pageW - marginX, y);
        }
        y += spec.rule ? 13 : 10;
      } else {
        rich(`**${label}**`, marginX, maxW, body + 1);
      }
      continue;
    }

    const bullet = trimmed.match(/^[-*•]\s+(.*)$/);
    if (bullet) {
      const indent = 14;
      ensure(lead);
      doc.setFont(face, "normal");
      doc.setFontSize(body);
      doc.setTextColor(20);
      doc.text("•", marginX + 3, y);
      rich(bullet[1], marginX + indent, maxW - indent, body, { hangX: marginX + indent });
      continue;
    }

    rich(trimmed, marginX, maxW, body);
    if (kind === "letter") y += 2;
  }

  doc.save(filename);
}
