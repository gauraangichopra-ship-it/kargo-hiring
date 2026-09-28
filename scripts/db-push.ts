// npm run db:push            -> creates the tables on the linked Neon branch
// npm run db:push -- --reset -> drops and recreates them (DELETES ALL DATA)
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";
import { Pool } from "@neondatabase/serverless";

config({ path: resolve(process.cwd(), ".env.local") });

const TABLES = [
  "rubric_criteria", "rubric_meta", "candidates", "candidate_pii",
  "candidate_content", "scores", "score_totals", "briefs", "emails",
];

async function main() {
  // Unpooled: schema changes are best run on a direct connection.
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set - run `npx neon link` first");
  const pool = new Pool({ connectionString: url });
  try {
    const { rows } = await pool.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' and table_name = any($1)",
      [TABLES],
    );
    if (rows.length && !process.argv.includes("--reset")) {
      console.log(`Tables already exist (${rows.map((r) => r.table_name).join(", ")}). Nothing changed.`);
      console.log("To wipe and recreate them, run: npm run db:push -- --reset");
      return;
    }
    const sql = readFileSync(resolve(process.cwd(), "db/schema.sql"), "utf8");
    await pool.query(sql);
    console.log(`Schema applied: ${TABLES.length} tables.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("DB PUSH FAILED:", err.message ?? err);
  process.exit(1);
});
