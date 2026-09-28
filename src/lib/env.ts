import "server-only";

function read(name: string): string {
  return (process.env[name] ?? "").trim();
}

export const env = {
  // Written by `neon link` / `neon deploy` (pooled connection string).
  databaseUrl: read("DATABASE_URL"),
  geminiApiKey: read("GEMINI_API_KEY"),
  // Tried in order: if one is overloaded / out of quota / unavailable, the next is used.
  // Default chosen by probing this key: Flash-Lite models answer on the free tier.
  geminiModels: (read("GEMINI_MODEL") || "gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-flash-lite-latest")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean),
  resendApiKey: read("RESEND_API_KEY"),
  resendFrom: read("RESEND_FROM_EMAIL") || "onboarding@resend.dev",
  testRecipient: read("TEST_RECIPIENT_EMAIL"),
  // Anything other than exactly "live" is treated as test.
  sendMode: (read("SEND_MODE") === "live" ? "live" : "test") as "live" | "test",
};

export function emailConfigured(): boolean {
  return Boolean(env.resendApiKey);
}

export function requireEnv(...names: (keyof typeof env)[]) {
  const missing = names.filter((n) => !env[n]);
  if (missing.length) throw new Error(`Missing environment variable(s): ${missing.join(", ")}`);
}
