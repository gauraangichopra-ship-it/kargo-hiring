import "server-only";
import { Pool, types, type PoolClient } from "@neondatabase/serverless";
import { env, requireEnv } from "./env";

// NUMERIC (weighted_total) comes back as a JS number, not a string.
types.setTypeParser(1700, (v) => parseFloat(v));

let pool: Pool | null = null;

// Server-side only. The browser never talks to the database.
function getPool(): Pool {
  if (!pool) {
    requireEnv("databaseUrl");
    pool = new Pool({ connectionString: env.databaseUrl });
  }
  return pool;
}

type Runner = { query: PoolClient["query"] };

export async function query<T>(text: string, params: unknown[] = [], runner?: Runner): Promise<T[]> {
  const res = await (runner ?? getPool()).query(text, params);
  return res.rows as T[];
}

export async function maybeOne<T>(text: string, params: unknown[] = [], runner?: Runner): Promise<T | null> {
  return (await query<T>(text, params, runner))[0] ?? null;
}

export async function one<T>(text: string, params: unknown[] = [], runner?: Runner): Promise<T> {
  const row = await maybeOne<T>(text, params, runner);
  if (!row) throw new Error("Expected a row, got none");
  return row;
}

// Runs fn inside a transaction; rolls back on any error.
export async function tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Postgres rejects malformed uuids with an error; check first and treat as "not found".
export function isUuid(s: unknown): s is string {
  return typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
