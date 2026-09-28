"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useMemo, useState } from "react";
import { TOP_N_INVITE } from "@/lib/config";
import type { DashboardRow } from "@/lib/queries";
import { ROLE_TITLE, type Role } from "@/lib/types";
import { Card, EmailPill, RecBadge } from "./ui";
import { rankAndDraft } from "./runDrafts";

export default function DashboardView({ rows }: { rows: DashboardRow[] }) {
  const router = useRouter();
  const [role, setRole] = useState<Role>("PM");
  const [showCross, setShowCross] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const inRole = useMemo(() => rows.filter((r) => r.appliedRole === role), [rows, role]);
  const ranked = useMemo(
    () => inRole.filter((r) => r.rank !== null).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0) || (b.total ?? 0) - (a.total ?? 0)),
    [inRole],
  );
  const pending = inRole.filter((r) => r.rank === null);

  const stats = {
    total: inRole.length,
    invite: inRole.filter((r) => (r.decision ?? r.recommended) === "invite").length,
    review: inRole.filter((r) => !r.decision && r.recommended === "review").length,
    reject: inRole.filter((r) => (r.decision ?? r.recommended) === "reject").length,
    sent: inRole.filter((r) => r.emailStatus === "sent").length,
  };

  async function refresh() {
    setBusy("Re-ranking…");
    try {
      let done = 0;
      await rankAndDraft(() => setBusy(`Drafting… ${++done}`));
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  if (!rows.length) {
    return (
      <Card className="p-10 text-center">
        <h1 className="text-xl font-semibold">No candidates yet</h1>
        <p className="mt-2 text-muted">Upload CVs and the system will extract, score and rank them against Kargo&apos;s rubric.</p>
        <Link href="/upload" className="mt-5 inline-block rounded-lg bg-kargo px-4 py-2 text-white hover:bg-kargo-600">
          Upload CVs
        </Link>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex rounded-lg bg-white p-1 ring-1 ring-kargo/10" role="tablist">
          {(["PM", "SPM"] as Role[]).map((r) => (
            <button
              key={r}
              role="tab"
              aria-selected={role === r}
              onClick={() => setRole(r)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${role === r ? "bg-kargo text-white" : "text-kargo hover:bg-kargo-50"}`}
            >
              {ROLE_TITLE[r]}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-muted cursor-pointer">
          <input type="checkbox" checked={showCross} onChange={(e) => setShowCross(e.target.checked)} className="accent-kargo" />
          Show cross-role score
        </label>
        <button
          onClick={refresh}
          disabled={Boolean(busy)}
          className="ml-auto rounded-lg bg-white px-3 py-1.5 text-sm text-kargo ring-1 ring-kargo/20 hover:bg-kargo-50 disabled:opacity-50"
        >
          {busy ?? "Re-rank & refresh drafts"}
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          ["Candidates", stats.total],
          ["Invite", stats.invite],
          ["Needs your call", stats.review],
          ["Reject", stats.reject],
          ["Emails sent", stats.sent],
        ].map(([label, n]) => (
          <Card key={label} className="px-4 py-3">
            <div className="text-2xl font-semibold text-kargo">{n}</div>
            <div className="text-xs text-muted">{label}</div>
          </Card>
        ))}
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-kargo/10 text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-3 w-12">#</th>
              <th className="px-2 py-3">Candidate</th>
              <th className="px-2 py-3 w-24">Score</th>
              {showCross && <th className="px-2 py-3 w-24">{role === "PM" ? "SPM" : "PM"} score</th>}
              <th className="px-2 py-3">Criteria</th>
              <th className="px-2 py-3">Recommendation</th>
              <th className="px-4 py-3">Email</th>
            </tr>
          </thead>
          <tbody>
            {ranked.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted">
                  No ranked {ROLE_TITLE[role]} candidates yet.
                </td>
              </tr>
            )}
            {ranked.map((r, i) => {
              const crossHigher = r.otherTotal !== null && r.total !== null && r.otherTotal > r.total;
              return (
                <Fragment key={r.id}>
                  <tr className="border-b border-kargo/5 hover:bg-kargo-50/60">
                    <td className="px-4 py-3 font-mono text-muted">{r.rank}</td>
                    <td className="px-2 py-3">
                      <Link href={`/candidate/${r.id}`} className="font-medium text-kargo hover:underline">
                        {r.name}
                      </Link>
                      {r.criteria.some((c) => !c.verified) && (
                        <span className="ml-2 text-[11px] text-amber-700" title="A quote could not be found in the CV; that criterion is capped at 3">
                          ⚠ unverified quote
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-3 font-semibold tabular-nums">{r.total?.toFixed(1)}</td>
                    {showCross && (
                      <td className={`px-2 py-3 tabular-nums ${crossHigher ? "font-semibold text-amber-800" : "text-muted"}`}>
                        {r.otherTotal?.toFixed(1) ?? "-"}
                        {crossHigher && <span className="ml-1 text-[11px]">▲ higher</span>}
                      </td>
                    )}
                    <td className="px-2 py-3">
                      <div className="flex items-end gap-1 h-6" aria-label="Criterion scores">
                        {r.criteria.map((c) => (
                          <div
                            key={c.name}
                            title={`${c.name}: ${c.score}/5 (weight ${c.weight}%)`}
                            className="w-4 rounded-sm bg-kargo/10 flex items-end"
                            style={{ height: "100%" }}
                          >
                            <div
                              className={`w-full rounded-sm ${c.verified ? "bg-kargo" : "bg-amber-500"}`}
                              style={{ height: `${Math.max(c.score * 20, 4)}%` }}
                            />
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="px-2 py-3">
                      <RecBadge rec={r.recommended} decision={r.decision} />
                    </td>
                    <td className="px-4 py-3">
                      <EmailPill status={r.emailStatus} type={r.emailType} />
                    </td>
                  </tr>
                  {i === TOP_N_INVITE - 1 && ranked.length > TOP_N_INVITE && (
                    <tr>
                      <td colSpan={7} className="px-4 py-2">
                        <div className="flex items-center gap-3 text-xs font-medium text-kargo">
                          <span className="h-0.5 flex-1 bg-kargo" />
                          Everything below this line - review once.
                          <span className="h-0.5 flex-1 bg-kargo" />
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </Card>

      {pending.length > 0 && (
        <Card className="p-4">
          <h2 className="text-sm font-semibold">Not ranked yet ({pending.length})</h2>
          <ul className="mt-2 divide-y divide-kargo/5 text-sm">
            {pending.map((p) => (
              <li key={p.id} className="py-2 flex flex-wrap gap-x-2 gap-y-1 min-w-0">
                <Link href={`/candidate/${p.id}`} className="text-kargo hover:underline">{p.name}</Link>
                <span className="text-muted">· {p.status}</span>
                {p.error && <span className="basis-full min-w-0 break-words text-red-700">{p.error}</span>}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">Scored candidates appear in the ranking after &ldquo;Re-rank &amp; refresh drafts&rdquo;. Failed files can be retried from the upload page or re-uploaded.</p>
        </Card>
      )}
    </div>
  );
}
