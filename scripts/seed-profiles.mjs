// Loads the realistic demo profiles (finance, marketing ops) alongside the built-in
// data-analyst one, so the agent can be exercised across different careers.
//   node scripts/seed-profiles.mjs
import fs from "fs";
import path from "path";

const base = process.env.BASE || "http://localhost:3200";
const H = { "Content-Type": "application/json" };
const dir = "src/data/profiles";

const existing = (await (await fetch(base + "/api/profiles")).json()).profiles ?? [];

for (const name of fs.readdirSync(dir)) {
  const resumeText = fs.readFileSync(path.join(dir, name, "resume.md"), "utf-8");
  const preferencesText = fs.readFileSync(path.join(dir, name, "preferences.md"), "utf-8");
  const label = `Demo — ${name}`;
  const already = existing.find((p) => p.name === label);
  if (already) {
    await fetch(`${base}/api/profiles/${already.id}`, {
      method: "PATCH",
      headers: H,
      body: JSON.stringify({ resumeText, preferencesText }),
    });
    console.log(`updated  ${label}`);
  } else {
    const r = await fetch(base + "/api/profiles", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ name: label, resumeText, preferencesText, setActive: false }),
    });
    console.log(`created  ${label}  ${(await r.json()).id ?? ""}`);
  }
}
console.log(`\nOpen ${base}/upload to switch between them.`);
