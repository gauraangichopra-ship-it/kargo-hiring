import { NextResponse } from "next/server";
import { rescoreCandidate } from "@/lib/pipeline";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const { candidateId } = await req.json();
  if (typeof candidateId !== "string") return NextResponse.json({ error: "candidateId required" }, { status: 400 });
  const result = await rescoreCandidate(candidateId);
  return NextResponse.json(result, { status: result.status === "error" ? 422 : 200 });
}
