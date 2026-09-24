import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";

// Best-effort scraper: fetches a job posting URL and pulls readable text out of it.
// This is NOT guaranteed to work on every site — many job boards (LinkedIn, Indeed,
// Greenhouse-behind-auth, etc.) block server-side fetches, require JS rendering, or
// disallow scraping in their robots.txt / terms of service. When a fetch fails or
// returns something that isn't real posting text, the UI falls back to "paste the
// text yourself" rather than silently feeding garbage into the agent.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  const url = (body.url ?? "").toString();

  if (!url || !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: "A valid http(s) URL is required." }, { status: 400 });
  }

  // A public site that fetches any URL it is given can be pointed at addresses only the server
  // can reach (its own machine, a private network, cloud metadata). Job postings live on the
  // public internet, so anything else is refused outright.
  if (isPrivateAddress(url)) {
    return NextResponse.json(
      { error: "That address is not a public web page. Paste a link to a public job posting." },
      { status: 400 }
    );
  }

  let resp: Response;
  let finalUrlAfterRedirects = url;
  try {
    // Redirects are followed by hand so every hop gets the same public-address check: with
    // redirect "follow", a public link that redirects to an internal address would be fetched.
    let target = url;
    for (let hop = 0; ; hop++) {
      resp = await fetch(target, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; JobSearchAgentBot/1.0; educational project; +https://example.edu)",
        },
        redirect: "manual",
      });
      const next = resp.status >= 300 && resp.status < 400 ? resp.headers.get("location") : null;
      if (!next) break;
      target = new URL(next, target).toString();
      if (hop >= 5 || !/^https?:\/\//i.test(target) || isPrivateAddress(target)) {
        return NextResponse.json(
          { error: "That link redirects somewhere that is not a public job posting. Paste the posting text instead." },
          { status: 400 }
        );
      }
    }
    finalUrlAfterRedirects = target;
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

  const finalUrl = finalUrlAfterRedirects;
  const html = await resp.text();

  // SIGN-IN WALLS. The class rule is explicit: do not scrape login-protected job boards. This
  // agent never signs in anywhere. LinkedIn (and others) often answer a logged-out visitor with a
  // sign-in page instead of the job; when that happens we say so plainly and ask for the text,
  // rather than feeding a login form to the agent as if it were a posting. Checked before the
  // dead-posting redirect below: LinkedIn sends a logged-out visitor from /jobs/view/<id> to
  // /authwall, which would otherwise be reported as a removed posting.
  if (looksLikeSignInWall(finalUrl, html)) {
    return NextResponse.json(
      {
        error:
          "That site asked for a sign-in before showing the job. This agent never logs in to job boards (a class rule), so it cannot read this link. Open the posting yourself and paste its text instead.",
        signInWall: true,
      },
      { status: 403 }
    );
  }

  // Some boards (e.g. Greenhouse) respond 200 but silently redirect a dead/filled
  // job-posting URL to a generic "all openings" board page instead of erroring.
  // Detect that: the original URL pointed at a specific posting (has /job(s)/<id>),
  // but after following redirects we landed somewhere that dropped that id, or the
  // final URL carries an explicit error/not-found signal.
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

  const $ = cheerio.load(html);
  $(
    "script, style, nav, footer, header, noscript, svg, [class*=video], [class*=modal], [class*=popup], [aria-label*=video]"
  ).remove();

  const title =
    $("h1").first().text().trim() || $("title").first().text().trim() || "Untitled posting";

  // Video-widget/accessibility-toolbar boilerplate ("Watch the video", "Close
  // the popup", "Disable/Enable Audio Description", "Transcript", repeated
  // "Loading..." states) shows up as dense repeated text on many corporate
  // careers sites and can out-size the real job description in the "largest
  // block" heuristic below if not stripped first.
  const stripVideoJunk = (t: string) =>
    t
      .replace(/Watch the video/gi, " ")
      .replace(/Close the popup/gi, " ")
      .replace(/Loading\.\.\./gi, " ")
      .replace(/Disable Audio Description/gi, " ")
      .replace(/Enable Audio Description/gi, " ")
      .replace(/Transcript/gi, " ")
      .replace(/\s+/g, " ")
      .trim();

  // Heuristic: grab the largest text block on the page (usually the job description).
  let bestText = "";
  $("article, main, [class*=description], [class*=job], section, div").each((_, el) => {
    const t = stripVideoJunk($(el).text().replace(/\s+/g, " ").trim());
    if (t.length > bestText.length) bestText = t;
  });

  if (!bestText || bestText.length < 100) {
    bestText = stripVideoJunk($("body").text().replace(/\s+/g, " ").trim());
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
  // the agent as if it were real job text. Deliberately NOT anchored to "job"/
  // "position" being immediately adjacent — real sites phrase this many ways
  // ("the job you are trying to apply for has been filled", "this position has
  // been filled", etc.) and a rigid adjacency requirement misses most of them.
  const deadPostingPhrases =
    /no (current )?openings|has been filled|is no longer (available|active)|(is closed|has expired)\b|no longer accepting applications|could not be found|posting (has been|was) removed/i;
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

function isPrivateAddress(raw: string): boolean {
  let host: string;
  try {
    host = new URL(raw).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return true;
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host === "0.0.0.0") return true;
  // IPv6 literals only (a colon means an address, not a name — "fcbarcelona.com" is a real site).
  if (host.includes(":") && (host === "::1" || host === "::" || /^(fc|fd|fe80)/.test(host))) return true;
  const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }
  return false;
}

function looksLikeSignInWall(finalUrl: string, html: string): boolean {
  if (/\/(authwall|login|signin|sign-in|checkpoint|uas\/login)/i.test(finalUrl)) return true;
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 20000);
  const prompts = (text.match(/sign in to (view|see|apply)|join (now|linkedin) to (see|view)|log in to (view|continue)|you must (sign|log) in/gi) ?? []).length;
  // A real posting is long; a wall is a short page dominated by sign-in prompts.
  return prompts > 0 && text.length < 6000;
}
