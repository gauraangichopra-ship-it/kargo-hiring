import "server-only";
import { query } from "./db";
import type { Criterion, Role } from "./types";

export type Rubric = {
  criteria: Record<Role, Criterion[]>;
  scoring: string;
  usageRules: string;
};

// The rubric always comes from the database (seeded from rubric.txt).
export async function loadRubric(): Promise<Rubric> {
  const [rows, meta] = await Promise.all([
    query<Criterion>("select * from rubric_criteria order by role, sort_order"),
    query<{ key: string; value: string }>("select key, value from rubric_meta"),
  ]);
  const criteria = {
    PM: rows.filter((r) => r.role === "PM"),
    SPM: rows.filter((r) => r.role === "SPM"),
  };
  for (const role of ["PM", "SPM"] as Role[]) {
    const sum = criteria[role].reduce((a, c) => a + c.weight, 0);
    if (!criteria[role].length) throw new Error(`No ${role} rubric in the database - run npm run seed`);
    if (sum !== 100) throw new Error(`${role} rubric weights sum to ${sum}, expected 100`);
  }
  return {
    criteria,
    scoring: meta.find((m) => m.key === "scoring")?.value ?? "",
    usageRules: meta.find((m) => m.key === "usage_rules")?.value ?? "",
  };
}
