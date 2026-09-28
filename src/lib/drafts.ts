import "server-only";
import { Type, type Schema } from "@google/genai";
import { generateJson } from "./gemini";
import { ROLE_TITLE, type EmailType, type Role } from "./types";

type ScoreForPrompt = {
  criterion_name: string;
  weight: number;
  score: number;
  evidence_quote: string;
  reasoning: string;
};

function scoreTable(scores: ScoreForPrompt[]): string {
  return scores
    .map((s) => `- ${s.criterion_name} (weight ${s.weight}%): ${s.score}/5. Evidence: "${s.evidence_quote}". ${s.reasoning}`)
    .join("\n");
}

// --------------------------------------------------------------------
// Interview brief
// --------------------------------------------------------------------
const BRIEF_SYSTEM = `You write interview briefs for Arjun Mehta, founder of Kargo (logistics SaaS). You see an anonymised CV and rubric scores. Write for a busy founder who has 2 minutes. Never mention or guess the candidate's name, gender, age or educational institution; refer to them as "the candidate". Use only facts in the CV and scores.`;

const BRIEF_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    brief: { type: Type.STRING },
    probe_questions: { type: Type.ARRAY, items: { type: Type.STRING }, minItems: "2", maxItems: "3" },
  },
  required: ["brief", "probe_questions"],
  propertyOrdering: ["brief", "probe_questions"],
};

function sentenceCount(s: string): number {
  return (s.trim().match(/[^.!?]+[.!?]+(?=\s|$)/g) ?? []).length;
}

export async function generateBrief(input: {
  role: Role;
  cvRedacted: string;
  scores: ScoreForPrompt[];
  weightedTotal: number;
  rank: number | null;
}): Promise<{ brief: string; probe_questions: string[] }> {
  const lowest = [...input.scores].sort((a, b) => a.score - b.score || b.weight - a.weight).slice(0, 2);
  const prompt = [
    `Role: ${ROLE_TITLE[input.role]}. Weighted score ${input.weightedTotal}/100${input.rank ? `, ranked #${input.rank} in this role` : ""}.`,
    "",
    "Rubric scores:",
    scoreTable(input.scores),
    "",
    `Lowest-scoring criteria: ${lowest.map((l) => l.criterion_name).join(", ")}`,
    "",
    "Return:",
    '- "brief": EXACTLY 3 sentences. Sentence 1: who they are (the work they have done). Sentence 2: why they ranked here, citing the strongest evidence. Sentence 3: the biggest gap.',
    '- "probe_questions": 2-3 interview questions that test the lowest-scoring criteria. Each question should ask for a specific past example.',
    "",
    "<<<CV",
    input.cvRedacted,
    "CV>>>",
  ].join("\n");

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await generateJson<{ brief: string; probe_questions: string[] }>({
      system: BRIEF_SYSTEM,
      prompt,
      schema: BRIEF_SCHEMA,
      temperature: 0.2,
    });
    const qs = (res.probe_questions ?? []).filter(Boolean).slice(0, 3);
    if (sentenceCount(res.brief) === 3 && qs.length >= 2) return { brief: res.brief.trim(), probe_questions: qs };
    if (attempt === 1) return { brief: res.brief.trim(), probe_questions: qs };
  }
  throw new Error("unreachable");
}

// --------------------------------------------------------------------
// Email draft
// --------------------------------------------------------------------
const EMAIL_SYSTEM = `You draft emails from Arjun Mehta, Founder of Kargo, a Series A logistics SaaS company in Mumbai, to job applicants. You never know the candidate's real name: always write the placeholder [NAME] where the name goes (e.g. "Hi [NAME],") and [ROLE] where the role title goes. Do not use any other square-bracket placeholder - never write [CANDIDATE], [EMAIL], [PHONE], [LINK] or [INSTITUTION]; if the CV text has one, write around it. Plain, warm, human English. No emojis, no corporate filler, no scoring details, no numbers from the rubric. Under 150 words. Sign off exactly:\nArjun Mehta\nFounder, Kargo`;

const EMAIL_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: { body: { type: Type.STRING } },
  required: ["body"],
};

const INVITE_BRIEF = `Write an INTERVIEW INVITATION.
- Warm and specific: reference exactly ONE concrete thing from their CV that stood out (a task, number or result from the evidence below).
- Ask them to reply with 2-3 time slots that work for a 45-minute conversation this week.
- Say it is for the [ROLE] role.`;

const REJECTION_BRIEF = `Write a REJECTION.
- Kind, human and brief. Include one genuine, specific line about their background (from the evidence below) so it does not feel automated.
- Honestly acknowledge that it has taken a while to get back to them, and thank them for their patience.
- Say clearly that Kargo will not be moving forward for the [ROLE] role. No false promises ("we'll keep you on file", "future roles") and no detailed feedback on scoring.`;

export const SUBJECTS: Record<EmailType, string> = {
  invite: "Kargo - interview for [ROLE]",
  rejection: "Your application to Kargo",
};

function wordCount(s: string): number {
  return s.trim().split(/\s+/).length;
}

const BAD_PLACEHOLDER = /\[(?!NAME\]|ROLE\])[A-Z_ ]+\]/;

export async function generateEmail(input: {
  type: EmailType;
  role: Role;
  scores: ScoreForPrompt[];
}): Promise<{ subject: string; body: string }> {
  const strongest = [...input.scores]
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score * b.weight - a.score * a.weight)
    .slice(0, 3);
  const prompt = [
    input.type === "invite" ? INVITE_BRIEF : REJECTION_BRIEF,
    "",
    "Things from their CV you may reference (pick one):",
    strongest.length
      ? strongest.map((s) => `- "${s.evidence_quote}"`).join("\n")
      : "- (the CV has little specific evidence; reference their general background in one honest line)",
    "",
    'Return JSON: {"body": "..."} - the plain-text email body only, starting with "Hi [NAME],". No subject line.',
  ].join("\n");

  let body = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await generateJson<{ body: string }>({ system: EMAIL_SYSTEM, prompt, schema: EMAIL_SCHEMA, temperature: 0.4 });
    body = (res.body ?? "").trim();
    if (body.includes("[NAME]") && !BAD_PLACEHOLDER.test(body) && wordCount(body) <= 150) break;
  }
  if (!body) throw new Error("Email draft came back empty");
  return { subject: SUBJECTS[input.type], body };
}
