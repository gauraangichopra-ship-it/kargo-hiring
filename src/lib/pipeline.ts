import "server-only";
import { Type } from "@google/genai";
import { CONFIRM_NAME_WITH_AI } from "./config";
import { generateBrief, generateEmail } from "./drafts";
import { generateJson } from "./gemini";
import { extractText } from "./parse";
import { extractPii, findLeaks, redact, type Pii } from "./pii";
import { loadRubric } from "./rubric";
import { rankPool } from "./scoring-core";
import { scoreForRole, type RoleScore } from "./scoring";
import { db, must } from "./supabase";
import { ROLES, type EmailType, type Recommendation, type Role } from "./types";

export type ProcessResult =
  | { status: "scored"; candidateId: string }
  | { status: "duplicate"; candidateId: string }
  | { status: "error"; candidateId: string | null; error: string };

async function setStatus(id: string, status: string, error_message: string | null = null) {
  must(await db().from("candidates").update({ status, error_message }).eq("id", id));
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function saveScores(id: string, results: RoleScore[]) {
  for (const r of results) {
    must(
      await db()
        .from("scores")
        .upsert(
          r.scores.map((s) => ({
            candidate_id: id,
            role: r.role,
            criterion_id: s.criterion_id,
            score: s.score,
            evidence_quote: s.evidence_quote,
            reasoning: s.reasoning,
            quote_verified: s.quote_verified,
          })),
          { onConflict: "candidate_id,role,criterion_id" },
        ),
    );
    must(
      await db()
        .from("score_totals")
        .upsert({ candidate_id: id, role: r.role, weighted_total: r.weighted_total }, { onConflict: "candidate_id,role" }),
    );
  }
}

// Optional and off by default - see CONFIRM_NAME_WITH_AI in config.ts.
async function confirmName(text: string, pii: Pii): Promise<string | null> {
  const head = text.split("\n").filter((l) => l.trim()).slice(0, 3).join("\n");
  const stripped = redact(head, { ...pii, full_name: null });
  const res = await generateJson<{ full_name: string }>({
    system: "Return the person's full name from the top of this CV. If there is no name, return an empty string.",
    prompt: stripped,
    schema: { type: Type.OBJECT, properties: { full_name: { type: Type.STRING } }, required: ["full_name"] },
  });
  return res.full_name?.trim() || null;
}

// Structured summary of the redacted CV (no institution names).
async function extractStructure(cvRedacted: string) {
  return generateJson<Record<string, unknown>>({
    system:
      "Extract a structured summary of this anonymised CV. Use only what is written. Never include institution names (write the degree only), personal names, or contact details.",
    prompt: cvRedacted,
    schema: {
      type: Type.OBJECT,
      properties: {
        work_history: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              company: { type: Type.STRING },
              period: { type: Type.STRING },
              highlights: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ["title", "company", "period", "highlights"],
          },
        },
        achievements: { type: Type.ARRAY, items: { type: Type.STRING } },
        education: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: { degree: { type: Type.STRING }, year: { type: Type.STRING } },
            required: ["degree", "year"],
          },
        },
      },
      required: ["work_history", "achievements", "education"],
    },
  });
}

