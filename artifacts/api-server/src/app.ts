import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import router from "./routes";
import authRouter from "./routes/auth";
import { logger } from "./lib/logger";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app: Express = express();

// ─── Trust proxy (TLS terminated at edge) ─────────────────────────────────────
if (process.env["NODE_ENV"] === "production") {
  app.set("trust proxy", 1);
}

// ─── Security headers (Helmet) ────────────────────────────────────────────────
app.use(
  helmet({
    crossOriginEmbedderPolicy: false, // needed for Replit preview
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"], // Vite HMR in dev
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        imgSrc: ["'self'", "data:", "https://res.cloudinary.com", "https://*.cloudinary.com"],
        connectSrc: ["'self'", "wss:", "ws:"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        objectSrc: ["'none'"],
        frameSrc: ["'none'"],
      },
    },
  }),
);

// ─── CORS ─────────────────────────────────────────────────────────────────────
const rawAllowedOrigins = process.env["ALLOWED_ORIGINS"] ?? "";
const explicitOrigins = rawAllowedOrigins
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Server-to-server / curl / Postman (no Origin header)
      if (!origin) return callback(null, true);
      // Only allow explicitly whitelisted origins — never wildcard with credentials
      if (explicitOrigins.length > 0 && explicitOrigins.includes(origin)) return callback(null, true);
      // Localhost for local dev (never in production — trust proxy is set there)
      if (process.env["NODE_ENV"] !== "production" && /^https?:\/\/localhost(:\d+)?$/.test(origin)) {
        return callback(null, true);
      }
      callback(new Error(`CORS: origin not allowed — ${origin}`));
    },
    credentials: true,
  }),
);

// ─── Request logging ──────────────────────────────────────────────────────────
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        // Strip query string from logs to avoid leaking sensitive params
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

// ─── Body parsing (with size limits) ─────────────────────────────────────────
app.use(express.json({ limit: "500kb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));

// ─── Session ──────────────────────────────────────────────────────────────────
const sessionSecret = process.env["SESSION_SECRET"];
if (!sessionSecret) {
  throw new Error("SESSION_SECRET environment variable is required but not set.");
}

const PgSession = connectPgSimple(session);
app.use(
  session({
    store: new PgSession({
      conString:
        process.env["NODE_ENV"] !== "production"
          ? process.env["DATABASE_URL"] ?? process.env["SUPABASE_DATABASE_URL"]
          : process.env["SUPABASE_DATABASE_URL"] ?? process.env["DATABASE_URL"],
      tableName: "user_sessions",
      createTableIfMissing: true,
    }),
    secret: sessionSecret,
    name: "wa.sid",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: "lax",
      secure: process.env["NODE_ENV"] === "production",
    },
  }),
);

// ─── Rate limiting ─────────────────────────────────────────────────────────────
// Auth routes: strict — 15 attempts per 15 minutes per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de tentatives, réessayez dans 15 minutes." },
  skipSuccessfulRequests: false,
});

// General API: 200 requests per minute per IP
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de requêtes, ralentissez." },
});

// ─── Routes ───────────────────────────────────────────────────────────────────
// Auth routes — public but rate-limited
app.use("/api/auth", authLimiter, authRouter);

// Protect all other /api routes + apply general rate limit
app.use("/api", apiLimiter, (req: Request, res: Response, next: NextFunction) => {
  const sess = req.session as { userId?: number };
  if (!sess.userId) {
    return res.status(401).json({ error: "Non authentifié" });
  }
  return next();
});

app.use("/api", router);

// ─── Serve built frontend in production / deployment ──────────────────────────
const FRONTEND_DIST = path.resolve(__dirname, "../../whatsapp-agent/dist/public");
if (existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST));
  app.get("/{*path}", (_req: Request, res: Response) => {
    res.sendFile(path.join(FRONTEND_DIST, "index.html"));
  });
}

// ─── Global error handler (no stack traces in production) ────────────────────
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  const isDev = process.env["NODE_ENV"] !== "production";
  logger.error({ err }, "Unhandled error");
  res.status(500).json({
    error: "Erreur interne du serveur",
    ...(isDev ? { detail: err.message } : {}),
  });
});

export default app;
