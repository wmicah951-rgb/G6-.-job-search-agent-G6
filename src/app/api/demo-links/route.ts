// Real LinkedIn postings for the Live Demo, tested in advance (scripts/build-demo-links.ts).
//
//   GET ?profile=<key>   -> that candidate's tested links: title, score, outcome, after-tailoring
//   GET ?url=<link>      -> the saved copy of one posting's text
//
// The saved copy is the exact text the agent scored, so loading it reproduces the listed score
// even if LinkedIn has since changed or removed the posting.

import { NextRequest, NextResponse } from "next/server";
import links from "@/data/demo-links.json";

type Link = {
  profile: string;
  url: string;
  title: string;
  company: string;
  score: number | null;
  stage: string;
  band: string;
  afterTailoring: number | null;
  violations: string[];
  gaps: string[];
  featured: boolean;
  checkedAt: string;
  postingText: string;
};

const ALL = links as Link[];
const ORDER: Record<string, number> = { high: 0, mid: 1, asks: 2, low: 3, rejected: 4 };

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (url) {
    const hit = ALL.find((l) => l.url === url);
    if (!hit) return NextResponse.json({ error: "Not a saved demo link." }, { status: 404 });
    return NextResponse.json({ title: hit.title, text: hit.postingText, url: hit.url });
  }
  const profile = req.nextUrl.searchParams.get("profile") ?? "";
  const list = ALL.filter((l) => l.profile === profile)
    .sort((a, b) => Number(b.featured) - Number(a.featured) || (ORDER[a.band] ?? 9) - (ORDER[b.band] ?? 9) || (b.score ?? -1) - (a.score ?? -1))
    .map(({ postingText: _omit, ...rest }) => rest);
  return NextResponse.json({ links: list });
}
