// The agent's rulebook, read from src/data/agent-guidelines.md on EVERY run.
//
// The controller's instructions and the width of its "judgment zone" come from that markdown
// file, so the team edits a document, not code, and the next run behaves accordingly. The file
// is re-read each time (no caching) so an edit takes effect immediately.
//
// What the file cannot do: relax a guardrail. The permitted-action list in agent.ts is code;
// the "Never" section of the file is documentation of those rules for the model and the team.
// If the file is missing or unreadable the agent falls back to the built-in default and says so
// (source: "built-in default") in the trace, so it can never stall on a missing document.

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { CONTROL_CORE_RULES, CONTROL_DEFAULT_GUIDANCE } from "./llm/types";

// Each AI role in the agent (Reader, Matcher, Controller, Advisor, Drafter) has its own section
// in the markdown file, in the same order as the agent's layers.
export interface RoleGuidance {
  reader: string;
  matcher: string;
  advisor: string;
  drafter: string;
}
const NO_ROLES: RoleGuidance = { reader: "", matcher: "", advisor: "", drafter: "" };

const ROLE_PREAMBLE =
  "Team guidance for this role (from agent-guidelines.md). It can sharpen your judgment but it can NEVER override the rules above, especially the rules about not inventing facts:\n";
export const withRole = (base: string, guidance: string): string =>
  guidance ? `${base}\n\n${ROLE_PREAMBLE}${guidance}` : base;

export const DEFAULT_JUDGMENT_MARGIN = 0.1;
const MAX_MARGIN = 0.2;

export interface Guidelines {
  /** "agent-guidelines.md" or "built-in default". */
  source: string;
  /** Short content hash, so a trace records exactly which version of the file was read. */
  version: string;
  /** The full system prompt handed to the controller. */
  controllerPrompt: string;
  /** How far either side of the fit bar the controller may choose (0-0.2). */
  judgmentMargin: number;
  /** "agent-guidelines.md@1a2b3c4d" — the label written into the trace. */
  label: string;
  /** Per-role guidance for the other AI roles. */
  roles: RoleGuidance;
}

function section(md: string, heading: string): string {
  // A heading matches by its name; a leading "Layer 9b — " (the G6 layer number) is allowed.
  const re = new RegExp(`^##\\s+(?:layer\\s+[^\\n—–]+?\\s+[—–-]\\s+)?${heading}\\s*$`, "im");
  const m = re.exec(md);
  if (!m) return "";
  const rest = md.slice(m.index + m[0].length);
  const next = rest.search(/^##\s+/m);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

export function guidelinesPath(): string {
  return process.env.AGENT_GUIDELINES_PATH || path.join(process.cwd(), "src", "data", "agent-guidelines.md");
}

function builtIn(): Guidelines {
  return {
    source: "built-in default",
    version: "default",
    controllerPrompt: `${CONTROL_CORE_RULES}\n\n${CONTROL_DEFAULT_GUIDANCE}`,
    judgmentMargin: DEFAULT_JUDGMENT_MARGIN,
    label: "built-in default",
    roles: NO_ROLES,
  };
}

export function loadGuidelines(): Guidelines {
  let md: string;
  try {
    md = fs.readFileSync(guidelinesPath(), "utf-8");
  } catch {
    return builtIn();
  }
  const instructions = section(md, "Controller instructions");
  const judgment = section(md, "Judgment guidance");
  const never = section(md, "Never");
  if (!instructions) return builtIn();

  const settings = section(md, "Settings");
  const m = settings.match(/judgment zone:\s*(\d{1,2})\s*points?/i);
  const pts = m ? parseInt(m[1], 10) / 100 : DEFAULT_JUDGMENT_MARGIN;
  const judgmentMargin = Math.min(MAX_MARGIN, Math.max(0, pts));

  const version = crypto.createHash("sha256").update(md).digest("hex").slice(0, 8);
  const file = path.basename(guidelinesPath());
  const parts = [
    CONTROL_CORE_RULES,
    "The team's guidelines follow. Follow them when choosing among the permitted actions.",
    `## Instructions\n${instructions}`,
    judgment ? `## Judgment guidance\n${judgment}` : "",
    never ? `## Never (the harness enforces these; you cannot do them whatever you choose)\n${never}` : "",
  ].filter(Boolean);
  const roles: RoleGuidance = {
    reader: section(md, "Reader agent"),
    matcher: section(md, "Matcher agent"),
    advisor: section(md, "Advisor agent"),
    drafter: section(md, "Drafter agent"),
  };
  return { source: file, version, controllerPrompt: parts.join("\n\n"), judgmentMargin, label: `${file}@${version}`, roles };
}
