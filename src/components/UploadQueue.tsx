"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { MAX_FILE_BYTES, MAX_FILES_PER_BATCH } from "@/lib/config";
import { ROLE_TITLE, type Role } from "@/lib/types";
import { Card } from "./ui";
import { rankAndDraft, runQueue } from "./runDrafts";

type Stage = "queued" | "uploaded" | "extracted" | "scored" | "drafted" | "duplicate" | "error";
type Item = { key: string; file: File; stage: Stage; error?: string; candidateId?: string };

const ACCEPT = ".pdf,.docx,.txt";
const STAGES: Stage[] = ["uploaded", "extracted", "scored", "drafted"];

export default function UploadQueue() {
  const [role, setRole] = useState<Role | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // candidateId -> row key, so drafting progress can be shown on the right row.
  const keyByCandidate = useRef(new Map<string, string>());

  const patch = (key: string, p: Partial<Item>) => {
    if (p.candidateId) keyByCandidate.current.set(p.candidateId, key);
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...p } : i)));
  };

  function addFiles(list: FileList | File[]) {
    const incoming = Array.from(list).filter((f) => /\.(pdf|docx|txt)$/i.test(f.name));
    setItems((prev) => {
      const names = new Set(prev.map((p) => p.file.name));
      const fresh = incoming
        .filter((f) => !names.has(f.name))
        .map((f): Item => ({
          key: `${f.name}-${f.size}-${f.lastModified}`,
          file: f,
          stage: f.size > MAX_FILE_BYTES ? "error" : "queued",
          error: f.size > MAX_FILE_BYTES ? "Larger than 5 MB" : undefined,
        }));
      return [...prev, ...fresh].slice(0, MAX_FILES_PER_BATCH);
    });
  }

  async function processOne(item: Item) {
    patch(item.key, { stage: "uploaded", error: undefined });
    const fd = new FormData();
    fd.append("file", item.file);
    fd.append("role", role!);
    // The server walks extracted -> scored in one request; show 'extracted' while it works.
    const tick = setTimeout(() => patch(item.key, { stage: "extracted" }), 1500);
    try {
      const res = await fetch("/api/process", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({ status: "error", error: `HTTP ${res.status}` }));
      if (data.status === "scored") patch(item.key, { stage: "scored", candidateId: data.candidateId });
      else if (data.status === "duplicate") patch(item.key, { stage: "duplicate", candidateId: data.candidateId });
      else patch(item.key, { stage: "error", error: data.error ?? "Failed", candidateId: data.candidateId ?? undefined });
    } catch (err) {
      patch(item.key, { stage: "error", error: err instanceof Error ? err.message : "Network error" });
    } finally {
      clearTimeout(tick);
    }
  }

  async function finish() {
    setPhase("Ranking all candidates…");
    let n = 0;
    await rankAndDraft((id, ok, error) => {
      setPhase(`Writing briefs and email drafts… ${++n}`);
      const key = keyByCandidate.current.get(id);
      if (key) patch(key, ok ? { stage: "drafted" } : { stage: "error", error: `Drafting failed: ${error ?? "unknown"}` });
    });
    // Scored files whose draft didn't need changing are also done.
    setItems((prev) => prev.map((i) => (i.stage === "scored" ? { ...i, stage: "drafted" } : i)));
    setPhase(null);
  }

  async function start() {
    if (!role) return;
    setRunning(true);
    try {
      await runQueue(items.filter((i) => i.stage === "queued"), processOne);
      await finish();
    } catch (err) {
      setPhase(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunning(false);
    }
  }

  async function retry(item: Item) {
    setRunning(true);
    try {
      if (item.candidateId) {
        patch(item.key, { stage: "extracted", error: undefined });
        const res = await fetch("/api/retry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ candidateId: item.candidateId }),
        });
        const data = await res.json();
        if (data.status !== "scored") {
          patch(item.key, { stage: "error", error: data.error ?? "Retry failed" });
          return;
        }
        patch(item.key, { stage: "scored" });
      } else {
        await processOne(item);
      }
      await finish();
    } finally {
      setRunning(false);
    }
  }

  const queued = items.filter((i) => i.stage === "queued").length;
  const done = items.filter((i) => i.stage === "drafted" || i.stage === "duplicate").length;

  return (
    <div className="space-y-4">
      <Card className="p-5 space-y-4">
        <fieldset>
          <legend className="text-sm font-medium">Applied role for this batch <span className="text-red-700">*</span></legend>
          <div className="mt-2 flex gap-2">
            {(["PM", "SPM"] as Role[]).map((r) => (
              <button
                key={r}
                type="button"
                disabled={running}
                onClick={() => setRole(r)}
                className={`rounded-lg px-4 py-2 text-sm ring-1 transition ${role === r ? "bg-kargo text-white ring-kargo" : "bg-white text-kargo ring-kargo/20 hover:bg-kargo-50"}`}
              >
                {ROLE_TITLE[r]}
              </button>
            ))}
          </div>
        </fieldset>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            if (!running) addFiles(e.dataTransfer.files);
          }}
          onClick={() => !running && inputRef.current?.click()}
          className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition ${drag ? "border-kargo bg-kargo-50" : "border-kargo/25 hover:border-kargo/50"}`}
        >
          <p className="font-medium text-kargo">Drop CVs here or click to choose</p>
          <p className="mt-1 text-xs text-muted">PDF, DOCX or TXT · up to {MAX_FILES_PER_BATCH} files · 5 MB each</p>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={start}
            disabled={!role || !queued || running}
            className="rounded-lg bg-kargo px-4 py-2 text-sm font-medium text-white hover:bg-kargo-600 disabled:opacity-40"
          >
            {running ? "Processing…" : `Process ${queued || ""} file${queued === 1 ? "" : "s"}`}
          </button>
          {!role && items.length > 0 && <span className="text-sm text-red-700">Select a role first.</span>}
          {!running && items.length > 0 && (
            <button onClick={() => setItems([])} className="text-sm text-muted hover:underline">
              Clear list
            </button>
          )}
          {phase && <span className="text-sm text-kargo">{phase}</span>}
          {!running && done > 0 && (
            <Link href="/" className="ml-auto text-sm font-medium text-kargo hover:underline">
              View ranked dashboard →
            </Link>
          )}
        </div>
      </Card>

      {items.length > 0 && (
        <Card>
          <ul className="divide-y divide-kargo/5">
            {items.map((i) => (
              <li key={i.key} className="px-4 py-3 flex flex-wrap items-center gap-3 text-sm">
                <span className="min-w-0 flex-1 truncate font-medium" title={i.file.name}>{i.file.name}</span>
                <Progress stage={i.stage} />
                {i.stage === "duplicate" && <span className="text-xs text-muted">Already uploaded - skipped</span>}
                {i.stage === "error" && (
                  <>
                    <span className="basis-full text-xs text-red-700 sm:basis-auto">{i.error}</span>
                    <button
                      onClick={() => retry(i)}
                      disabled={running || !role}
                      className="rounded px-2 py-1 text-xs text-kargo ring-1 ring-kargo/30 hover:bg-kargo-50 disabled:opacity-40"
                    >
                      Retry
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Progress({ stage }: { stage: Stage }) {
  if (stage === "queued") return <span className="text-xs text-muted">queued</span>;
  if (stage === "duplicate") return null;
  const reached = stage === "error" ? -1 : STAGES.indexOf(stage);
  return (
    <span className="flex items-center gap-1 text-[11px]">
      {STAGES.map((s, idx) => (
        <span
          key={s}
          className={`rounded px-1.5 py-0.5 ${stage === "error" ? "bg-red-50 text-red-700" : idx <= reached ? "bg-kargo text-white" : "bg-kargo/10 text-muted"}`}
        >
          {s}
        </span>
      ))}
    </span>
  );
}
