// npm run check:pii -- <folder>
// Runs the privacy step (no AI calls, nothing stored) on every CV in a folder
// and reports whether any personal detail would reach the AI model.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { extractText } from "../src/lib/parse";
import { extractPii, findLeaks, redact } from "../src/lib/pii";

async function main() {
  const dir = process.argv[2];
  if (!dir) throw new Error("Usage: npm run check:pii -- <folder of CVs>");
  const files = readdirSync(dir).filter((f) => /\.(pdf|docx|txt)$/i.test(f)).sort();
  let safe = 0;
  const problems: string[] = [];
  for (const f of files) {
    try {
      const text = await extractText(f, readFileSync(join(dir, f)));
      const pii = extractPii(text, f);
      const leaks = findLeaks(redact(text, pii), pii);
      if (leaks.length) problems.push(`BLOCKED  ${f}  (${leaks.join(", ")})`);
      else safe++;
    } catch (err) {
      problems.push(`ERROR    ${f}  (${err instanceof Error ? err.message : err})`);
    }
  }
  console.log(`${safe}/${files.length} CVs pass the privacy check.`);
  if (problems.length) console.log(problems.join("\n"));
  // Note: this cannot catch a name it never identified *and* that isn't in the
  // file name; the pipeline refuses to send a CV with no identified name.
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
