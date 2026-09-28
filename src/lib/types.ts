export type Role = "PM" | "SPM";
export const ROLES: Role[] = ["PM", "SPM"];

export const ROLE_TITLE: Record<Role, string> = {
  PM: "Product Manager",
  SPM: "Senior Product Manager",
};

export type Recommendation = "invite" | "review" | "reject";
export type EmailType = "invite" | "rejection";
export type CandidateStatus = "uploaded" | "extracted" | "scored" | "drafted" | "sent" | "error";
export type EmailStatus = "draft" | "sending" | "sent" | "failed";

export type Criterion = {
  id: string;
  role: Role;
  criterion_name: string;
  description: string;
  weight: number;
  sort_order: number;
};

export type ScoreRow = {
  candidate_id: string;
  role: Role;
  criterion_id: string;
  score: number;
  evidence_quote: string;
  reasoning: string;
  quote_verified: boolean;
};

export type EmailRow = {
  id: string;
  candidate_id: string;
  role: Role;
  email_type: EmailType;
  subject: string;
  body_with_placeholders: string;
  status: EmailStatus;
  error_message: string | null;
  sent_at: string | null;
  resend_message_id: string | null;
  edited_by_founder: boolean;
  updated_at: string;
};