// ---------------------------------------------------------------------
// Steps CONTEXT + PROCESSING for one file.
// ---------------------------------------------------------------------
export async function processFile(fileName: string, buf: Buffer, appliedRole: Role): Promise<ProcessResult> {
  // a) extract text - nothing is stored until we know it's not a duplicate
  let text: string;
  try {
    text = await extractText(fileName, buf);
  } catch (err) {
    const row = must<{ id: string }>(
      await db()
        .from("candidates")
        .insert({ applied_role: appliedRole, file_name: fileName, status: "error", error_message: message(err) })
        .select("id")
        .single(),
    );
    return { status: "error", candidateId: row.id, error: message(err) };
  }

  // b) deterministic PII extraction
  const pii = extractPii(text);

  // Skip duplicates: same file name + same extracted email.
  if (pii.email) {
    const dupes = must<{ id: string; candidate_pii: { email: string | null } | null }[]>(
      await db()
        .from("candidates")
        .select("id, candidate_pii!inner(email)")
        .eq("file_name", fileName)
        .ilike("candidate_pii.email", pii.email),
    );
    if (dupes.length) return { status: "duplicate", candidateId: dupes[0].id };
  }

  const cand = must<{ id: string }>(
    await db()
      .from("candidates")
      .insert({ applied_role: appliedRole, file_name: fileName, status: "uploaded" })
      .select("id")
      .single(),
  );
  const id = cand.id;

  try {
    if (CONFIRM_NAME_WITH_AI) {
      const confirmed = await confirmName(text, pii).catch(() => null);
      if (confirmed) pii.full_name = confirmed;
    }

    // c) redact
    const cvRedacted = redact(text, pii);

    // d) store PII and redacted content separately
    must(
      await db().from("candidate_pii").insert({
        candidate_id: id,
        full_name: pii.full_name,
        email: pii.email,
        phone: pii.phone,
        location: pii.location,
        links: pii.links,
      }),
    );

    // e) hard stop before ANY AI call on content if PII survived redaction
    const leaks = findLeaks(cvRedacted, pii);
    if (leaks.length) {
      must(await db().from("candidate_content").insert({ candidate_id: id, cv_text_redacted: "[withheld: redaction failed]" }));
      await setStatus(id, "error", `Redaction check failed (${leaks.join(", ")} still present). Not sent to AI.`);
      return { status: "error", candidateId: id, error: `Redaction check failed: ${leaks.join(", ")}` };
    }
    if (!pii.full_name) {
      // Not a leak, but the email can't be personalised - surface it.
      console.warn(`[pipeline] no name found for ${fileName}`);
    }

    const extracted = await extractStructure(cvRedacted).catch(() => null);
    must(
      await db().from("candidate_content").insert({
        candidate_id: id,
        cv_text_redacted: cvRedacted,
        extracted_json: extracted,
      }),
    );
    await setStatus(id, "extracted");

    // PROCESSING: score against BOTH rubrics
    const rubric = await loadRubric();
    const results = await Promise.all(ROLES.map((role) => scoreForRole(cvRedacted, role, rubric)));

    await saveScores(id, results);
    await setStatus(id, "scored");
    return { status: "scored", candidateId: id };
  } catch (err) {
    await setStatus(id, "error", message(err)).catch(() => {});
    return { status: "error", candidateId: id, error: message(err) };
  }
}

// Re-run scoring for a candidate stuck in 'error' (used by the Retry button).
export async function rescoreCandidate(id: string): Promise<ProcessResult> {
  const content = must<{ cv_text_redacted: string } | null>(
    await db().from("candidate_content").select("cv_text_redacted").eq("candidate_id", id).maybeSingle(),
  );
  const pii = must<Pii | null>(await db().from("candidate_pii").select("*").eq("candidate_id", id).maybeSingle());
  if (!content || !pii || content.cv_text_redacted.startsWith("[withheld")) {
    return { status: "error", candidateId: id, error: "No safe CV text stored - upload the file again." };
  }
  const leaks = findLeaks(content.cv_text_redacted, {
    ...pii,
    links: (pii.links as string[]) ?? [],
    allEmails: pii.email ? [pii.email] : [],
    allPhones: pii.phone ? [pii.phone] : [],
  });
  if (leaks.length) return { status: "error", candidateId: id, error: `Redaction check failed: ${leaks.join(", ")}` };
  try {
    const rubric = await loadRubric();
    const results = await Promise.all(ROLES.map((role) => scoreForRole(content.cv_text_redacted, role, rubric)));
    await saveScores(id, results);
    await setStatus(id, "scored");
    return { status: "scored", candidateId: id };
  } catch (err) {
    await setStatus(id, "error", message(err)).catch(() => {});
    return { status: "error", candidateId: id, error: message(err) };
  }
}

// ---------------------------------------------------------------------
// Ranking: recompute rank + recommendation for every applied-role pool.
// Returns the candidates whose drafts are missing or out of date.
// ---------------------------------------------------------------------
type CandidateLite = {
  id: string;
  applied_role: Role;
  status: string;
  founder_decision: "invite" | "reject" | null;
};

export function desiredEmailType(recommended: Recommendation | null, decision: CandidateLite["founder_decision"]): EmailType {
  if (decision) return decision === "invite" ? "invite" : "rejection";
  return recommended === "invite" ? "invite" : "rejection";
}

