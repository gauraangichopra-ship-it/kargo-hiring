import { NextResponse } from "next/server";
import { draftFor } from "@/lib/pipeline";

export const runtime = "nodejs";
export const maxDuration = 120;

// AI step for one candidate: brief (invite/review) + email draft. Never sends.
export async function POST(req: Request) {
  const { candidateId } = await req.json();
  if (typeof candidateId !== "string") return NextResponse.json({ error: "candidateId required" }, { status: 400 });
  try {
    await draftFor(candidateId);
    return NextResponse.json({ status: "drafted" });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
