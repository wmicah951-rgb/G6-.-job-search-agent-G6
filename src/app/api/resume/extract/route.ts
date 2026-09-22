// Reads the text out of an uploaded résumé file (PDF, .docx, .md, .txt).
//
// It saves nothing and changes nothing: the text comes back to the browser, the person checks
// it (extraction from a two-column PDF can interleave lines), and only then do they save it
// onto a profile through /api/profiles. Keeping extraction separate from saving is what makes
// "every claim is a literal quote from your résumé" honest — the person confirms the text the
// agent will be quoting.

import { NextRequest, NextResponse } from "next/server";
import { extractResumeText } from "@/lib/resumeIngest";

export const maxDuration = 30;

const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected a file upload." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file was attached." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is 5 MB.` },
      { status: 400 }
    );
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { text, kind, warnings } = await extractResumeText(bytes, file.name, file.type);
    return NextResponse.json({ text, kind, warnings, filename: file.name, chars: text.length });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 400 });
  }
}
