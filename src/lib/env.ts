import "server-only";

function read(name: string): string {
  return (process.env[name] ?? "").trim();
}

export const env = {
  // Written by `neon link` / `neon deploy` (pooled connection string).
  databaseUrl: read("DATABASE_URL"),
  geminiApiKey: read("GEMINI_API_KEY"),
  geminiModel: read("GEMINI_MODEL") || "gemini-3.8-flash",
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
