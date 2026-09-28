import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { db } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Check = { ok: boolean; detail: string };

export async function GET() {
  const checks: Record<string, Check> = {};

  try {
    const { error } = await db().from("candidates").select("id", { count: "exact", head: true });
    checks.supabase = error ? { ok: false, detail: error.message } : { ok: true, detail: "connected" };
  } catch (err) {
    checks.supabase = { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }

  try {
    const { data, error } = await db().from("rubric_criteria").select("role, weight");
    if (error) throw new Error(error.message);
    const sum = (r: string) => data.filter((d) => d.role === r).reduce((a, d) => a + d.weight, 0);
    const ok = data.length === 10 && sum("PM") === 100 && sum("SPM") === 100;
    checks.rubric = { ok, detail: `${data.length} criteria, PM=${sum("PM")}%, SPM=${sum("SPM")}%` };
  } catch (err) {
    checks.rubric = { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }

  checks.gemini = env.geminiApiKey
    ? { ok: true, detail: `key present, model ${env.geminiModel}` }
    : { ok: false, detail: "GEMINI_API_KEY missing" };
  checks.resend = env.resendApiKey
    ? { ok: true, detail: `key present, SEND_MODE=${env.sendMode}` }
    : { ok: false, detail: "RESEND_API_KEY missing - Send buttons show 'Email not configured'" };
  if (env.sendMode === "test") {
    checks.test_recipient = env.testRecipient
      ? { ok: true, detail: "TEST_RECIPIENT_EMAIL set" }
      : { ok: false, detail: "TEST_RECIPIENT_EMAIL missing - test sends will be refused" };
  }

  const ok = Object.values(checks).every((c) => c.ok);
  return NextResponse.json({ ok, checks }, { status: ok ? 200 : 503 });
}
