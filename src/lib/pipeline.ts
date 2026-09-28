import "server-only";
import { Type } from "@google/genai";
import { CONFIRM_NAME_WITH_AI } from "./config";
import { isUuid, maybeOne, one, query, tx } from "./db";
import { generateBrief, generateEmail } from "./drafts";
import { generateJson } from "./gemini";
import { extractText } from "./parse";
import { extractPii, findLeaks, redact, type Pii } from "./pii";
import { loadRubric } from "./rubric";
import { rankPool } from "./scoring-core";
import { scoreForRole, type RoleScore } from "./scoring";
import { ROLES, type EmailType, type Recommendation, type Role } from "./types";

export type ProcessResult =
  | { status: "scored"; candidateId: string }
  | { status: "duplicate"; candidateId: string }
  | { status: "error"; candidateId: string | null; error: string };

async function setStatus(id: string, status: string, error_message: string | null = null) {
  await query("update candidates set status = $2, error_message = $3 where id = $1", [id, status, error_message]);
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Scores + total for both roles, in one transaction.
async function saveScores(id: string, results: RoleScore[]) {
  await tx(async (c) => {
    for (const r of results) {
      for (const s of r.scores) {
        await c.query(
          `insert into scores (candidate_id, role, criterion_id, score, evidence_quote, reasoning, quote_verified)
           values ($1, $2, $3, $4, $5, $6, $7)
           on conflict (candidate_id, role, criterion_id) do update set
             score = excluded.score, evidence_quote = excluded.evidence_quote,
             reasoning = excluded.reasoning, quote_verified = excluded.quote_verified`,
          [id, r.role, s.criterion_id, s.score, s.evidence_quote, s.reasoning, s.quote_verified],
        );
      }
      await c.query(
        `insert into score_totals (candidate_id, role, weighted_total) values ($1, $2, $3)
         on conflict (candidate_id, role) do update set weighted_total = excluded.weighted_total`,
        [id, r.role, r.weighted_total],
      );
    }
  });
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
    const row = await one<{ id: string }>(
      `insert into candidates (applied_role, file_name, status, error_message)
       values ($1, $2, 'error', $3) returning id`,
      [appliedRole, fileName, message(err)],
    );
    return { status: "error", candidateId: row.id, error: message(err) };
  }

  // b) deterministic PII extraction
  const pii = extractPii(text);

  // Skip duplicates: same file name + same extracted email.
  if (pii.email) {
    const dupes = await query<{ id: string }>(
      `select c.id from candidates c join candidate_pii p on p.candidate_id = c.id
        where c.file_name = $1 and lower(p.email) = lower($2) limit 1`,
      [fileName, pii.email],
    );
    if (dupes.length) return { status: "duplicate", candidateId: dupes[0].id };
  }

  const cand = await one<{ id: string }>(
    "insert into candidates (applied_role, file_name, status) values ($1, $2, 'uploaded') returning id",
    [appliedRole, fileName],
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
    await query(
      `insert into candidate_pii (candidate_id, full_name, email, phone, location, links)
       values ($1, $2, $3, $4, $5, $6)`,
      [id, pii.full_name, pii.email, pii.phone, pii.location, JSON.stringify(pii.links)],
    );

    // e) hard stop before ANY AI call on content if PII survived redaction
    const leaks = findLeaks(cvRedacted, pii);
    if (leaks.length) {
      await query("insert into candidate_content (candidate_id, cv_text_redacted) values ($1, $2)", [
        id,
        "[withheld: redaction failed]",
      ]);
      await setStatus(id, "error", `Redaction check failed (${leaks.join(", ")} still present). Not sent to AI.`);
      return { status: "error", candidateId: id, error: `Redaction check failed: ${leaks.join(", ")}` };
    }
    if (!pii.full_name) {
      // Not a leak, but the email can't be personalised - surface it.
      console.warn(`[pipeline] no name found for ${fileName}`);
    }

    const extracted = await extractStructure(cvRedacted).catch(() => null);
    await query("insert into candidate_content (candidate_id, cv_text_redacted, extracted_json) values ($1, $2, $3)", [
      id,
      cvRedacted,
      extracted ? JSON.stringify(extracted) : null,
    ]);
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
  if (!isUuid(id)) return { status: "error", candidateId: null, error: "Unknown candidate" };
  const content = await maybeOne<{ cv_text_redacted: string }>(
    "select cv_text_redacted from candidate_content where candidate_id = $1",
    [id],
  );
  const pii = await maybeOne<Pii>("select * from candidate_pii where candidate_id = $1", [id]);
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
  const [cands, totals, emails, briefs] = await Promise.all([
    query<CandidateLite>("select id, applied_role, status, founder_decision from candidates where status <> 'error'"),
    query<{ candidate_id: string; role: Role; weighted_total: number }>(
      "select candidate_id, role, weighted_total from score_totals",
    ),
    query<{ candidate_id: string; email_type: EmailType; status: string; edited_by_founder: boolean }>(
      "select candidate_id, email_type, status, edited_by_founder from emails",
    ),
    query<{ candidate_id: string }>("select candidate_id from briefs"),
  ]);

  const recs = new Map<string, Recommendation>();
  const updates: { id: string; role: Role; rank: number; rec: Recommendation }[] = [];
  for (const role of ROLES) {
    const pool = cands
      .filter((c) => c.applied_role === role)
      .map((c) => totals.find((t) => t.candidate_id === c.id && t.role === role))
      .filter((t): t is NonNullable<typeof t> => Boolean(t))
      .map((t) => ({ candidate_id: t.candidate_id, weighted_total: Number(t.weighted_total) }));
    const ranked = rankPool(pool);
    for (const r of ranked) {
      recs.set(r.candidate_id, r.recommended);
      updates.push({ id: r.candidate_id, role, rank: r.rank, rec: r.recommended });
    }
  }
  // One statement for the whole ranking.
  if (updates.length) {
    await query(
      `update score_totals t set rank_in_role = u.rank, recommended = u.rec
         from unnest($1::uuid[], $2::text[], $3::int[], $4::text[]) as u(id, role, rank, rec)
        where t.candidate_id = u.id and t.role = u.role`,
      [updates.map((u) => u.id), updates.map((u) => u.role), updates.map((u) => u.rank), updates.map((u) => u.rec)],
    );
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
  return query<{ criterion_name: string; weight: number; score: number; evidence_quote: string; reasoning: string }>(
    `select k.criterion_name, k.weight, s.score, s.evidence_quote, s.reasoning
       from scores s join rubric_criteria k on k.id = s.criterion_id
      where s.candidate_id = $1 and s.role = $2
      order by k.sort_order`,
    [candidateId, role],
  );
}

export async function draftFor(candidateId: string, opts: { forceEmail?: boolean } = {}) {
  if (!isUuid(candidateId)) throw new Error("Unknown candidate");
  const c = await one<CandidateLite>("select id, applied_role, status, founder_decision from candidates where id = $1", [
    candidateId,
  ]);
  const role = c.applied_role;
  const total = await maybeOne<{ weighted_total: number; rank_in_role: number | null; recommended: Recommendation | null }>(
    "select weighted_total, rank_in_role, recommended from score_totals where candidate_id = $1 and role = $2",
    [candidateId, role],
  );
  if (!total) throw new Error("Candidate has not been scored yet");
  const content = await one<{ cv_text_redacted: string }>(
    "select cv_text_redacted from candidate_content where candidate_id = $1",
    [candidateId],
  );
  const scores = await scoresForPrompt(candidateId, role);

  const wantType = desiredEmailType(total.recommended, c.founder_decision);
  const wantsBrief = total.recommended !== "reject" || c.founder_decision === "invite";

  if (wantsBrief) {
    const existing = await maybeOne("select 1 from briefs where candidate_id = $1 and role = $2", [candidateId, role]);
    if (!existing) {
      const b = await generateBrief({
        role,
        cvRedacted: content.cv_text_redacted,
        scores,
        weightedTotal: Number(total.weighted_total),
        rank: total.rank_in_role,
      });
      await query(
        `insert into briefs (candidate_id, role, brief_text, probe_questions) values ($1, $2, $3, $4)
         on conflict (candidate_id, role) do update set
           brief_text = excluded.brief_text, probe_questions = excluded.probe_questions, created_at = now()`,
        [candidateId, role, b.brief, JSON.stringify(b.probe_questions)],
      );
    }
  }

  const email = await maybeOne<{ id: string; email_type: EmailType; status: string; edited_by_founder: boolean }>(
    "select id, email_type, status, edited_by_founder from emails where candidate_id = $1 and role = $2",
    [candidateId, role],
  );
  if (email && (email.status === "sent" || email.status === "sending")) return;
  const regenerate =
    !email || opts.forceEmail || (!email.edited_by_founder && email.email_type !== wantType);
  if (regenerate) {
    const draft = await generateEmail({ type: wantType, role, scores });
    // The WHERE on the conflict branch means a sent email can never be overwritten.
    await query(
      `insert into emails (candidate_id, role, email_type, subject, body_with_placeholders, status)
       values ($1, $2, $3, $4, $5, 'draft')
       on conflict (candidate_id, role) do update set
         email_type = excluded.email_type, subject = excluded.subject,
         body_with_placeholders = excluded.body_with_placeholders, status = 'draft',
         error_message = null, edited_by_founder = false, updated_at = now()
       where emails.status in ('draft', 'failed')`,
      [candidateId, role, wantType, draft.subject, draft.body],
    );
  }
  if (c.status !== "sent") await setStatus(candidateId, "drafted");
}
