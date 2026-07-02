import { defineConfig } from "drizzle-kit";
import path from "path";

const dbUrl = process.env["SUPABASE_DATABASE_URL"] || process.env["DATABASE_URL"];

if (!dbUrl) {
  throw new Error("SUPABASE_DATABASE_URL (ou DATABASE_URL) doit être défini");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: dbUrl,
    // rejectUnauthorized:false is required for Supabase/Neon pooler connections
    // which use self-signed certs at the TLS layer. Payload is still encrypted.
    // This config is only used by drizzle-kit (schema push/pull), not the runtime server.
    ssl: { rejectUnauthorized: false },
  },
  tablesFilter: ["!user_sessions"],
});
