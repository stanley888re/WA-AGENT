import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import { z } from "zod/v4";

const router = Router();

// Admin emails loaded from environment — never hardcoded in source
const ADMIN_EMAILS: string[] = (process.env["ADMIN_EMAILS"] ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

function hashPassword(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 100_000, 64, "sha512").toString("hex");
}

function createSalt(): string {
  return crypto.randomBytes(32).toString("hex");
}

// ─── Validation schemas ───────────────────────────────────────────────────────
const registerSchema = z.object({
  name: z.string().min(1, "Le nom est requis").max(100),
  email: z.email("Email invalide").max(255),
  password: z.string().min(8, "Le mot de passe doit contenir au moins 8 caractères").max(128),
});

const loginSchema = z.object({
  email: z.email("Email invalide").max(255),
  password: z.string().min(1, "Le mot de passe est requis").max(128),
});

// ─── POST /register ───────────────────────────────────────────────────────────
router.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: z.prettifyError(parsed.error) });
  }
  const { name, email, password } = parsed.data;
  const normalizedEmail = email.toLowerCase();

  const [existing] = await db.select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, normalizedEmail));
  if (existing) {
    return res.status(409).json({ error: "Un compte existe déjà avec cet email" });
  }

  const salt = createSalt();
  const passwordHash = `${salt}:${hashPassword(password, salt)}`;
  const role = ADMIN_EMAILS.includes(normalizedEmail) ? "admin" : "user";

  const [user] = await db.insert(usersTable).values({
    name,
    email: normalizedEmail,
    passwordHash,
    role,
  }).returning({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role });

  const sess = req.session as { userId?: number; userName?: string; userEmail?: string; userRole?: string };
  sess.userId = user.id;
  sess.userName = user.name;
  sess.userEmail = user.email;
  sess.userRole = user.role;

  return res.status(201).json({ id: user.id, name: user.name, email: user.email, role: user.role });
});

// ─── POST /login ──────────────────────────────────────────────────────────────
router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: z.prettifyError(parsed.error) });
  }
  const { email, password } = parsed.data;
  const normalizedEmail = email.toLowerCase();

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, normalizedEmail));
  // Constant-time failure — same message whether email unknown or password wrong
  if (!user) {
    return res.status(401).json({ error: "Email ou mot de passe incorrect" });
  }

  const parts = user.passwordHash.split(":");
  if (parts.length !== 2) {
    return res.status(401).json({ error: "Email ou mot de passe incorrect" });
  }
  const [salt, storedHash] = parts;
  const inputHash = hashPassword(password, salt);

  // Validate both hashes are valid 64-byte hex strings (128 hex chars) before comparing.
  // timingSafeEqual throws if buffers differ in length — that would become a 500.
  const HEX_64 = /^[0-9a-f]{128}$/i;
  if (!HEX_64.test(storedHash) || !HEX_64.test(inputHash)) {
    return res.status(401).json({ error: "Email ou mot de passe incorrect" });
  }

  // Constant-time comparison to prevent timing attacks
  const match = crypto.timingSafeEqual(
    Buffer.from(inputHash, "hex"),
    Buffer.from(storedHash, "hex"),
  );
  if (!match) {
    return res.status(401).json({ error: "Email ou mot de passe incorrect" });
  }

  // Auto-upgrade to admin if in admin list and not already admin
  if (ADMIN_EMAILS.includes(normalizedEmail) && user.role !== "admin") {
    await db.update(usersTable).set({ role: "admin" }).where(eq(usersTable.id, user.id));
    user.role = "admin";
  }

  const sess = req.session as { userId?: number; userName?: string; userEmail?: string; userRole?: string };
  sess.userId = user.id;
  sess.userName = user.name;
  sess.userEmail = user.email;
  sess.userRole = user.role;

  return res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
});

// ─── POST /logout ─────────────────────────────────────────────────────────────
router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("wa.sid");
    return res.json({ ok: true });
  });
});

// ─── GET /me ──────────────────────────────────────────────────────────────────
router.get("/me", async (req, res) => {
  const sess = req.session as { userId?: number; userName?: string; userEmail?: string; userRole?: string };
  if (!sess.userId) {
    return res.status(401).json({ error: "Non authentifié" });
  }
  const [user] = await db
    .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, sess.userId));
  if (!user) {
    return res.status(401).json({ error: "Compte introuvable" });
  }
  sess.userRole = user.role;
  return res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
});

export default router;
