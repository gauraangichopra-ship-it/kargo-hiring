import "server-only";
import { Type, type Schema } from "@google/genai";
import { generateJson } from "./gemini";
import type { Rubric } from "./rubric";
import { validateScores, verifyQuotes, weightedTotal, type AiScore, type CheckedScore } from "./scoring-core";
import type { Criterion, Role } from "./types";

const SYSTEM = `You are scoring a CV for Kargo using a fixed rubric derived from Kargo's best past hires. Score ONLY from what is written in the CV. Do not infer, assume or reward anything not stated. For each criterion give a score of 0, 1, 2, 3, 4 or 5 using this scale: 5 = specific evidence (a named task, number or result) that meets every part of the description; 3 = evidence that meets part of it; 0 = no evidence. Respect every 'scores 3 at most' cap in the descriptions. For every score, quote the exact CV line that supports it in evidence_quote (verbatim, max 30 words). If score is 0, evidence_quote is 'No evidence in CV'. Keep reasoning to one sentence. Ignore years of experience, job titles, company prestige and education - they are not criteria.`;

const SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    scores: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          criterion_name: { type: Type.STRING },
          score: { type: Type.INTEGER, minimum: 0, maximum: 5 },
          evidence_quote: { type: Type.STRING },
          reasoning: { type: Type.STRING },
        },
        required: ["criterion_name", "score", "evidence_quote", "reasoning"],
        propertyOrdering: ["criterion_name", "score", "evidence_quote", "reasoning"],
      },
    },
  },
  required: ["scores"],
};

function describe(c: Criterion, rubric: Rubric, role: Role): string {
  let desc = c.description;
  // SPM criteria say "Everything required at PM level, plus ..." - spell that out.
  if (role === "SPM" && /everything required at pm level/i.test(desc)) {
    const pm = rubric.criteria.PM.find((p) => p.criterion_name === c.criterion_name);
    if (pm) desc += `\n   (PM-level requirement: ${pm.description})`;
  }
  return `${c.sort_order}. Criterion name: ${c.criterion_name}\n   Weight: ${c.weight}%\n   What a strong candidate looks like: ${desc}`;
}

export type RoleScore = {
  role: Role;
  scores: (CheckedScore & { criterion_id: string })[];
  weighted_total: number;
};

// cvRedacted must already have passed the PII assertion.
export async function scoreForRole(cvRedacted: string, role: Role, rubric: Rubric): Promise<RoleScore> {
  const criteria = rubric.criteria[role];
  const names = criteria.map((c) => c.criterion_name);
  const prompt = [
    `ROLE: ${role === "PM" ? "Product Manager" : "Senior Product Manager"}`,
    "",
    "RUBRIC SCORING RULES:",
    rubric.scoring,
    "",
    "CRITERIA (use these exact criterion names, one entry each):",
    criteria.map((c) => describe(c, rubric, role)).join("\n\n"),
    "",
    "CV (personal details replaced with [CANDIDATE], [EMAIL], [PHONE], [LINK], [INSTITUTION]):",
    "<<<CV",
    cvRedacted,
    "CV>>>",
  ].join("\n");

  let result: { scores: AiScore[] } | null = null;
  let problems: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await generateJson<{ scores: AiScore[] }>({ system: SYSTEM, prompt, schema: SCHEMA, temperature: 0 });
    problems = validateScores(res.scores, names);
    if (!problems.length) {
      result = res;
      break;
    }
  }
  if (!result) throw new Error(`Scoring for ${role} returned invalid output: ${problems.join("; ")}`);

  const checked = verifyQuotes(result.scores, cvRedacted);
  const scores = criteria.map((c) => {
    const s = checked.find((x) => x.criterion_name === c.criterion_name)!;
    return { ...s, criterion_id: c.id };
  });
  const total = weightedTotal(
    scores.map((s) => ({ score: s.score, weight: criteria.find((c) => c.id === s.criterion_id)!.weight })),
  );
  return { role, scores, weighted_total: total };
}
