// npm run seed  ->  parses rubric.txt and writes it to Supabase.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { parseRubric, type Role } from "../src/lib/rubric-parse";

config({ path: resolve(process.cwd(), ".env.local") });

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY must be set in .env.local");

  const text = readFileSync(resolve(process.cwd(), "rubric.txt"), "utf8");
  const rubric = parseRubric(text); // throws loudly if anything is off
  const db = createClient(url, key, { auth: { persistSession: false } });

  for (const role of ["PM", "SPM"] as Role[]) {
    const rows = rubric.criteria.filter((c) => c.role === role);
    const { data: existing, error: readErr } = await db
      .from("rubric_criteria")
      .select("criterion_name")
      .eq("role", role);
    if (readErr) throw readErr;

    const sameNames =
      existing.length === rows.length &&
      rows.every((r) => existing.some((e) => e.criterion_name === r.criterion_name));

    if (sameNames) {
      // Keeps criterion ids stable, so existing scores survive a reseed.
      const { error } = await db
        .from("rubric_criteria")
        .upsert(rows, { onConflict: "role,criterion_name" });
      if (error) throw error;
    } else {
      if (existing.length) {
        console.warn(`${role}: criteria changed - replacing them (existing ${role} scores are deleted).`);
        const { error } = await db.from("rubric_criteria").delete().eq("role", role);
        if (error) throw error;
      }
      const { error } = await db.from("rubric_criteria").insert(rows);
      if (error) throw error;
    }
    console.log(`${role}: ${rows.map((r) => `${r.criterion_name} (${r.weight}%)`).join(", ")}`);
  }

  const { error: metaErr } = await db.from("rubric_meta").upsert([
    { key: "scoring", value: rubric.scoring },
    { key: "usage_rules", value: rubric.usageRules },
  ]);
  if (metaErr) throw metaErr;

  const { data: check, error: checkErr } = await db.from("rubric_criteria").select("role, weight");
  if (checkErr) throw checkErr;
  for (const role of ["PM", "SPM"]) {
    const sum = check.filter((r) => r.role === role).reduce((a, r) => a + r.weight, 0);
    if (sum !== 100) throw new Error(`After seeding, ${role} weights sum to ${sum}`);
  }
  console.log("Rubric seeded: 10 criteria, weights = 100 per role.");
}

main().catch((err) => {
  console.error("SEED FAILED:", err.message ?? err);
  process.exit(1);
});
