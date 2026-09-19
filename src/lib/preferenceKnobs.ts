// Quick knobs — a structured VIEW over the profile's preferences.md.
//
// THE POINT: preferences.md stays the single source of truth. Reading a knob parses it
// out of that markdown; setting a knob rewrites only that one line and leaves everything
// else byte-for-byte alone. So the knobs and the raw text can never disagree, agent.ts
// needs no new read path, and the markdown stays the human-readable class artifact.

export interface Knobs {
  minFitPct: number | null;
  maxYears: number | null;
  clearanceExcluded: boolean;
  relocationExcluded: boolean;
  locationRule: "remote_only" | "remote_or_hybrid" | "any";
  preferredTitles: string[];
  companySizeCap: number | null;
  salaryTargetK: number | null;
}

interface Spec {
  key: keyof Knobs;
  section: string;
  match: RegExp;
  /** Written when the line is missing or being changed. */
  canonical: (v: never) => string;
}

const SECTION_HARD = "## Hard constraints";
const SECTION_FIT = "## Fit bar";
const SECTION_SOFT = "## Soft preferences";

// Tolerant reads (they must match what a human may have typed), canonical writes.
const RE = {
  minFit: /^(\s*[-*]?\s*minimum\s+fit[^0-9\n]*)(\d{1,3})(\s*%)/im,
  maxYears: /^(\s*[-*]?\s*will not apply[^.\n]*?)(\d+)(\s*\+?\s*years)/im,
  clearance: /^\s*[-*]?\s*will not apply[^.\n]*security clearance.*$/im,
  relocation: /^\s*[-*]?\s*will not apply[^.\n]*relocat.*$/im,
  location: /^\s*[-*]?\s*(remote or hybrid only|remote only)[^\n]*$/im,
  titles: /^(\s*[-*]?\s*prefers titles containing\s*)([^\n]*)$/im,
  size: /^(\s*[-*]?\s*prefers companies under\s*)([\d,]+)(\s*employees)/im,
  salary: /^(\s*[-*]?\s*salary target:\s*\$?)([\d,]+)(k)/im,
};

export function readKnobs(text: string): Knobs {
  const minFit = text.match(RE.minFit);
  const maxYears = text.match(RE.maxYears);
  const titles = text.match(RE.titles);
  const size = text.match(RE.size);
  const salary = text.match(RE.salary);
  const loc = text.match(RE.location);

  let locationRule: Knobs["locationRule"] = "any";
  if (loc) {
    locationRule = /remote only/i.test(loc[0]) ? "remote_only" : "remote_or_hybrid";
  } else if (/no roles that are 100% on-?site/i.test(text)) {
    locationRule = "remote_or_hybrid";
  }

  return {
    minFitPct: minFit ? clamp(parseInt(minFit[2], 10), 10, 90) : null,
    maxYears: maxYears ? parseInt(maxYears[2], 10) : null,
    clearanceExcluded: RE.clearance.test(text),
    relocationExcluded: RE.relocation.test(text),
    locationRule,
    preferredTitles: titles
      ? [...titles[2].matchAll(/"([^"]+)"/g)].map((m) => m[1]).filter(Boolean)
      : [],
    companySizeCap: size ? parseInt(size[2].replace(/,/g, ""), 10) : null,
    salaryTargetK: salary ? parseInt(salary[2].replace(/,/g, ""), 10) : null,
  };
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Rewrites ONE knob in the markdown. Where a line already exists, only the value inside
 * it is replaced — so any trailing comment the user wrote ("(change this to be pickier)")
 * survives. Where it does not, the canonical line is appended under its section.
 */
export function writeKnob<K extends keyof Knobs>(text: string, key: K, value: Knobs[K]): string {
  switch (key) {
    case "minFitPct": {
      const v = value as number | null;
      if (v == null) return text;
      return RE.minFit.test(text)
        ? text.replace(RE.minFit, (_m, a, _n, c) => `${a}${clamp(v, 10, 90)}${c}`)
        : addLine(text, SECTION_FIT, `- Minimum fit: ${clamp(v, 10, 90)}%`);
    }
    case "maxYears": {
      const v = value as number | null;
      if (v == null) return removeLine(text, RE.maxYears);
      return RE.maxYears.test(text)
        ? text.replace(RE.maxYears, (_m, a, _n, c) => `${a}${v}${c}`)
        : addLine(
            text,
            SECTION_HARD,
            `- Will NOT apply to roles requiring ${v}+ years of professional experience`
          );
    }
    case "clearanceExcluded": {
      const on = value as boolean;
      if (on) {
        return RE.clearance.test(text)
          ? text
          : addLine(
              text,
              SECTION_HARD,
              "- Will NOT apply to roles requiring an active security clearance"
            );
      }
      return removeLine(text, RE.clearance);
    }
    case "relocationExcluded": {
      const on = value as boolean;
      if (on) {
        return RE.relocation.test(text)
          ? text
          : addLine(text, SECTION_HARD, "- Will NOT apply to roles that require relocation");
      }
      return removeLine(text, RE.relocation);
    }
    case "locationRule": {
      const v = value as Knobs["locationRule"];
      const line =
        v === "remote_only"
          ? "- Remote only — no hybrid or on-site roles"
          : v === "remote_or_hybrid"
          ? "- Remote or hybrid only — no roles that are 100% on-site with no remote option"
          : null;
      const stripped = removeLine(text, RE.location);
      return line ? addLine(stripped, SECTION_HARD, line) : stripped;
    }
    case "preferredTitles": {
      const list = (value as string[]).filter(Boolean);
      if (!list.length) return removeLine(text, RE.titles);
      const rendered = list.map((t) => `"${t}"`).join(" or ");
      return RE.titles.test(text)
        ? text.replace(RE.titles, (_m, a) => `${a}${rendered}`)
        : addLine(text, SECTION_SOFT, `- Prefers titles containing ${rendered}`);
    }
    case "companySizeCap": {
      const v = value as number | null;
      if (v == null) return removeLine(text, RE.size);
      return RE.size.test(text)
        ? text.replace(RE.size, (_m, a, _n, c) => `${a}${v}${c}`)
        : addLine(text, SECTION_SOFT, `- Prefers companies under ${v} employees`);
    }
    case "salaryTargetK": {
      const v = value as number | null;
      if (v == null) return removeLine(text, RE.salary);
      return RE.salary.test(text)
        ? text.replace(RE.salary, (_m, a, _n, c) => `${a}${v}${c}`)
        : addLine(text, SECTION_SOFT, `- Salary target: $${v}k+`);
    }
    default:
      return text;
  }
}

function removeLine(text: string, re: RegExp): string {
  const m = text.match(re);
  if (!m) return text;
  return text
    .split("\n")
    .filter((l) => l.trim() !== m[0].trim())
    .join("\n");
}

/** Appends under the named section, creating the section at the end if it is absent. */
function addLine(text: string, section: string, line: string): string {
  const lines = text.split("\n");
  const idx = lines.findIndex((l) => l.trim().toLowerCase().startsWith(section.toLowerCase()));
  if (idx === -1) return `${text.replace(/\s*$/, "")}\n\n${section}\n${line}\n`;
  // Insert after the last non-blank line belonging to that section.
  let end = idx + 1;
  while (end < lines.length && !lines[end].trim().startsWith("##")) end += 1;
  let insertAt = end;
  while (insertAt > idx + 1 && !lines[insertAt - 1].trim()) insertAt -= 1;
  lines.splice(insertAt, 0, line);
  return lines.join("\n");
}
