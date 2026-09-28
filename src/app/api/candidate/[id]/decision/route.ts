import { NextResponse } from "next/server";
import { draftFor } from "@/lib/pipeline";
import { isUuid, query } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 120;

// Arjun's Invite/Reject switch. Regenerates the draft for the new type.
export async function POST(req: Request, ctx: RouteContext<"/api/candidate/[id]/decision">) {
  const { id } = await ctx.params;
  const { decision } = await req.json();
  if (decision !== "invite" && decision !== "reject") {
    return NextResponse.json({ error: "decision must be invite or reject" }, { status: 400 });
  }
  if (!isUuid(id)) return NextResponse.json({ error: "Unknown candidate" }, { status: 404 });
  const sent = await query("select 1 from emails where candidate_id = $1 and status in ('sent', 'sending')", [id]);
  if (sent.length) return NextResponse.json({ error: "An email was already sent to this candidate" }, { status: 409 });
  try {
    await query("update candidates set founder_decision = $2 where id = $1", [id, decision]);
    await draftFor(id, { forceEmail: true });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
