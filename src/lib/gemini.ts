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
      // 1s, 2s, 4s, 8s + jitter
      await sleep(1000 * 2 ** attempt + Math.random() * 500);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
