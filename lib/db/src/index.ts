import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

// En développement (Replit) → DATABASE_URL managé par Replit
// En production (Render)    → SUPABASE_DATABASE_URL en priorité, sinon DATABASE_URL
const isDev = process.env["NODE_ENV"] !== "production";
const dbUrl = isDev
  ? (process.env["DATABASE_URL"] || process.env["SUPABASE_DATABASE_URL"])
  : (process.env["SUPABASE_DATABASE_URL"] || process.env["DATABASE_URL"]);

if (!dbUrl) {
  throw new Error(
    "DATABASE_URL (ou SUPABASE_DATABASE_URL) doit être défini.",
  );
}

// SSL: Supabase/Neon poolers use self-signed certs at the TLS layer,
// so rejectUnauthorized must be false for those connections only.
// For Replit's managed DATABASE_URL (direct Postgres), no SSL override is needed.
// This is a known Supabase limitation — the payload itself is still encrypted.
const sslConfig = dbUrl.includes("supabase") || dbUrl.includes("pooler") || dbUrl.includes("neon")
  ? { rejectUnauthorized: false }
  : undefined;

export const pool = new Pool({ connectionString: dbUrl, ssl: sslConfig });
export const db = drizzle(pool, { schema });

export * from "./schema";
