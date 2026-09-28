import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env, requireEnv } from "./env";

let client: SupabaseClient | null = null;

// Server-side only. The browser never talks to Supabase directly.
export function db(): SupabaseClient {
  if (!client) {
    requireEnv("supabaseUrl", "supabaseAnonKey");
    client = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: { persistSession: false },
    });
  }
  return client;
}

// Unwraps a Supabase response, throwing on error. No generated DB types in this
// project, so callers state the row shape via T.
export function must<T>(res: { data: unknown; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}
