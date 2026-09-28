import "server-only";
import { Resend } from "resend";
import { emailConfigured, env } from "./env";
import { db, must } from "./supabase";
import { fillPlaceholders, LEFTOVER_PLACEHOLDER as LEFTOVER } from "./placeholders";
import type { EmailRow } from "./types";

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function toHtml(body: string): string {
  const paras = body
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1c2b28;max-width:560px">${paras}</div>`;
}

export type SendOutcome =
  | { ok: true; messageId: string; to: string }
  | { ok: false; error: string };

export async function sendEmail(emailId: string): Promise<SendOutcome> {
  if (!emailConfigured()) return { ok: false, error: "Email not configured (RESEND_API_KEY is empty)" };

  const email = must<EmailRow | null>(await db().from("emails").select("*").eq("id", emailId).maybeSingle());
  if (!email) return { ok: false, error: "Email not found" };
  if (email.status === "sent") return { ok: false, error: "Already sent - emails are never sent twice" };

  const pii = must<{ full_name: string | null; email: string | null } | null>(
    await db().from("candidate_pii").select("full_name, email").eq("candidate_id", email.candidate_id).maybeSingle(),
  );
  if (!pii?.full_name) return { ok: false, error: "No candidate name on file - add it before sending" };

  const intended = pii.email;
  const to = env.sendMode === "live" ? intended : env.testRecipient;
  if (!to) {
    return {
      ok: false,
      error: env.sendMode === "live" ? "Candidate has no email address" : "TEST_RECIPIENT_EMAIL is not set",
    };
  }

  const subject = fillPlaceholders(email.subject, pii.full_name, email.role);
  const body = fillPlaceholders(email.body_with_placeholders, pii.full_name, email.role);
  const leftover = (subject + "\n" + body).match(LEFTOVER);
  if (leftover) return { ok: false, error: `Placeholder ${leftover[0]} is still in the email - edit it before sending` };

  // Lock: only a draft/failed email can move to 'sending'. A second click finds nothing to update.
  const locked = must<{ id: string }[]>(
    await db()
      .from("emails")
      .update({ status: "sending", error_message: null })
      .eq("id", emailId)
      .in("status", ["draft", "failed"])
      .select("id"),
  );
  if (!locked.length) return { ok: false, error: "This email is already being sent or was sent" };

  const finalSubject = env.sendMode === "live" ? subject : `[TEST -> ${intended ?? "no email on CV"}] ${subject}`;
  try {
    const resend = new Resend(env.resendApiKey);
    const { data, error } = await resend.emails.send({
      from: `Arjun Mehta, Kargo <${env.resendFrom}>`,
      to,
      subject: finalSubject,
      text: body,
      html: toHtml(body),
    });
    if (error || !data) throw new Error(error?.message ?? "Resend returned no message id");

    const now = new Date().toISOString();
    must(
      await db()
        .from("emails")
        .update({ status: "sent", sent_at: now, resend_message_id: data.id, updated_at: now })
        .eq("id", emailId),
    );
    must(await db().from("candidates").update({ status: "sent" }).eq("id", email.candidate_id));
    return { ok: true, messageId: data.id, to };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db().from("emails").update({ status: "failed", error_message: msg }).eq("id", emailId);
    return { ok: false, error: msg };
  }
}
