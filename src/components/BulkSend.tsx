"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { BulkRow } from "@/lib/queries";
import type { EmailType } from "@/lib/types";
import { Card, RecBadge } from "./ui";

type Result = { ok: boolean; text: string };

export default function BulkSend({ rows, emailConfigured }: { rows: BulkRow[]; emailConfigured: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set()); // nothing pre-ticked
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<Record<string, Result>>({});

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function sendSelected() {
    setConfirming(false);
    setSending(true);
    // Sequential: keeps well under Resend's rate limit and makes failures easy to read.
    for (const id of selected) {
      const res = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email_id: id }),
      });
      const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
      setResults((r) => ({ ...r, [id]: data.ok ? { ok: true, text: "Sent ✓" } : { ok: false, text: data.error ?? "Failed" } }));
    }
    setSending(false);
    setSelected(new Set());
    router.refresh();
  }

  if (!rows.length) {
    return (
      <Card className="p-10 text-center text-muted">
        No unsent drafts. <Link href="/" className="text-kargo underline">Back to dashboard</Link>
      </Card>
    );
  }

  const groups: { type: EmailType; label: string }[] = [
    { type: "invite", label: "Interview invites" },
    { type: "rejection", label: "Rejections" },
  ];

  return (
    <div className="space-y-4">
      {groups.map((g) => {
        const list = rows.filter((r) => r.emailType === g.type);
        if (!list.length) return null;
        const allOn = list.every((r) => selected.has(r.emailId));
        return (
          <Card key={g.type}>
            <div className="flex items-center gap-3 border-b border-kargo/10 px-4 py-3">
              <h2 className="font-semibold">{g.label} <span className="font-normal text-muted">({list.length})</span></h2>
              <button
                className="ml-auto text-xs text-kargo hover:underline disabled:opacity-40"
                disabled={sending}
                onClick={() =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    list.forEach((r) => (allOn ? next.delete(r.emailId) : next.add(r.emailId)));
                    return next;
                  })
                }
              >
                {allOn ? "Untick all" : "Tick all in group"}
              </button>
            </div>
            <ul className="divide-y divide-kargo/5">
              {list.map((r) => (
                <li key={r.emailId} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-kargo"
                    checked={selected.has(r.emailId)}
                    disabled={sending || !r.hasName}
                    onChange={() => toggle(r.emailId)}
                    aria-label={`Select ${r.name}`}
                  />
                  <Link href={`/candidate/${r.candidateId}`} className="min-w-0 flex-1 truncate font-medium text-kargo hover:underline">
                    {r.name}
                  </Link>
                  <span className="text-xs text-muted">{r.appliedRole}</span>
                  <span className="w-12 text-right tabular-nums">{r.total?.toFixed(1) ?? "-"}</span>
                  <RecBadge rec={r.recommended} />
                  {r.status === "failed" && !results[r.emailId] && <span className="text-xs text-red-700">failed: {r.error}</span>}
                  {results[r.emailId] && (
                    <span className={`text-xs ${results[r.emailId].ok ? "text-kargo" : "text-red-700"}`}>{results[r.emailId].text}</span>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        );
      })}

      <Card className="sticky bottom-4 flex flex-wrap items-center gap-3 p-4">
        <span className="text-sm">{selected.size} selected</span>
        {!emailConfigured ? (
          <button disabled className="ml-auto rounded-lg bg-stone-200 px-4 py-2 text-sm text-stone-600">Email not configured</button>
        ) : confirming ? (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-sm">Send {selected.size} email{selected.size === 1 ? "" : "s"}?</span>
            <button onClick={sendSelected} className="rounded-lg bg-kargo px-3 py-1.5 text-sm font-medium text-white">Yes, send</button>
            <button onClick={() => setConfirming(false)} className="text-sm text-muted hover:underline">Cancel</button>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            disabled={!selected.size || sending}
            className="ml-auto rounded-lg bg-kargo px-4 py-2 text-sm font-medium text-white hover:bg-kargo-600 disabled:opacity-40"
          >
            {sending ? "Sending…" : "Confirm & Send selected"}
          </button>
        )}
      </Card>
    </div>
  );
}
