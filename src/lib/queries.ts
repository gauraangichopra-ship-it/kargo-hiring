import "server-only";
import { isUuid, maybeOne, query } from "./db";
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
  return query<Criterion>("select * from rubric_criteria order by role, sort_order");
}

export async function loadDashboard(): Promise<{ rows: DashboardRow[]; criteria: Criterion[] }> {
  const [raw, criteria] = await Promise.all([
    query<RawCandidate>(
      `select c.id, c.created_at, c.applied_role, c.file_name, c.status, c.error_message, c.founder_decision,
         (select json_build_object('full_name', p.full_name, 'email', p.email)
            from candidate_pii p where p.candidate_id = c.id) as candidate_pii,
         coalesce((select json_agg(json_build_object('role', t.role, 'weighted_total', t.weighted_total,
                     'rank_in_role', t.rank_in_role, 'recommended', t.recommended))
            from score_totals t where t.candidate_id = c.id), '[]') as score_totals,
         coalesce((select json_agg(json_build_object('role', s.role, 'criterion_id', s.criterion_id,
                     'score', s.score, 'quote_verified', s.quote_verified))
            from scores s where s.candidate_id = c.id), '[]') as scores,
         coalesce((select json_agg(json_build_object('id', e.id, 'status', e.status, 'email_type', e.email_type))
            from emails e where e.candidate_id = c.id and e.role = c.applied_role), '[]') as emails
       from candidates c
       order by c.created_at desc`,
    ),
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
  if (!isUuid(id)) return null;
  const c = await maybeOne<{
    id: string;
    applied_role: Role;
    file_name: string;
    status: CandidateStatus;
    error_message: string | null;
    founder_decision: "invite" | "reject" | null;
  }>("select * from candidates where id = $1", [id]);
  if (!c) return null;

  const [pii, content, totals, scoreRows, brief, email, criteria] = await Promise.all([
    maybeOne<NonNullable<CandidateDetail["pii"]>>(
      "select full_name, email, phone, location, links from candidate_pii where candidate_id = $1",
      [id],
    ),
    maybeOne<{ cv_text_redacted: string }>("select cv_text_redacted from candidate_content where candidate_id = $1", [id]),
    query<TotalRow>("select role, weighted_total, rank_in_role, recommended from score_totals where candidate_id = $1", [id]),
    query<{ role: Role; criterion_id: string; score: number; evidence_quote: string; reasoning: string; quote_verified: boolean }>(
      "select role, criterion_id, score, evidence_quote, reasoning, quote_verified from scores where candidate_id = $1",
      [id],
    ),
    maybeOne<{ brief_text: string; probe_questions: string[] }>(
      "select brief_text, probe_questions from briefs where candidate_id = $1 and role = $2",
      [id, c.applied_role],
    ),
    maybeOne<EmailRow>("select * from emails where candidate_id = $1 and role = $2", [id, c.applied_role]),
    loadCriteria(),
  ]);

  return {
    id: c.id,
    appliedRole: c.applied_role,
    fileName: c.file_name,
    status: c.status,
    error: c.error_message,
    decision: c.founder_decision,
    pii,
    cvRedacted: content?.cv_text_redacted ?? null,
    totals,
    scores: criteria
      .map((k) => {
        const s = scoreRows.find((x) => x.criterion_id === k.id);
        return s ? { ...s, criterion: k } : null;
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x)),
    brief,
    email,
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
  const rows = await query<{
    id: string;
    candidate_id: string;
    role: Role;
    email_type: EmailType;
    subject: string;
    status: EmailStatus;
    error_message: string | null;
    full_name: string | null;
    weighted_total: number | null;
    recommended: Recommendation | null;
  }>(
    `select e.id, e.candidate_id, e.role, e.email_type, e.subject, e.status, e.error_message,
            p.full_name, t.weighted_total, t.recommended
       from emails e
       left join candidate_pii p on p.candidate_id = e.candidate_id
       left join score_totals t on t.candidate_id = e.candidate_id and t.role = e.role
      where e.status in ('draft', 'failed')`,
  );
  return rows
    .map((e): BulkRow => {
      return {
        emailId: e.id,
        candidateId: e.candidate_id,
        name: e.full_name || "(no name found)",
        hasName: Boolean(e.full_name),
        appliedRole: e.role,
        emailType: e.email_type,
        subject: e.subject,
        status: e.status,
        error: e.error_message,
        total: e.weighted_total,
        recommended: e.recommended,
      };
    })
    .sort((a, b) => (b.total ?? 0) - (a.total ?? 0));
}
