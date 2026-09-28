// npm run seed  ->  parses rubric.txt and writes it to the Neon database.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";
import { Pool } from "@neondatabase/serverless";
import { parseRubric, type Role } from "../src/lib/rubric-parse";

config({ path: resolve(process.cwd(), ".env.local") });

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set - run `npx neon link` first");

  const text = readFileSync(resolve(process.cwd(), "rubric.txt"), "utf8");
  const rubric = parseRubric(text); // throws loudly if anything is off
  const pool = new Pool({ connectionString: url });
  const db = await pool.connect();

  try {
    // One transaction: the weights trigger checks the final state at commit.
    await db.query("begin");
    for (const role of ["PM", "SPM"] as Role[]) {
      const rows = rubric.criteria.filter((c) => c.role === role);
      const { rows: existing } = await db.query<{ criterion_name: string }>(
        "select criterion_name from rubric_criteria where role = $1",
        [role],
      );
      const sameNames =
        existing.length === rows.length && rows.every((r) => existing.some((e) => e.criterion_name === r.criterion_name));

      if (!sameNames && existing.length) {
        console.warn(`${role}: criteria changed - replacing them (existing ${role} scores are deleted).`);
        await db.query("delete from rubric_criteria where role = $1", [role]);
      }
      // Upsert keeps criterion ids stable, so existing scores survive a reseed.
      // sort_order is moved out of the way first to avoid (role, sort_order) clashes.
      await db.query("update rubric_criteria set sort_order = sort_order + 1000 where role = $1", [role]);
      for (const r of rows) {
        await db.query(
          `insert into rubric_criteria (role, criterion_name, description, weight, sort_order)
           values ($1, $2, $3, $4, $5)
           on conflict (role, criterion_name) do update set
             description = excluded.description, weight = excluded.weight, sort_order = excluded.sort_order`,
          [r.role, r.criterion_name, r.description, r.weight, r.sort_order],
        );
      }
      console.log(`${role}: ${rows.map((r) => `${r.criterion_name} (${r.weight}%)`).join(", ")}`);
    }
    await db.query(
      `insert into rubric_meta (key, value) values ('scoring', $1), ('usage_rules', $2)
       on conflict (key) do update set value = excluded.value`,
      [rubric.scoring, rubric.usageRules],
    );
    await db.query("commit");

    const { rows: check } = await db.query<{ role: string; n: number; total: number }>(
      "select role, count(*)::int as n, sum(weight)::int as total from rubric_criteria group by role order by role",
    );
    for (const c of check) if (c.total !== 100) throw new Error(`After seeding, ${c.role} weights sum to ${c.total}`);
    console.log(`Rubric seeded: ${check.reduce((a, c) => a + c.n, 0)} criteria, weights = 100 per role.`);
  } catch (err) {
    await db.query("rollback").catch(() => {});
    throw err;
  } finally {
    db.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("SEED FAILED:", err.message ?? err);
  process.exit(1);
});
