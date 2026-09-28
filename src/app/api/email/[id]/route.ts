import { NextResponse } from "next/server";
import { db, must } from "@/lib/supabase";

export const runtime = "nodejs";

// Founder edits to a draft.
export async function PATCH(req: Request, ctx: RouteContext<"/api/email/[id]">) {
  const { id } = await ctx.params;
  const { subject, body } = await req.json();
  if (typeof subject !== "string" || typeof body !== "string" || !subject.trim() || !body.trim()) {
    return NextResponse.json({ error: "Subject and body are required" }, { status: 400 });
  }
  const rows = must<{ id: string }[]>(
    await db()
      .from("emails")
      .update({
        subject: subject.trim(),
        body_with_placeholders: body.trim(),
        edited_by_founder: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .in("status", ["draft", "failed"])
      .select("id"),
  );
  if (!rows.length) return NextResponse.json({ error: "Email was already sent or does not exist" }, { status: 409 });
  return NextResponse.json({ ok: true });
}
