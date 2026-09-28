// Deterministic scoring maths. The model gives 0-5 per criterion;
// everything below is done in code.
import { REVIEW_BAND_POINTS, TOP_N_INVITE, UNVERIFIED_QUOTE_CAP } from "./config";
import type { Recommendation } from "./types";

export type AiScore = {
  criterion_name: string;
  score: number;
  evidence_quote: string;
  reasoning: string;
};

export const NO_EVIDENCE = "No evidence in CV";

const ALLOWED = new Set([0, 1, 2, 3, 4, 5]);

// Returns a list of problems. Empty = valid.
export function validateScores(scores: AiScore[] | undefined, criterionNames: string[]): string[] {
  if (!Array.isArray(scores)) return ["scores is not an array"];
  const problems: string[] = [];
  for (const name of criterionNames) {
    const matches = scores.filter((s) => s.criterion_name === name);
    if (matches.length !== 1) problems.push(`criterion "${name}" appears ${matches.length} times`);
  }
  for (const s of scores) {
    if (!criterionNames.includes(s.criterion_name)) problems.push(`unknown criterion "${s.criterion_name}"`);
    if (!Number.isInteger(s.score) || !ALLOWED.has(s.score)) problems.push(`invalid score ${s.score}`);
    if (typeof s.evidence_quote !== "string" || !s.evidence_quote.trim()) problems.push("missing evidence_quote");
  }
  return problems;
}

function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’“”"'`]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/[^\p{L}\p{N}\[\]%+-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Fuzzy verbatim check: exact after normalisation, or at least 80% of the
// quote's 4-word windows appear in the CV (tolerates small AI paraphrase,
// line-wrap hyphenation, dropped punctuation and "..." elisions).
export function quoteAppearsIn(quote: string, cvText: string): boolean {
  const q = normalise(quote.replace(/\.\.\.|…/g, " "));
  const cv = normalise(cvText);
  if (!q) return false;
  if (cv.includes(q)) return true;
  const words = q.split(" ");
  if (words.length < 4) return false;
  let hit = 0;
  let total = 0;
  for (let i = 0; i + 4 <= words.length; i++) {
    total++;
    if (cv.includes(words.slice(i, i + 4).join(" "))) hit++;
  }
  return hit / total >= 0.8;
}

export type CheckedScore = AiScore & { quote_verified: boolean };

// Caps any score whose quote can't be found in the CV.
export function verifyQuotes(scores: AiScore[], cvText: string): CheckedScore[] {
  return scores.map((s) => {
    if (s.score === 0) return { ...s, evidence_quote: s.evidence_quote || NO_EVIDENCE, quote_verified: true };
    const ok = quoteAppearsIn(s.evidence_quote, cvText);
    return ok
      ? { ...s, quote_verified: true }
      : { ...s, score: Math.min(s.score, UNVERIFIED_QUOTE_CAP), quote_verified: false };
  });
}

// sum(score x weight) / 5  ->  0..100, 1 decimal.
export function weightedTotal(items: { score: number; weight: number }[]): number {
  const raw = items.reduce((a, i) => a + i.score * i.weight, 0) / 5;
  return Math.round(raw * 10) / 10;
}

// Ranks one applied-role pool. Ties share a rank.
export function rankPool(
  pool: { candidate_id: string; weighted_total: number }[],
): { candidate_id: string; rank: number; recommended: Recommendation }[] {
  const sorted = [...pool].sort((a, b) => b.weighted_total - a.weighted_total);
  const cutoff = sorted[Math.min(TOP_N_INVITE, sorted.length) - 1]?.weighted_total ?? 0;
  return sorted.map((c, i) => {
    const rank = i > 0 && c.weighted_total === sorted[i - 1].weighted_total
      ? sorted.findIndex((x) => x.weighted_total === c.weighted_total) + 1
      : i + 1;
    let recommended: Recommendation;
    if (i < TOP_N_INVITE) recommended = "invite";
    else if (c.weighted_total >= cutoff - REVIEW_BAND_POINTS) recommended = "review";
    else recommended = "reject";
    return { candidate_id: c.candidate_id, rank, recommended };
  });
}
