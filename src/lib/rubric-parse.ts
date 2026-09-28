// Parses rubric.txt. Pure function: used by the seed script, never at runtime
// (at runtime the rubric is read from the database).

export type Role = "PM" | "SPM";

export type ParsedCriterion = {
  role: Role;
  criterion_name: string;
  description: string;
  weight: number;
  sort_order: number;
};

export type ParsedRubric = {
  criteria: ParsedCriterion[];
  scoring: string;
  usageRules: string;
};

export const EXPECTED_WEIGHTS: Record<Role, number[]> = {
  PM: [30, 20, 20, 20, 10],
  SPM: [25, 15, 20, 25, 15],
};

const RULE = /^=+\s*$/;

// Splits the file into { HEADING: body } using the ===== / HEADING / ===== pattern.
// A heading may span up to 3 lines (e.g. the SPM title plus its subtitle);
// the first line is the key.
function sections(text: string): Record<string, string> {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: Record<string, string> = {};
  let current: string | null = null;
  let buf: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const close = RULE.test(lines[i])
      ? [2, 3, 4].find((k) => i + k < lines.length && RULE.test(lines[i + k]))
      : undefined;
    if (close !== undefined) {
      if (current) out[current] = buf.join("\n").trim();
      current = lines[i + 1].trim();
      buf = [];
      i += close;
      continue;
    }
    if (current) buf.push(lines[i]);
  }
  if (current) out[current] = buf.join("\n").trim();
  return out;
}

function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function parseCriteria(body: string, role: Role): ParsedCriterion[] {
  const blocks = body.split(/^Criterion name:/m).slice(1);
  return blocks.map((block, i) => {
    const name = block.split("\n")[0].trim();
    const desc = block.match(/What a strong candidate looks like:([\s\S]*?)^Weight:/m);
    const weight = block.match(/^Weight:\s*(\d+)\s*%/m);
    if (!name || !desc || !weight) {
      throw new Error(`Could not parse criterion #${i + 1} in the ${role} rubric`);
    }
    return {
      role,
      criterion_name: name,
      description: collapse(desc[1]),
      weight: Number(weight[1]),
      sort_order: i + 1,
    };
  });
}

export function parseRubric(text: string): ParsedRubric {
  const s = sections(text);
  const pmKey = Object.keys(s).find((k) => k.startsWith("PRODUCT MANAGER RUBRIC"));
  const spmKey = Object.keys(s).find((k) => k.startsWith("SENIOR PRODUCT MANAGER RUBRIC"));
  if (!pmKey || !spmKey) throw new Error("rubric.txt is missing a PM or SPM rubric section");
  if (!s["SCORING"] || !s["USAGE RULES"]) throw new Error("rubric.txt is missing SCORING or USAGE RULES");

  const criteria = [...parseCriteria(s[pmKey], "PM"), ...parseCriteria(s[spmKey], "SPM")];

  for (const role of ["PM", "SPM"] as Role[]) {
    const rows = criteria.filter((c) => c.role === role);
    const sum = rows.reduce((a, c) => a + c.weight, 0);
    if (rows.length !== 5) throw new Error(`${role}: expected 5 criteria, found ${rows.length}`);
    if (sum !== 100) throw new Error(`${role}: weights sum to ${sum}, expected 100`);
    const got = rows.map((r) => r.weight).join("/");
    const want = EXPECTED_WEIGHTS[role].join("/");
    if (got !== want) throw new Error(`${role}: weights are ${got}, expected ${want}`);
  }

  return { criteria, scoring: s["SCORING"], usageRules: s["USAGE RULES"] };
}
