import { NextResponse } from "next/server";
import { rankAll } from "@/lib/pipeline";

export const runtime = "nodejs";

// Re-ranks every role pool. Returns candidates whose brief/draft is missing or stale.
export async function POST() {
  try {
    return NextResponse.json(await rankAll());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
