import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";

// Best-effort scraper: fetches a job posting URL and pulls readable text out of it.
// This is NOT guaranteed to work on every site — many job boards (LinkedIn, Indeed,
// Greenhouse-behind-auth, etc.) block server-side fetches, require JS rendering, or
// disallow scraping in their robots.txt / terms of service. When a fetch fails or
// returns something that isn't real posting text, the UI falls back to "paste the
// text yourself" rather than silently feeding garbage into the agent.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const url = (body.url ?? "").toString();

  if (!url || !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: "A valid http(s) URL is required." }, { status: 400 });
  }

  let resp: Response;
  try {
    resp = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; JobSearchAgentBot/1.0; educational project; +https://example.edu)",
      },
      redirect: "follow",
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          "Could not reach that URL from the server. Some job boards block automated fetches — paste the posting text instead.",
        detail: String(err),
      },
      { status: 502 }
    );
  }

  if (!resp.ok) {
    return NextResponse.json(
      {
        error: `Site responded with ${resp.status}. Many job boards block scraping — paste the posting text instead.`,
      },
      { status: 502 }
    );
  }

  // Some boards (e.g. Greenhouse) respond 200 but silently redirect a dead/filled
  // job-posting URL to a generic "all openings" board page instead of erroring.
  // Detect that: the original URL pointed at a specific posting (has /job(s)/<id>),
  // but after following redirects we landed somewhere that dropped that id, or the
  // final URL carries an explicit error/not-found signal.
  const finalUrl = resp.url || url;
  try {
    const originalPath = new URL(url).pathname;
    const finalPath = new URL(finalUrl).pathname;
    const originalHasSpecificId = /\/jobs?\/[^/]+/i.test(originalPath);
    const finalHasSpecificId = /\/jobs?\/[^/]+/i.test(finalPath);
    const finalSignalsError = /error=true|not[-_]?found|expired/i.test(finalUrl);
    if (finalSignalsError || (originalHasSpecificId && !finalHasSpecificId)) {
      return NextResponse.json(
        {
          error:
            "That specific job posting could not be found — the site redirected to a generic listings page instead (the posting was likely filled, removed, or the link is stale). Paste the posting text instead.",
        },
        { status: 404 }
      );
    }
  } catch {
    // If URL parsing fails for some reason, fall through to normal extraction.
  }

  const html = await resp.text();
  const $ = cheerio.load(html);
  $("script, style, nav, footer, header, noscript, svg").remove();

  const title =
    $("h1").first().text().trim() || $("title").first().text().trim() || "Untitled posting";

  // Heuristic: grab the largest text block on the page (usually the job description).
  let bestText = "";
  $("article, main, [class*=description], [class*=job], section, div").each((_, el) => {
    const t = $(el).text().replace(/\s+/g, " ").trim();
    if (t.length > bestText.length) bestText = t;
  });

  if (!bestText || bestText.length < 100) {
    bestText = $("body").text().replace(/\s+/g, " ").trim();
  }

  if (!bestText || bestText.length < 40) {
    return NextResponse.json(
      {
        error:
          "Fetched the page but couldn't find real posting text (likely a JS-rendered page). Paste the posting text instead.",
      },
      { status: 422 }
    );
  }

  // Safety net for boards that return 200 on the SAME url (no redirect) but show a
  // "this posting is gone" message rather than a description — don't feed that to
  // the agent as if it were real job text.
  const deadPostingPhrases =
    /no (current )?openings|position (has been filled|is no longer available)|job (has been filled|is no longer available)|this (job|posting) (is closed|has expired|is no longer active)|no longer accepting applications/i;
  if (deadPostingPhrases.test(bestText)) {
    return NextResponse.json(
      {
        error:
          "This page indicates the posting is no longer available (filled, closed, or expired). Paste the posting text instead if you have it saved elsewhere.",
      },
      { status: 404 }
    );
  }

  return NextResponse.json({ title, text: bestText.slice(0, 20000), sourceUrl: url });
}
