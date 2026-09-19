// Round-trip: every knob must read back what it wrote, and must never damage the rest
// of the file. preferences.md is the source of truth; the knobs are only a view.
import fs from "fs";
import path from "path";
import { readKnobs, writeKnob, type Knobs } from "../src/lib/preferenceKnobs";

const original = fs.readFileSync(path.join(__dirname, "..", "src", "data", "preferences.md"), "utf-8");
let fail = 0;
const check = (n: string, ok: boolean, extra = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${extra ? "  " + extra : ""}`);
};

const k0 = readKnobs(original);
check("reads the shipped preferences.md", k0.minFitPct === 60 && k0.maxYears === 5 && k0.clearanceExcluded && k0.locationRule === "remote_or_hybrid", JSON.stringify(k0));

const cases: [keyof Knobs, any][] = [
  ["minFitPct", 45],
  ["maxYears", 3],
  ["companySizeCap", 500],
  ["salaryTargetK", 80],
  ["preferredTitles", ["Analyst", "Associate"]],
  ["locationRule", "remote_only"],
  ["clearanceExcluded", false],
];
for (const [key, value] of cases) {
  const next = writeKnob(original, key, value);
  const got = readKnobs(next)[key];
  const ok = JSON.stringify(got) === JSON.stringify(value);
  check(`${key} round-trips`, ok, ok ? "" : `wrote ${JSON.stringify(value)} read ${JSON.stringify(got)}`);
}

// nothing else may change
const one = writeKnob(original, "minFitPct", 45);
const changed = original.split("\n").filter((l, i) => l !== one.split("\n")[i]);
check("changing one knob edits exactly one line", changed.length === 1, changed.join(" | "));
check("the approval-policy section survives untouched", one.includes("No application material"));
check("trailing comment on the min-fit line is preserved", /45%\s+\(jobs scoring below/.test(one), one.split("\n").find((l) => /minimum fit/i.test(l)) ?? "");

// adding a knob that is not present yet
const stripped = original.split("\n").filter((l) => !/salary target/i.test(l)).join("\n");
const readded = writeKnob(stripped, "salaryTargetK", 95);
check("a missing knob is re-added canonically", readKnobs(readded).salaryTargetK === 95);

// turning a hard rule off then on again
const off = writeKnob(original, "clearanceExcluded", false);
const backOn = writeKnob(off, "clearanceExcluded", true);
check("clearance rule can be removed and restored", readKnobs(off).clearanceExcluded === false && readKnobs(backOn).clearanceExcluded === true);

console.log(fail === 0 ? "\nALL KNOB TESTS PASSED" : `\n${fail} KNOB TEST(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
