import { NextResponse } from "next/server";
import { MAX_FILE_BYTES } from "@/lib/config";
import { ACCEPTED_EXTENSIONS } from "@/lib/parse";
import { processFile } from "@/lib/pipeline";
import type { Role } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

// One CV per request: CONTEXT (extract + PII split) and PROCESSING (score both rubrics).
export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  const role = form.get("role");
  if (role !== "PM" && role !== "SPM") {
    return NextResponse.json({ status: "error", error: "Select a role (PM or SPM)" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ status: "error", error: "No file" }, { status: 400 });
  }
  const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
  if (!ACCEPTED_EXTENSIONS.includes(ext)) {
    return NextResponse.json({ status: "error", error: `Unsupported file type ${ext}` }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ status: "error", error: "File is larger than 5 MB" }, { status: 400 });
  }
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const result = await processFile(file.name, buf, role as Role);
    return NextResponse.json(result, { status: result.status === "error" ? 422 : 200 });
  } catch (err) {
    return NextResponse.json({ status: "error", error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
