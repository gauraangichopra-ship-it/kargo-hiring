"use client";
import { UPLOAD_CONCURRENCY } from "@/lib/config";

// Runs async jobs with a fixed concurrency. Used by the upload queue and drafting.
export async function runQueue<T>(items: T[], worker: (item: T) => Promise<void>, concurrency = UPLOAD_CONCURRENCY) {
  let next = 0;
  const lanes = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  });
  await Promise.all(lanes);
}

// Re-rank every pool, then generate any missing / stale briefs and drafts.
export async function rankAndDraft(onDraft?: (candidateId: string, ok: boolean, error?: string) => void) {
  const res = await fetch("/api/rank", { method: "POST" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Ranking failed");
  const ids: string[] = data.needsDraft ?? [];
  await runQueue(ids, async (id) => {
    const r = await fetch("/api/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateId: id }),
    });
    const d = await r.json().catch(() => ({}));
    onDraft?.(id, r.ok, d.error);
  });
  return ids.length;
}
