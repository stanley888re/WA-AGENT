import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
  listUpcomingEvents,
  createEvent,
  deleteEvent,
  getCalendarInfo,
} from "../services/googleCalendar";

const router = Router();

// ── Admin guard ──────────────────────────────────────────────────────────────
// The Google Calendar is a shared, platform-level resource (single OAuth token
// from env vars). Exposing it to all users would let any user read/modify the
// calendar of whoever configured the integration. Restrict to admins only.
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const session = req.session as { userId?: number; userRole?: string };
  if (!session.userId) return res.status(401).json({ error: "Non authentifié" });
  if (session.userRole !== "admin") return res.status(403).json({ error: "Accès réservé aux administrateurs" });
  return next();
}

router.use(requireAdmin);

// ── Zod schemas ──────────────────────────────────────────────────────────────
const CreateEventBody = z.object({
  title:           z.string().min(1).max(500),
  date:            z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format YYYY-MM-DD requis"),
  time:            z.string().regex(/^\d{2}:\d{2}$/, "Format HH:MM requis"),
  durationMinutes: z.number().int().min(5).max(1440).optional().default(60),
  description:     z.string().max(2000).optional(),
  location:        z.string().max(500).optional(),
});

const safeError = (err: unknown) =>
  err instanceof Error ? err.message.slice(0, 200) : "Erreur interne";

// ── Routes ───────────────────────────────────────────────────────────────────

router.get("/calendar/status", async (_req, res) => {
  try {
    const info = await getCalendarInfo();
    return res.json({ connected: true, email: info.email });
  } catch (err: unknown) {
    console.error("[GoogleCalendar] status error:", safeError(err));
    return res.json({ connected: false, email: null });
  }
});

router.get("/calendar/events", async (req, res) => {
  try {
    const raw = Number(req.query.max);
    const max = Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), 100) : 20;
    const events = await listUpcomingEvents(max);
    return res.json(events);
  } catch (err) {
    console.error("[GoogleCalendar] list error:", safeError(err));
    return res.status(500).json({ error: "Impossible de récupérer les événements" });
  }
});

router.post("/calendar/events", async (req, res) => {
  const parsed = CreateEventBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  try {
    const event = await createEvent(parsed.data);
    return res.status(201).json(event);
  } catch (err) {
    console.error("[GoogleCalendar] create error:", safeError(err));
    return res.status(500).json({ error: "Impossible de créer l'événement" });
  }
});

router.delete("/calendar/events/:eventId", async (req, res) => {
  const eventId = req.params.eventId;
  if (!eventId || typeof eventId !== "string" || eventId.length > 200) {
    return res.status(400).json({ error: "eventId invalide" });
  }
  try {
    await deleteEvent(eventId);
    return res.status(204).send();
  } catch (err) {
    console.error("[GoogleCalendar] delete error:", safeError(err));
    return res.status(500).json({ error: "Impossible de supprimer l'événement" });
  }
});

export default router;
