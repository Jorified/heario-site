// Thin Postgres wrapper. Returns an array of row objects.
// Tests can inject a fake by setting globalThis.__heario_query.
import { neon } from "@neondatabase/serverless";

let _sql;

export async function query(text, params = []) {
  if (globalThis.__heario_query) return globalThis.__heario_query(text, params);
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  _sql ??= neon(process.env.DATABASE_URL);
  return _sql.query(text, params);
}

export async function one(text, params = []) {
  const rows = await query(text, params);
  return rows[0] ?? null;
}
