import { NextResponse } from "next/server";
import { draftFor } from "@/lib/pipeline";
import { db, must } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 120;

// Arjun's Invite/Reject switch. Regenerates the draft for the new type.
export async function POST(req: Request, ctx: RouteContext<"/api/candidate/[id]/decision">) {
  const { id } = await ctx.params;
  const { decision } = await req.json();
  if (decision !== "invite" && decision !== "reject") {
    return NextResponse.json({ error: "decision must be invite or reject" }, { status: 400 });
  }
  const sent = must<{ id: string }[]>(
    await db().from("emails").select("id").eq("candidate_id", id).in("status", ["sent", "sending"]),
  );
  if (sent.length) return NextResponse.json({ error: "An email was already sent to this candidate" }, { status: 409 });
  try {
    must(await db().from("candidates").update({ founder_decision: decision }).eq("id", id));
    await draftFor(id, { forceEmail: true });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
