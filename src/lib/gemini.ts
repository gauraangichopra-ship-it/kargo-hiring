import "server-only";
import { GoogleGenAI, type Schema } from "@google/genai";
import { env, requireEnv } from "./env";

let client: GoogleGenAI | null = null;

function ai(): GoogleGenAI {
  if (!client) {
    requireEnv("geminiApiKey");
    client = new GoogleGenAI({ apiKey: env.geminiApiKey });
  }
  return client;
}

// Per model. With the fallback chain, a busy model costs seconds, not minutes.
const ATTEMPTS_PER_MODEL = 2;
// A stalled connection must never hang an upload.
const REQUEST_TIMEOUT_MS = 60_000;

type Kind = "rate" | "busy" | "missing" | "fatal";

function classify(err: unknown): Kind {
  const e = err as { status?: number; code?: number; message?: string };
  const status = e?.status ?? e?.code;
  const msg = e?.message ?? "";
  if (status === 429 || /429|RESOURCE_EXHAUSTED/i.test(msg)) return "rate";
  if (status === 500 || status === 503 || /503|UNAVAILABLE|overloaded|high demand/i.test(msg)) return "busy";
  if (status === 404 || /404|NOT_FOUND|no longer available/i.test(msg)) return "missing";
  // Network drops and our own timeout: treat like an overloaded model.
  if (/fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket|network|aborted|timeout/i.test(msg)) return "busy";
  return "fatal";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Google's 429s say how long to wait ("retryDelay":"27s" / "retry in 27.1s").
function suggestedDelayMs(err: unknown): number | null {
  const msg = (err as { message?: string })?.message ?? "";
  const m = msg.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/) ?? msg.match(/retry in (\d+(?:\.\d+)?)s/i);
  return m ? Math.ceil(Number(m[1]) * 1000) + 500 : null;
}

async function callOnce<T>(model: string, opts: GenOpts): Promise<T> {
  const res = await ai().models.generateContent({
    model,
    contents: opts.prompt,
    config: {
      systemInstruction: opts.system,
      temperature: opts.temperature ?? 0,
      responseMimeType: "application/json",
      responseSchema: opts.schema,
      httpOptions: { timeout: REQUEST_TIMEOUT_MS },
      abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  });
  const text = res.text;
  if (!text) throw new Error("Gemini returned an empty response");
  return JSON.parse(text) as T;
}

type GenOpts = { system: string; prompt: string; schema: Schema; temperature?: number };

// One JSON-mode Gemini call. Walks the model chain (GEMINI_MODEL), retrying
// briefly on each; if every model is rate-limited, waits Google's suggested
// delay once and tries the chain again.
// Callers are responsible for making sure no PII is in `prompt`.
export async function generateJson<T>(opts: GenOpts): Promise<T> {
  let lastErr: unknown;
  for (let round = 0; round < 2; round++) {
    let longestHint = 0;
    for (const model of env.geminiModels) {
      for (let attempt = 0; attempt < ATTEMPTS_PER_MODEL; attempt++) {
        try {
          return await callOnce<T>(model, opts);
        } catch (err) {
          lastErr = err;
          const kind = classify(err);
          if (kind === "fatal") throw new Error(friendlyError(err));
          if (kind === "missing") break; // next model
          if (kind === "rate") {
            longestHint = Math.max(longestHint, suggestedDelayMs(err) ?? 0);
            break; // this model's quota is spent; next model
          }
          await sleep(1000 * 2 ** attempt + Math.random() * 500); // busy: short backoff
        }
      }
    }
    if (round === 0) await sleep(Math.min(longestHint || 5000, 60_000));
  }
  throw new Error(friendlyError(lastErr));
}

// Google returns long JSON blobs; turn them into one line Arjun can act on.
function friendlyError(err: unknown): string {
  const msg = (err as { message?: string })?.message ?? String(err);
  if (/free_tier/i.test(msg)) {
    return "Gemini free-tier limit reached on every model. Wait a minute and click Retry, or enable billing on the key.";
  }
  if (/429|RESOURCE_EXHAUSTED|quota/i.test(msg)) return "Gemini rate limit reached. Wait a minute, then click Retry.";
  if (/503|UNAVAILABLE|high demand|overloaded/i.test(msg)) return "Gemini is overloaded right now. Try again in a few minutes.";
  if (/404|NOT_FOUND|no longer available/i.test(msg)) return `No Gemini model in [${env.geminiModels.join(", ")}] is available. Set GEMINI_MODEL in .env.local.`;
  if (/401|403|API key|PERMISSION_DENIED|UNAUTHENTICATED/i.test(msg)) return "Gemini rejected the API key. Check GEMINI_API_KEY.";
  if (/fetch failed|ECONN|ETIMEDOUT|ENOTFOUND|aborted|timeout/i.test(msg)) return "Could not reach Gemini (network problem or timeout). Check your internet, then click Retry.";
  const inner = msg.match(/"message"\s*:\s*"([^"]{1,200})/)?.[1];
  return `Gemini error: ${inner ?? msg.slice(0, 200)}`;
}
