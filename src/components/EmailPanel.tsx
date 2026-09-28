"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { fillPlaceholders, LEFTOVER_PLACEHOLDER } from "@/lib/placeholders";
import type { EmailRow, Recommendation, Role } from "@/lib/types";
import { Card } from "./ui";

type Props = {
  candidateId: string;
  email: EmailRow | null;
  name: string | null;
  recipient: string | null;
  role: Role;
  decision: "invite" | "reject" | null;
  recommended: Recommendation | null;
  emailConfigured: boolean;
  sendMode: "test" | "live";
  testRecipient: string;
};

export default function EmailPanel(p: Props) {
  const router = useRouter();
  const [subject, setSubject] = useState(p.email?.subject ?? "");
  const [body, setBody] = useState(p.email?.body_with_placeholders ?? "");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const sent = p.email?.status === "sent";
  const locked = sent || p.email?.status === "sending";
  const current = p.decision ?? (p.recommended === "invite" ? "invite" : "reject");
  const dirty = subject !== p.email?.subject || body !== p.email?.body_with_placeholders;
  const previewName = p.name ?? "[NAME]";
  const previewSubject = fillPlaceholders(subject, previewName, p.role);
  const previewBody = fillPlaceholders(body, previewName, p.role);
  const leftover = (previewSubject + "\n" + previewBody).match(LEFTOVER_PLACEHOLDER)?.[0];
  const deliverTo = p.sendMode === "live" ? p.recipient : p.testRecipient;

  async function switchTo(decision: "invite" | "reject") {
    if (decision === current && p.decision) return;
    if (p.email?.edited_by_founder && !confirm("This replaces your edited draft with a new one. Continue?")) return;
    setBusy(decision === "invite" ? "Writing invite…" : "Writing rejection…");
    setMsg(null);
    const res = await fetch(`/api/candidate/${p.candidateId}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    const data = await res.json();
    setBusy(null);
    if (!res.ok) return setMsg({ ok: false, text: data.error ?? "Could not switch" });
    // The page re-keys this panel on the new draft, so local state resets.
    router.refresh();
  }

  async function save() {
    if (!p.email) return;
    setBusy("Saving…");
    const res = await fetch(`/api/email/${p.email.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject, body }),
    });
    const data = await res.json();
    setBusy(null);
    if (!res.ok) return setMsg({ ok: false, text: data.error ?? "Save failed" });
    setEditing(false);
    setMsg({ ok: true, text: "Draft saved." });
    router.refresh();
  }

  async function send() {
    if (!p.email) return;
    setConfirming(false);
    setBusy("Sending…");
    setMsg(null);
    const res = await fetch("/api/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email_id: p.email.id }),
    });
    const data = await res.json();
    setBusy(null);
    setMsg(data.ok ? { ok: true, text: `Sent to ${data.to}.` } : { ok: false, text: data.error ?? "Send failed" });
    router.refresh();
  }

  return (
    <Card className="p-5 lg:sticky lg:top-4 space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="font-semibold">Email</h2>
        {p.recommended === "review" && !p.decision && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 ring-1 ring-amber-300">
            Needs your call
          </span>
        )}
        {sent && <span className="ml-auto text-xs font-medium text-kargo">Sent ✓ {p.email?.sent_at && new Date(p.email.sent_at).toLocaleString()}</span>}
      </div>

      <div className="flex rounded-lg bg-kargo-50 p-1 text-sm" role="radiogroup" aria-label="Decision">
        {(["invite", "reject"] as const).map((d) => (
          <button
            key={d}
            role="radio"
            aria-checked={current === d}
            disabled={locked || Boolean(busy)}
            onClick={() => switchTo(d)}
            className={`flex-1 rounded-md px-3 py-1.5 font-medium transition disabled:opacity-60 ${current === d ? "bg-kargo text-white" : "text-kargo hover:bg-white"}`}
          >
            {d === "invite" ? "Invite" : "Reject"}
          </button>
        ))}
      </div>

      {!p.email ? (
        <p className="text-sm text-muted">No draft yet. Run &ldquo;Re-rank &amp; refresh drafts&rdquo; on the dashboard, or pick Invite/Reject above.</p>
      ) : editing ? (
        <div className="space-y-2">
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full rounded-lg border border-kargo/20 px-3 py-2 text-sm"
            aria-label="Subject"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={12}
            className="w-full rounded-lg border border-kargo/20 px-3 py-2 text-sm leading-relaxed"
            aria-label="Body"
          />
          <p className="text-xs text-muted">Keep <code>[NAME]</code> and <code>[ROLE]</code> - they are filled in at send time.</p>
          <div className="flex gap-2">
            <button onClick={save} disabled={!dirty || Boolean(busy)} className="rounded-lg bg-kargo px-3 py-1.5 text-sm text-white disabled:opacity-40">
              Save draft
            </button>
            <button
              onClick={() => {
                setSubject(p.email!.subject);
                setBody(p.email!.body_with_placeholders);
                setEditing(false);
              }}
              className="rounded-lg px-3 py-1.5 text-sm text-muted hover:underline"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="text-sm">
            <span className="text-muted">Subject: </span>
            <span className="font-medium">{previewSubject}</span>
          </div>
          <div className="whitespace-pre-wrap rounded-lg bg-kargo-50 p-3 text-sm leading-relaxed">{previewBody}</div>
          {p.email.edited_by_founder && <p className="text-xs text-muted">Edited by you.</p>}
          {!locked && (
            <button onClick={() => setEditing(true)} className="text-sm text-kargo hover:underline">
              Edit draft
            </button>
          )}
        </div>
      )}

      {p.email && !sent && (
        <div className="border-t border-kargo/10 pt-4 space-y-2">
          {!p.emailConfigured ? (
            <button disabled className="w-full rounded-lg bg-stone-200 px-4 py-2 text-sm text-stone-600">
              Email not configured
            </button>
          ) : confirming ? (
            <div className="rounded-lg bg-amber-50 p-3 ring-1 ring-amber-300 space-y-2">
              <p className="text-sm">
                Send to <strong>{deliverTo || "(no address)"}</strong>?
                {p.sendMode === "test" && (
                  <span className="block text-xs text-muted">Test mode - intended recipient: {p.recipient ?? "none on CV"}</span>
                )}
              </p>
              <div className="flex gap-2">
                <button onClick={send} disabled={Boolean(busy)} className="rounded-lg bg-kargo px-3 py-1.5 text-sm font-medium text-white">
                  Yes, send
                </button>
                <button onClick={() => setConfirming(false)} className="rounded-lg px-3 py-1.5 text-sm text-muted hover:underline">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              disabled={Boolean(busy) || editing || locked || Boolean(leftover) || !p.name || !deliverTo}
              className="w-full rounded-lg bg-kargo px-4 py-2 text-sm font-medium text-white hover:bg-kargo-600 disabled:opacity-40"
            >
              Confirm &amp; Send
            </button>
          )}
          {leftover && <p className="text-xs text-red-700">Placeholder {leftover} is still in the email - edit it before sending.</p>}
          {!p.name && <p className="text-xs text-red-700">No name was found in this CV, so the email can&apos;t be personalised.</p>}
          {p.emailConfigured && !deliverTo && (
            <p className="text-xs text-red-700">
              {p.sendMode === "test" ? "TEST_RECIPIENT_EMAIL is not set." : "No email address on this CV."}
            </p>
          )}
          {p.email.status === "failed" && p.email.error_message && (
            <p className="text-xs text-red-700">Last attempt failed: {p.email.error_message}</p>
          )}
        </div>
      )}

      {busy && <p className="text-sm text-kargo">{busy}</p>}
      {msg && <p className={`text-sm ${msg.ok ? "text-kargo" : "text-red-700"}`}>{msg.text}</p>}
    </Card>
  );
}
