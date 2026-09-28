import { NextResponse } from "next/server";
import { isUuid, query } from "@/lib/db";

export const runtime = "nodejs";

// Founder edits to a draft.
export async function PATCH(req: Request, ctx: RouteContext<"/api/email/[id]">) {
  const { id } = await ctx.params;
  const { subject, body } = await req.json();
  if (typeof subject !== "string" || typeof body !== "string" || !subject.trim() || !body.trim()) {
    return NextResponse.json({ error: "Subject and body are required" }, { status: 400 });
  }
  const rows = isUuid(id)
    ? await query<{ id: string }>(
        `update emails set subject = $2, body_with_placeholders = $3, edited_by_founder = true, updated_at = now()
          where id = $1 and status in ('draft', 'failed') returning id`,
        [id, subject.trim(), body.trim()],
      )
    : [];
  if (!rows.length) return NextResponse.json({ error: "Email was already sent or does not exist" }, { status: 409 });
  return NextResponse.json({ ok: true });
}
