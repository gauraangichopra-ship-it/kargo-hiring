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

const MAX_ATTEMPTS = 5;

function isRetryable(err: unknown): boolean {
  const e = err as { status?: number; code?: number; message?: string };
  const status = e?.status ?? e?.code;
  if (status === 429 || status === 500 || status === 503) return true;
  return /429|RESOURCE_EXHAUSTED|UNAVAILABLE|overloaded/i.test(e?.message ?? "");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Google's 429s say how long to wait ("retryDelay":"27s" / "retry in 27.1s"). Honour it.
function suggestedDelayMs(err: unknown): number | null {
  const msg = (err as { message?: string })?.message ?? "";
  const m = msg.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/) ?? msg.match(/retry in (\d+(?:\.\d+)?)s/i);
  return m ? Math.ceil(Number(m[1]) * 1000) + 500 : null;
}

// One JSON-mode Gemini call with exponential backoff on 429 / 5xx.
// Callers are responsible for making sure no PII is in `prompt`.
export async function generateJson<T>(opts: {
  system: string;
  prompt: string;
  schema: Schema;
  temperature?: number;
}): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const res = await ai().models.generateContent({
        model: env.geminiModel,
        contents: opts.prompt,
        config: {
          systemInstruction: opts.system,
          temperature: opts.temperature ?? 0,
          responseMimeType: "application/json",
          responseSchema: opts.schema,
        },
      });
      const text = res.text;
      if (!text) throw new Error("Gemini returned an empty response");
      return JSON.parse(text) as T;
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === MAX_ATTEMPTS - 1) break;
      // Google's suggested delay (capped at 60s), else 1s, 2s, 4s, 8s + jitter.
      const hinted = suggestedDelayMs(err);
      await sleep(hinted ? Math.min(hinted, 60_000) : 1000 * 2 ** attempt + Math.random() * 500);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