export async function rankAll(): Promise<{ needsDraft: string[] }> {
  const cands = must<CandidateLite[]>(
    await db().from("candidates").select("id, applied_role, status, founder_decision").neq("status", "error"),
  );
  const totals = must<{ candidate_id: string; role: Role; weighted_total: number }[]>(
    await db().from("score_totals").select("candidate_id, role, weighted_total"),
  );
  const emails = must<{ candidate_id: string; email_type: EmailType; status: string; edited_by_founder: boolean }[]>(
    await db().from("emails").select("candidate_id, email_type, status, edited_by_founder"),
  );
  const briefs = must<{ candidate_id: string }[]>(await db().from("briefs").select("candidate_id"));

  const recs = new Map<string, Recommendation>();
  for (const role of ROLES) {
    const pool = cands
      .filter((c) => c.applied_role === role)
      .map((c) => totals.find((t) => t.candidate_id === c.id && t.role === role))
      .filter((t): t is NonNullable<typeof t> => Boolean(t))
      .map((t) => ({ candidate_id: t.candidate_id, weighted_total: Number(t.weighted_total) }));
    const ranked = rankPool(pool);
    for (const r of ranked) {
      recs.set(r.candidate_id, r.recommended);
      must(
        await db()
          .from("score_totals")
          .update({ rank_in_role: r.rank, recommended: r.recommended })
          .eq("candidate_id", r.candidate_id)
          .eq("role", role),
      );
    }
  }

  const needsDraft: string[] = [];
  for (const c of cands) {
    const rec = recs.get(c.id);
    if (!rec) continue; // not scored yet
    const email = emails.find((e) => e.candidate_id === c.id);
    const wantType = desiredEmailType(rec, c.founder_decision);
    const needsBrief = rec !== "reject" && !briefs.some((b) => b.candidate_id === c.id);
    const emailStale =
      !email || (email.status !== "sent" && email.status !== "sending" && !email.edited_by_founder && email.email_type !== wantType);
    if (needsBrief || emailStale) needsDraft.push(c.id);
  }
  return { needsDraft };
}

// ---------------------------------------------------------------------
// AI step: brief (invite/review) + email draft (everyone), for applied role.
// ---------------------------------------------------------------------
async function scoresForPrompt(candidateId: string, role: Role) {
  const rows = must<
    { score: number; evidence_quote: string; reasoning: string; rubric_criteria: { criterion_name: string; weight: number; sort_order: number } }[]
  >(
    await db()
      .from("scores")
      .select("score, evidence_quote, reasoning, rubric_criteria(criterion_name, weight, sort_order)")
      .eq("candidate_id", candidateId)
      .eq("role", role),
  );
  return rows
    .sort((a, b) => a.rubric_criteria.sort_order - b.rubric_criteria.sort_order)
    .map((r) => ({
      criterion_name: r.rubric_criteria.criterion_name,
      weight: r.rubric_criteria.weight,
      score: r.score,
      evidence_quote: r.evidence_quote,
      reasoning: r.reasoning,
    }));
}

export async function draftFor(candidateId: string, opts: { forceEmail?: boolean } = {}) {
  const c = must<CandidateLite>(
    await db().from("candidates").select("id, applied_role, status, founder_decision").eq("id", candidateId).single(),
  );
  const role = c.applied_role;
  const total = must<{ weighted_total: number; rank_in_role: number | null; recommended: Recommendation | null } | null>(
    await db()
      .from("score_totals")
      .select("weighted_total, rank_in_role, recommended")
      .eq("candidate_id", candidateId)
      .eq("role", role)
      .maybeSingle(),
  );
  if (!total) throw new Error("Candidate has not been scored yet");
  const content = must<{ cv_text_redacted: string }>(
    await db().from("candidate_content").select("cv_text_redacted").eq("candidate_id", candidateId).single(),
  );
  const scores = await scoresForPrompt(candidateId, role);

  const wantType = desiredEmailType(total.recommended, c.founder_decision);
  const wantsBrief = total.recommended !== "reject" || c.founder_decision === "invite";

  if (wantsBrief) {
    const existing = must<{ candidate_id: string } | null>(
      await db().from("briefs").select("candidate_id").eq("candidate_id", candidateId).eq("role", role).maybeSingle(),
    );
    if (!existing) {
      const b = await generateBrief({
        role,
        cvRedacted: content.cv_text_redacted,
        scores,
        weightedTotal: Number(total.weighted_total),
        rank: total.rank_in_role,
      });
      must(
        await db()
          .from("briefs")
          .upsert({ candidate_id: candidateId, role, brief_text: b.brief, probe_questions: b.probe_questions }, { onConflict: "candidate_id,role" }),
      );
    }
  }

  const email = must<{ id: string; email_type: EmailType; status: string; edited_by_founder: boolean } | null>(
    await db().from("emails").select("id, email_type, status, edited_by_founder").eq("candidate_id", candidateId).eq("role", role).maybeSingle(),
  );
  if (email && (email.status === "sent" || email.status === "sending")) return;
  const regenerate =
    !email || opts.forceEmail || (!email.edited_by_founder && email.email_type !== wantType);
  if (regenerate) {
    const draft = await generateEmail({ type: wantType, role, scores });
    must(
      await db()
        .from("emails")
        .upsert(
          {
            candidate_id: candidateId,
            role,
            email_type: wantType,
            subject: draft.subject,
            body_with_placeholders: draft.body,
            status: "draft",
            error_message: null,
            edited_by_founder: false,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "candidate_id,role" },
        ),
    );
  }
  if (c.status !== "sent") await setStatus(candidateId, "drafted");
}
