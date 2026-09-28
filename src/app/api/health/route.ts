import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Check = { ok: boolean; detail: string };

export async function GET() {
  const checks: Record<string, Check> = {};

  try {
    const [{ n }] = await query<{ n: number }>("select count(*)::int as n from candidates");
    checks.database = { ok: true, detail: `Neon connected, ${n} candidates` };
  } catch (err) {
    checks.database = { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }

  try {
    const data = await query<{ role: string; weight: number }>("select role, weight from rubric_criteria");
    const sum = (r: string) => data.filter((d) => d.role === r).reduce((a, d) => a + d.weight, 0);
    const ok = data.length === 10 && sum("PM") === 100 && sum("SPM") === 100;
    checks.rubric = { ok, detail: `${data.length} criteria, PM=${sum("PM")}%, SPM=${sum("SPM")}%` };
  } catch (err) {
    checks.rubric = { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }

  checks.gemini = env.geminiApiKey
    ? { ok: true, detail: `key present, models ${env.geminiModels.join(" → ")}` }
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
