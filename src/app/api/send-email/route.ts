import { NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";

export const runtime = "nodejs";

// Only ever called from an explicit Confirm & Send click.
export async function POST(req: Request) {
  const { email_id } = await req.json();
  if (typeof email_id !== "string") return NextResponse.json({ ok: false, error: "email_id required" }, { status: 400 });
  const result = await sendEmail(email_id);
  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}
