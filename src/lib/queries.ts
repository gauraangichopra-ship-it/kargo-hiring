import "server-only";
import { db, must } from "./supabase";
import type { CandidateStatus, Criterion, EmailRow, EmailStatus, EmailType, Recommendation, Role } from "./types";

type TotalRow = { role: Role; weighted_total: number; rank_in_role: number | null; recommended: Recommendation | null };
type ScoreLite = { role: Role; criterion_id: string; score: number; quote_verified: boolean };

type RawCandidate = {
  id: string;
  created_at: string;
  applied_role: Role;
  file_name: string;
  status: CandidateStatus;
  error_message: string | null;
  founder_decision: "invite" | "reject" | null;
  candidate_pii: { full_name: string | null; email: string | null } | null;
  score_totals: TotalRow[];
  scores: ScoreLite[];
  emails: { id: string; status: EmailStatus; email_type: EmailType }[];
};

export type DashboardRow = {
  id: string;
  name: string;
  fileName: string;
  appliedRole: Role;
  status: CandidateStatus;
  error: string | null;
  rank: number | null;
  total: number | null;
  otherTotal: number | null;
  recommended: Recommendation | null;
  decision: "invite" | "reject" | null;
  criteria: { name: string; score: number; weight: number; verified: boolean }[];
  emailId: string | null;
  emailStatus: EmailStatus | null;
  emailType: EmailType | null;
};

export async function loadCriteria(): Promise<Criterion[]> {
  return must<Criterion[]>(await db().from("rubric_criteria").select("*").order("sort_order"));
}

export async function loadDashboard(): Promise<{ rows: DashboardRow[]; criteria: Criterion[] }> {
  const [raw, criteria] = await Promise.all([
    db()
      .from("candidates")
      .select(
        "id, created_at, applied_role, file_name, status, error_message, founder_decision," +
          "candidate_pii(full_name, email)," +
          "score_totals(role, weighted_total, rank_in_role, recommended)," +
          "scores(role, criterion_id, score, quote_verified)," +
          "emails(id, status, email_type)",
      )
      .order("created_at", { ascending: false })
      .then((r) => must<RawCandidate[]>(r)),
    loadCriteria(),
  ]);

  const rows = raw.map((c): DashboardRow => {
    const other: Role = c.applied_role === "PM" ? "SPM" : "PM";
    const own = c.score_totals.find((t) => t.role === c.applied_role);
    const cross = c.score_totals.find((t) => t.role === other);
    const email = c.emails[0];
    return {
      id: c.id,
      name: c.candidate_pii?.full_name || c.file_name,
      fileName: c.file_name,
      appliedRole: c.applied_role,
      status: c.status,
      error: c.error_message,
      rank: own?.rank_in_role ?? null,
      total: own ? Number(own.weighted_total) : null,
      otherTotal: cross ? Number(cross.weighted_total) : null,
      recommended: own?.recommended ?? null,
      decision: c.founder_decision,
      criteria: criteria
        .filter((k) => k.role === c.applied_role)
        .map((k) => {
          const s = c.scores.find((x) => x.role === c.applied_role && x.criterion_id === k.id);
          return { name: k.criterion_name, score: s?.score ?? 0, weight: k.weight, verified: s?.quote_verified ?? true };
        }),
      emailId: email?.id ?? null,
      emailStatus: email?.status ?? null,
      emailType: email?.email_type ?? null,
    };
  });
  return { rows, criteria };
}

export type CandidateDetail = {
  id: string;
  appliedRole: Role;
  fileName: string;
  status: CandidateStatus;
  error: string | null;
  decision: "invite" | "reject" | null;
  pii: { full_name: string | null; email: string | null; phone: string | null; location: string | null; links: string[] } | null;
  cvRedacted: string | null;
  totals: TotalRow[];
  scores: {
    role: Role;
    criterion: Criterion;
    score: number;
    evidence_quote: string;
    reasoning: string;
    quote_verified: boolean;
  }[];
  brief: { brief_text: string; probe_questions: string[] } | null;
  email: EmailRow | null;
};

export async function loadCandidate(id: string): Promise<CandidateDetail | null> {
  const c = must<{
    id: string;
    applied_role: Role;
    file_name: string;
    status: CandidateStatus;
    error_message: string | null;
    founder_decision: "invite" | "reject" | null;
  } | null>(await db().from("candidates").select("*").eq("id", id).maybeSingle());
  if (!c) return null;

  const [pii, content, totals, scores, brief, email, criteria] = await Promise.all([
    db().from("candidate_pii").select("*").eq("candidate_id", id).maybeSingle(),
    db().from("candidate_content").select("cv_text_redacted").eq("candidate_id", id).maybeSingle(),
    db().from("score_totals").select("role, weighted_total, rank_in_role, recommended").eq("candidate_id", id),
    db().from("scores").select("role, criterion_id, score, evidence_quote, reasoning, quote_verified").eq("candidate_id", id),
    db().from("briefs").select("brief_text, probe_questions").eq("candidate_id", id).eq("role", c.applied_role).maybeSingle(),
    db().from("emails").select("*").eq("candidate_id", id).eq("role", c.applied_role).maybeSingle(),
    loadCriteria(),
  ]);

  const scoreRows = must<{ role: Role; criterion_id: string; score: number; evidence_quote: string; reasoning: string; quote_verified: boolean }[]>(scores);
  return {
    id: c.id,
    appliedRole: c.applied_role,
    fileName: c.file_name,
    status: c.status,
    error: c.error_message,
    decision: c.founder_decision,
    pii: must(pii),
    cvRedacted: must<{ cv_text_redacted: string } | null>(content)?.cv_text_redacted ?? null,
    totals: must<TotalRow[]>(totals).map((t) => ({ ...t, weighted_total: Number(t.weighted_total) })),
    scores: criteria
      .map((k) => {
        const s = scoreRows.find((x) => x.criterion_id === k.id);
        return s ? { ...s, criterion: k } : null;
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x)),
    brief: must(brief),
    email: must(email),
  };
}

export type BulkRow = {
  emailId: string;
  candidateId: string;
  name: string;
  appliedRole: Role;
  emailType: EmailType;
  subject: string;
  status: EmailStatus;
  error: string | null;
  total: number | null;
  recommended: Recommendation | null;
  hasName: boolean;
};

export async function loadUnsent(): Promise<BulkRow[]> {
  const rows = must<
    {
      id: string;
      candidate_id: string;
      role: Role;
      email_type: EmailType;
      subject: string;
      status: EmailStatus;
      error_message: string | null;
      candidates: {
        candidate_pii: { full_name: string | null } | null;
        score_totals: TotalRow[];
      } | null;
    }[]
  >(
    await db()
      .from("emails")
      .select(
        "id, candidate_id, role, email_type, subject, status, error_message," +
          "candidates(candidate_pii(full_name), score_totals(role, weighted_total, rank_in_role, recommended))",
      )
      .in("status", ["draft", "failed"]),
  );
  return rows
    .map((e) => {
      const t = e.candidates?.score_totals.find((x) => x.role === e.role);
      return {
        emailId: e.id,
        candidateId: e.candidate_id,
        name: e.candidates?.candidate_pii?.full_name || "(no name found)",
        hasName: Boolean(e.candidates?.candidate_pii?.full_name),
        appliedRole: e.role,
        emailType: e.email_type,
        subject: e.subject,
        status: e.status,
        error: e.error_message,
        total: t ? Number(t.weighted_total) : null,
        recommended: t?.recommended ?? null,
      };
    })
    .sort((a, b) => (b.total ?? 0) - (a.total ?? 0));
}
