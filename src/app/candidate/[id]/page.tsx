import Link from "next/link";
import { notFound } from "next/navigation";
import EmailPanel from "@/components/EmailPanel";
import { Card, RecBadge, ScoreDots, SetupNotice, errorText } from "@/components/ui";
import { emailConfigured, env } from "@/lib/env";
import { loadCandidate } from "@/lib/queries";
import { ROLE_TITLE, type Role } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function CandidatePage({ params }: PageProps<"/candidate/[id]">) {
  const { id } = await params;
  let c;
  try {
    c = await loadCandidate(id);
  } catch (err) {
    return <SetupNotice error={errorText(err)} />;
  }
  if (!c) notFound();

  const name = c.pii?.full_name || "(name not found in CV)";
  const own = c.totals.find((t) => t.role === c.appliedRole);
  const otherRole: Role = c.appliedRole === "PM" ? "SPM" : "PM";

  return (
    <div className="space-y-5">
      <Link href="/" className="text-sm text-kargo hover:underline">← Back to dashboard</Link>

      <Card className="p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold">{name}</h1>
            <p className="mt-1 text-sm text-muted break-words">
              {[c.pii?.email, c.pii?.phone, c.pii?.location].filter(Boolean).join(" · ") || "No contact details found"}
            </p>
            {c.pii?.links?.length ? (
              <p className="mt-1 text-xs text-muted break-all">{c.pii.links.join(" · ")}</p>
            ) : null}
            <p className="mt-2 text-sm">
              Applied for <strong>{ROLE_TITLE[c.appliedRole]}</strong>
              {own?.rank_in_role ? <> · ranked <strong>#{own.rank_in_role}</strong></> : null}
              <span className="ml-2"><RecBadge rec={own?.recommended ?? null} decision={c.decision} /></span>
            </p>
            {c.error && <p className="mt-2 text-sm text-red-700 break-words">Error: {c.error}</p>}
          </div>
          <div className="flex gap-3">
            {(["PM", "SPM"] as Role[]).map((r) => {
              const t = c.totals.find((x) => x.role === r);
              const applied = r === c.appliedRole;
              return (
                <div key={r} className={`rounded-lg px-4 py-2 text-center ${applied ? "bg-kargo text-white" : "bg-kargo-50 text-kargo"}`}>
                  <div className="text-2xl font-semibold tabular-nums">{t ? t.weighted_total.toFixed(1) : "-"}</div>
                  <div className="text-[11px] opacity-80">{r} score{applied ? " (applied)" : ""}</div>
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-5">
        <div className="space-y-5 lg:col-span-3">
          <Card className="p-5">
            <h2 className="font-semibold">Interview brief</h2>
            {c.brief ? (
              <>
                <p className="mt-2 leading-relaxed">{c.brief.brief_text}</p>
                <h3 className="mt-4 text-sm font-semibold">What to probe</h3>
                <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm">
                  {c.brief.probe_questions.map((q, i) => <li key={i}>{q}</li>)}
                </ol>
              </>
            ) : (
              <p className="mt-2 text-sm text-muted">
                {own?.recommended === "reject" && c.decision !== "invite"
                  ? "Briefs are written for invite and review candidates. Switch to Invite to generate one."
                  : "Not generated yet - run “Re-rank & refresh drafts” on the dashboard."}
              </p>
            )}
          </Card>

          {(["applied", "other"] as const).map((which) => {
            const role = which === "applied" ? c.appliedRole : otherRole;
            const rows = c.scores.filter((s) => s.role === role);
            if (!rows.length) return null;
            return (
              <Card key={which} className="p-5">
                <h2 className="font-semibold">
                  {ROLE_TITLE[role]} rubric {which === "other" && <span className="font-normal text-muted">(cross-role)</span>}
                </h2>
                <ul className="mt-3 space-y-4">
                  {rows.map((s) => (
                    <li key={s.criterion.id}>
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-medium">{s.criterion.criterion_name}</span>
                        <span className="text-xs text-muted">weight {s.criterion.weight}%</span>
                        <span className="ml-auto flex items-center gap-2">
                          <ScoreDots score={s.score} />
                          <span className="font-mono text-xs">{s.score}/5</span>
                        </span>
                      </div>
                      <blockquote className={`mt-1 border-l-4 pl-3 text-sm ${s.quote_verified ? "border-kargo bg-kargo-50" : "border-amber-500 bg-amber-50"} py-1`}>
                        &ldquo;{s.evidence_quote}&rdquo;
                      </blockquote>
                      {!s.quote_verified && (
                        <p className="mt-1 text-xs text-amber-800">⚠ Unverified quote - not found word-for-word in the CV, so this score is capped at 3.</p>
                      )}
                      <p className="mt-1 text-xs text-muted">{s.reasoning}</p>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}

          <Card className="p-5">
            <details id="cv">
              <summary className="cursor-pointer font-semibold">CV text (as the AI saw it) · {c.fileName}</summary>
              <pre className="mt-3 max-h-[480px] overflow-auto whitespace-pre-wrap rounded bg-kargo-50 p-3 text-xs leading-relaxed">
                {c.cvRedacted ?? "No text stored."}
              </pre>
            </details>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <EmailPanel
            key={`${c.email?.id}-${c.email?.updated_at}-${c.email?.status}-${c.decision}`}
            candidateId={c.id}
            email={c.email}
            name={c.pii?.full_name ?? null}
            recipient={c.pii?.email ?? null}
            role={c.appliedRole}
            decision={c.decision}
            recommended={own?.recommended ?? null}
            emailConfigured={emailConfigured()}
            sendMode={env.sendMode}
            testRecipient={env.sendMode === "test" ? env.testRecipient : ""}
          />
        </div>
      </div>
    </div>
  );
}
