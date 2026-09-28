import type { EmailStatus, EmailType, Recommendation } from "@/lib/types";

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl bg-white shadow-sm ring-1 ring-kargo/10 ${className}`}>{children}</div>;
}

const REC_STYLE: Record<Recommendation, string> = {
  invite: "bg-kargo text-white",
  review: "bg-amber-100 text-amber-900 ring-1 ring-amber-300",
  reject: "bg-stone-100 text-stone-600",
};
const REC_LABEL: Record<Recommendation, string> = {
  invite: "Invite",
  review: "Needs your call",
  reject: "Reject",
};

export function RecBadge({ rec, decision }: { rec: Recommendation | null; decision?: "invite" | "reject" | null }) {
  if (decision) {
    return (
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${decision === "invite" ? REC_STYLE.invite : REC_STYLE.reject}`}>
        {decision === "invite" ? "Invite" : "Reject"}
        <span className="opacity-70">· your call</span>
      </span>
    );
  }
  if (!rec) return <span className="text-xs text-muted">-</span>;
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${REC_STYLE[rec]}`}>{REC_LABEL[rec]}</span>;
}

export function EmailPill({ status, type }: { status: EmailStatus | null; type: EmailType | null }) {
  if (!status) return <span className="text-xs text-muted">No draft</span>;
  const label = type === "invite" ? "Invite" : "Rejection";
  const style: Record<EmailStatus, string> = {
    draft: "text-muted",
    sending: "text-amber-700",
    sent: "text-kargo font-medium",
    failed: "text-red-700 font-medium",
  };
  const verb: Record<EmailStatus, string> = { draft: "draft", sending: "sending…", sent: "sent ✓", failed: "failed" };
  return <span className={`text-xs ${style[status]}`}>{label} {verb[status]}</span>;
}

export function ScoreDots({ score }: { score: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`${score} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={`h-2 w-2 rounded-full ${i <= score ? "bg-kargo" : "bg-kargo/15"}`} />
      ))}
    </span>
  );
}

export function SetupNotice({ error }: { error: string }) {
  return (
    <Card className="p-6 max-w-2xl">
      <h1 className="text-lg font-semibold">Setup needed</h1>
      <p className="mt-2 text-sm text-muted">The app could not load data from the Neon database:</p>
      <pre className="mt-2 whitespace-pre-wrap rounded bg-red-50 p-3 text-sm text-red-800">{error}</pre>
      <ol className="mt-4 list-decimal pl-5 text-sm space-y-1">
        <li>Run <code>npx neon link</code> so <code>DATABASE_URL</code> is in <code>.env.local</code>, and add <code>GEMINI_API_KEY</code>.</li>
        <li>Run <code>npm run db:push</code> to create the tables.</li>
        <li>Run <code>npm run seed</code>, then restart <code>npm run dev</code>.</li>
        <li>Check <a className="underline" href="/api/health">/api/health</a>.</li>
      </ol>
    </Card>
  );
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
