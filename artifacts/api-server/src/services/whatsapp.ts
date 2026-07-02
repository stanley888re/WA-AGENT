import { EventEmitter } from "events";
import { existsSync, mkdirSync, rmSync } from "fs";
import path from "path";
import pino from "pino";
import { db } from "@workspace/db";
import { agentsTable, conversationsTable, messagesTable, agentProductsTable, productsTable, appointmentsTable, ordersTable, blacklistTable, whatsappSessionsTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";

// ── PostgreSQL-backed Baileys auth state ─────────────────────────────────────
// Replaces useMultiFileAuthState (filesystem) so sessions survive Render restarts.
// key_name "creds" = AuthenticationCreds JSON
// key_name "{type}:{id}" = Signal protocol sub-keys
//
// IMPORTANT: BufferJSON and proto are passed in from the Baileys dynamic import
// so we can use the official replacer/reviver and AppStateSyncKeyData converter.
async function useDbAuthState(
  agentId: number,
  initAuthCreds: () => Record<string, unknown>,
  BufferJSON: { replacer(k: string, v: unknown): unknown; reviver(k: string, v: unknown): unknown },
  proto: { Message: { AppStateSyncKeyData: { fromObject(o: unknown): unknown } } },
): Promise<{
  state: { creds: Record<string, unknown>; keys: unknown };
  saveCreds: () => Promise<void>;
}> {
  // ── helpers ────────────────────────────────────────────────────────────────
  const serialize = (v: unknown) => JSON.stringify(v, BufferJSON.replacer);
  const deserialize = (s: string) => JSON.parse(s, BufferJSON.reviver);

  // ── load all keys for this agent in one query ──────────────────────────────
  const rows = await db
    .select()
    .from(whatsappSessionsTable)
    .where(eq(whatsappSessionsTable.agentId, agentId));

  const cache = new Map<string, unknown>(
    rows.map((r) => [r.keyName, deserialize(r.keyData)] as [string, unknown]),
  );

  // Use stored creds or generate fresh ones
  const creds = (cache.get("creds") as Record<string, unknown> | undefined) ?? initAuthCreds();

  const upsert = async (keyName: string, value: unknown) => {
    const keyData = serialize(value);
    await db
      .insert(whatsappSessionsTable)
      .values({ agentId, keyName, keyData, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [whatsappSessionsTable.agentId, whatsappSessionsTable.keyName],
        set: { keyData, updatedAt: new Date() },
      });
  };

  const deleteKey = async (keyName: string) => {
    await db
      .delete(whatsappSessionsTable)
      .where(
        and(
          eq(whatsappSessionsTable.agentId, agentId),
          eq(whatsappSessionsTable.keyName, keyName),
        ),
      );
  };

  // ── Signal key store ───────────────────────────────────────────────────────
  const keys = {
    get: async (type: string, ids: string[]): Promise<Record<string, unknown>> => {
      const result: Record<string, unknown> = {};
      for (const id of ids) {
        let v = cache.get(`${type}:${id}`);
        if (v === undefined) continue;
        // app-state-sync-key values must be deserialized through the proto definition
        if (type === "app-state-sync-key") {
          v = proto.Message.AppStateSyncKeyData.fromObject(v);
        }
        result[id] = v;
      }
      return result;
    },
    set: async (data: Record<string, Record<string, unknown | null>>): Promise<void> => {
      const ops: Promise<void>[] = [];
      for (const [type, values] of Object.entries(data)) {
        for (const [id, value] of Object.entries(values)) {
          const keyName = `${type}:${id}`;
          if (value == null) {
            cache.delete(keyName);
            ops.push(deleteKey(keyName));
          } else {
            cache.set(keyName, value);
            ops.push(upsert(keyName, value));
          }
        }
      }
      await Promise.all(ops);
    },
  };

  const saveCreds = async () => {
    cache.set("creds", creds);
    await upsert("creds", creds);
  };

  return { state: { creds, keys }, saveCreds };
}

export type WaSessionStatus = "connecting" | "qr_ready" | "pair_ready" | "connected" | "disconnected" | "error";

export interface WaSession {
  agentId: number;
  status: WaSessionStatus;
  qrCode: string | null;
  pairingCode: string | null;
  phone: string | null;
  lastError: string | null;
}

const silentLogger = pino({ level: "silent" });

// Strip ALL markdown/formatting symbols for clean WhatsApp messages
function stripMarkdown(text: string): string {
  return text
    .replace(/`{3}[\s\S]*?`{3}/g, "")             // remove code blocks entirely
    .replace(/`([^`]+)`/g, "$1")                   // `inline code` → plain text
    .replace(/\*{1,3}([^*\n]+)\*{1,3}/g, "$1")    // *bold*, **bold**, ***bold*** → plain
    .replace(/_{1,2}([^_\n]+)_{1,2}/g, "$1")       // _italic_, __bold__ → plain
    .replace(/~~([^~\n]+)~~/g, "$1")               // ~~strike~~ → plain
    .replace(/#{1,6}\s+(.+)/g, "$1")               // # Heading → plain heading
    .replace(/^\s*[-+]\s+/gm, "• ")                // - bullet → • bullet
    .replace(/^\s*\d+\.\s+/gm, (m) => m.trim())   // keep numbered lists
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")       // [link](url) → link text only
    .replace(/\n{3,}/g, "\n\n")                    // max 2 consecutive newlines
    .trim();
}

export async function callAI(
  agentPrompt: string,
  history: { role: string; content: string }[],
  userMessage: string,
  agentName: string,
  resources?: string | null,
  conversationSummary?: string | null
): Promise<string> {
  const recentHistory = history.slice(-10);
  const hasHistory = recentHistory.length > 0 || !!conversationSummary;

  const contextLines: string[] = [];

  // System prompt — placed prominently at the top
  contextLines.push("=== IDENTITÉ ET RÔLE ===");
  contextLines.push(`Tu es un assistant IA dont le nom est "${agentName}". C'est TON nom, pas le nom du client.`);
  contextLines.push(`Le client avec qui tu discutes est une personne différente de toi. Ne l'appelle JAMAIS par ton propre nom "${agentName}". Ne te confonds jamais avec le client.`);
  contextLines.push(`Quand tu te présentes, dis : "Je suis ${agentName}" — PAS "vous êtes ${agentName}" ni "je comprends que tu es ${agentName}".`);
  if (hasHistory) {
    contextLines.push(`IMPORTANT : Cette conversation est déjà en cours. NE PAS te réintroduire, NE PAS re-saluer le client comme si c'était une nouvelle conversation. Reprends naturellement là où vous en étiez.`);
  }
  contextLines.push("");
  contextLines.push("=== INSTRUCTIONS SYSTÈME OBLIGATOIRES ===");
  if (agentPrompt) {
    contextLines.push(agentPrompt);
  }
  contextLines.push("");
  contextLines.push("=== RÈGLE ABSOLUE — PRODUITS ET SERVICES ===");
  contextLines.push("Tu ne peux proposer, recommander, mentionner ou vendre QUE les produits et services explicitement listés dans ta base de connaissances (RESSOURCES ET CATALOGUE) ci-dessous.");
  contextLines.push("Si un client demande un produit ou service qui N'EST PAS dans ta liste : explique poliment que tu ne proposes pas cela, et oriente-le vers ce que tu as.");
  contextLines.push("Ne jamais inventer, supposer, adapter ou recommander un produit/service externe à ta liste. Aucune improvisation commerciale.");
  contextLines.push("");

  // Per-conversation memory (client-specific facts)
  if (conversationSummary && conversationSummary.trim()) {
    contextLines.push("=== MÉMOIRE DE CE CLIENT (faits établis dans les échanges précédents) ===");
    contextLines.push(conversationSummary.trim());
    contextLines.push("Utilise ces informations pour personnaliser tes réponses. Ne répète pas ces infos sauf si pertinent.");
    contextLines.push("");
  }

  // Resources / catalogue / links if provided
  if (resources && resources.trim()) {
    contextLines.push("=== RESSOURCES ET CATALOGUE ===");
    contextLines.push(resources.trim());
    contextLines.push("");
  }

  // Conversation history
  if (recentHistory.length > 0) {
    contextLines.push("=== HISTORIQUE RÉCENT DE LA CONVERSATION ===");
    for (const m of recentHistory) {
      if (m.role === "user") contextLines.push(`Client: ${m.content}`);
      else contextLines.push(`${agentName}: ${m.content}`);
    }
    contextLines.push("");
  }

  // Current message
  contextLines.push("=== MESSAGE ACTUEL ===");
  contextLines.push(`Client: ${userMessage}`);
  contextLines.push("");
  // APPT instruction placed LAST so the AI sees it immediately before responding
  contextLines.push("=== RÈGLE ABSOLUE — MARQUEUR RENDEZ-VOUS ===");
  contextLines.push("INSTRUCTION IMPÉRATIVE : Si dans ta réponse tu CONFIRMES un rendez-vous (tu connais : le nom du client, la date ET l'heure), alors tu DOIS OBLIGATOIREMENT terminer ton message par ce marqueur EXACTEMENT (sur une ligne séparée, RIEN après) :");
  contextLines.push('[APPT:{"clientName":"Prénom Nom","date":"2025-01-15","time":"14:30","notes":"motif du rdv"}]');
  contextLines.push("REMPLACE les valeurs par les vraies informations du client. Le marqueur est traité automatiquement et invisible pour le client.");
  contextLines.push("N'ajoute le marqueur QUE si tu confirmes explicitement le rendez-vous. Si des infos manquent (date ? heure ? nom ?), NE PAS mettre le marqueur, et demande les infos manquantes.");
  contextLines.push("");
  contextLines.push("=== RÈGLE ABSOLUE — COMMANDE PRODUIT ===");
  contextLines.push("INSTRUCTION IMPÉRATIVE : Quand un client s'intéresse à un produit ou souhaite commander, tu NE DOIS JAMAIS parler de paiement, de moyens de paiement, de virement, de carte bancaire, de prix à régler, ni de aucune modalité financière.");
  contextLines.push("À la place, dis simplement au client qu'un conseiller va le contacter très prochainement pour finaliser sa demande. Exemple : \"Parfait ! Un de nos conseillers va vous contacter très prochainement pour finaliser votre commande. 😊\"");
  contextLines.push("Tu DOIS OBLIGATOIREMENT terminer ton message par ce marqueur EXACTEMENT (sur une ligne séparée, RIEN après) dès que le client exprime clairement son intérêt pour un produit :");
  contextLines.push('[ORDER:{"clientName":"Prénom Nom","phone":"0612345678","productName":"Nom exact du produit","amount":50.00}]');
  contextLines.push("REMPLACE les valeurs par les vraies informations. N'invente pas de produit. Utilise UNIQUEMENT un produit de ta liste. Le marqueur est invisible pour le client.");
  contextLines.push("Ne demande JAMAIS de coordonnées bancaires, de preuve de paiement ou de virement. Le paiement est géré en dehors de cette conversation.");
  contextLines.push("");
  contextLines.push(`${agentName} (répondre maintenant en respectant TOUTES les règles ci-dessus) :`);

  const fullPrompt = contextLines.join("\n");

  const aiBaseUrl = process.env["AI_API_URL"];
  if (!aiBaseUrl) throw new Error("AI_API_URL environment variable is not set.");
  const apiUrl = `${aiBaseUrl}?message=${encodeURIComponent(fullPrompt)}&model=default`;

  console.log(`[AI] Calling API for message: "${userMessage.slice(0, 60)}"`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(apiUrl, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { answer?: string; response?: string; text?: string };
    const raw = data.answer ?? data.response ?? data.text ?? "";
    if (!raw) throw new Error("Empty response from AI");
    // Extract APPT marker BEFORE stripMarkdown (code blocks would erase it)
    const apptMarker = raw.match(/\[APPT:\s*\{[\s\S]*?\}\]/)?.[0] ?? null;
    const orderMarker = raw.match(/\[ORDER:\s*\{[\s\S]*?\}\]/)?.[0] ?? null;
    const cleaned = stripMarkdown(raw);
    // Re-append markers after cleanup so callers can extract them
    let result = cleaned;
    if (apptMarker) result += `\n${apptMarker}`;
    if (orderMarker) result += `\n${orderMarker}`;
    console.log(`[AI] Response: "${cleaned.slice(0, 100)}"${apptMarker ? " [APPT]" : ""}${orderMarker ? " [ORDER]" : ""}`);
    return result;
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[AI] Call failed: ${errMsg}`);
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function jidToPhone(jid: string): string {
  return jid.split("@")[0].split(":")[0];
}

// Auto-update per-conversation memory summary after each AI exchange
async function _autoUpdateConversationSummary(
  convId: number,
  contactName: string,
  userMsg: string,
  assistantMsg: string,
  existingSummary: string | null
): Promise<void> {
  const lines: string[] = [];
  if (existingSummary) lines.push(existingSummary);

  // Extract key facts from this exchange (simple rule-based, no extra AI call)
  const combined = `${userMsg} ${assistantMsg}`.toLowerCase();

  // Detect preferences / interests
  const interestKeywords = ["intéressé", "je veux", "j'aimerais", "je cherche", "je voudrais", "budget", "besoin", "commande", "acheter", "prendre"];
  const hasInterest = interestKeywords.some(k => combined.includes(k));
  if (hasInterest) {
    const snippet = userMsg.slice(0, 120);
    const fact = `- Intérêt exprimé: "${snippet}${userMsg.length > 120 ? "..." : ""}"`;
    if (!lines.includes(fact)) lines.push(fact);
  }

  // Update contact name if mentioned
  if (contactName && contactName !== "Unknown") {
    const nameFact = `- Prénom/nom du client: ${contactName}`;
    if (!lines.some(l => l.startsWith("- Prénom/nom"))) lines.push(nameFact);
  }

  // Keep summary concise: max 8 bullet points
  const factLines = lines.filter(l => l.startsWith("- ")).slice(-8);
  if (factLines.length === 0) return;

  const newSummary = factLines.join("\n");
  await db.update(conversationsTable)
    .set({ conversationSummary: newSummary })
    .where(eq(conversationsTable.id, convId));
}

interface AppointmentMarker {
  clientName: string;
  date: string;
  time: string;
  notes?: string;
}

function extractAppointmentMarker(text: string): { clean: string; appt: AppointmentMarker | null } {
  // Support both [APPT:{...}] and [APPT: {...}] with possible whitespace/newlines
  const match = text.match(/\[APPT:\s*(\{[\s\S]*?\})\]/);
  if (!match) return { clean: text, appt: null };
  try {
    const jsonStr = match[1]
      .replace(/[\u201C\u201D]/g, '"') // fix "smart quotes"
      .replace(/[\u2018\u2019]/g, "'");
    const appt = JSON.parse(jsonStr) as AppointmentMarker;
    if (!appt.clientName || !appt.date || !appt.time) {
      console.warn("[APPT] Marker found but missing required fields:", appt);
      return { clean: text, appt: null };
    }
    // Normalize date to YYYY-MM-DD if possible
    const dateStr = appt.date.trim();
    const clean = text.replace(/\n?\[APPT:\s*\{[\s\S]*?\}\]/g, "").trim();
    console.log(`[APPT] ✓ Marker extracted: ${appt.clientName} | ${dateStr} | ${appt.time}`);
    return { clean, appt: { ...appt, date: dateStr } };
  } catch (err) {
    console.warn("[APPT] Failed to parse marker JSON:", err, "| raw:", match[1].slice(0, 100));
    return { clean: text, appt: null };
  }
}

// ─── ORDER marker extraction ─────────────────────────────────────────────────

interface OrderMarker {
  clientName: string;
  phone: string;
  productName: string;
  amount: number;
}

function extractOrderMarker(text: string): { clean: string; order: OrderMarker | null } {
  const match = text.match(/\[ORDER:\s*(\{[\s\S]*?\})\]/);
  if (!match) return { clean: text, order: null };
  try {
    const jsonStr = match[1]
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2018\u2019]/g, "'");
    const order = JSON.parse(jsonStr) as OrderMarker;
    if (!order.clientName || !order.productName || order.amount === undefined) {
      console.warn("[ORDER] Marker missing required fields:", order);
      return { clean: text, order: null };
    }
    const clean = text.replace(/\n?\[ORDER:\s*\{[\s\S]*?\}\]/g, "").trim();
    console.log(`[ORDER] ✓ Extracted: ${order.clientName} | ${order.productName} | ${order.amount} €`);
    return { clean, order };
  } catch (err) {
    console.warn("[ORDER] Failed to parse JSON:", err, "| raw:", match[1].slice(0, 100));
    return { clean: text, order: null };
  }
}

// Fallback: if AI confirmed an appointment in plain text without the marker, extract it
const APPT_CONFIRM_KEYWORDS = [
  "confirmé", "réservé", "votre rendez-vous est", "rdv confirmé", "appointment confirmed",
  "rendez-vous confirmé", "créneau confirmé", "bien noté", "réservation confirmée",
  "rdv est pris", "rendez-vous est pris", "votre rdv", "je confirme", "c'est confirmé",
  "c'est noté", "c'est réservé", "est enregistré", "a été réservé", "a été confirmé",
  "je vous confirme", "votre réservation", "meeting confirmed", "appointment is set",
  "rendez-vous fixé", "rendez-vous planifié", "rdv planifié", "je note votre rdv",
];

export async function tryFallbackAppointmentExtract(
  aiResponse: string,
  conversationHistory: { role: string; content: string }[]
): Promise<AppointmentMarker | null> {
  const lower = aiResponse.toLowerCase();
  const hasConfirmation = APPT_CONFIRM_KEYWORDS.some(kw => lower.includes(kw));
  if (!hasConfirmation) return null;

  // Build a focused extraction prompt
  const historyText = conversationHistory.slice(-6).map(m =>
    m.role === "user" ? `Client: ${m.content}` : `Agent: ${m.content}`
  ).join("\n");

  const extractPrompt = `Voici une conversation entre un client et un agent :\n${historyText}\nAgent: ${aiResponse}\n\nExtrait les informations du rendez-vous confirmé. Réponds UNIQUEMENT avec le JSON suivant (rien d'autre, pas d'explication) :\n{"clientName":"PRENOM NOM","date":"YYYY-MM-DD","time":"HH:MM","notes":"service"}\nSi les informations sont incomplètes ou qu'il n'y a pas de rendez-vous confirmé, réponds uniquement: NON`;

  try {
    const aiBaseUrl = process.env["AI_API_URL"];
    if (!aiBaseUrl) return null;
    const apiUrl = `${aiBaseUrl}?message=${encodeURIComponent(extractPrompt)}&model=default`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(apiUrl, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json() as { answer?: string; response?: string; text?: string };
    const raw = (data.answer ?? data.response ?? data.text ?? "").trim();
    if (!raw || raw === "NON" || raw.toLowerCase().includes("non")) return null;
    // Try to parse JSON from response
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const appt = JSON.parse(jsonMatch[0]) as AppointmentMarker;
    if (appt.clientName && appt.date && appt.time) {
      console.log(`[APPT] Fallback extracted: ${appt.clientName} on ${appt.date} at ${appt.time}`);
      return appt;
    }
    return null;
  } catch (err) {
    console.error("[APPT] Fallback extraction failed:", err);
    return null;
  }
}

function extractTextFromMessage(msg: Record<string, unknown>): string | null {
  if (!msg) return null;
  const m = msg as Record<string, unknown>;

  // Direct text
  if (typeof m.conversation === "string" && m.conversation) return m.conversation;

  // Extended text
  const ext = m.extendedTextMessage as Record<string, unknown> | undefined;
  if (ext && typeof ext.text === "string" && ext.text) return ext.text;

  // Image caption
  const img = m.imageMessage as Record<string, unknown> | undefined;
  if (img && typeof img.caption === "string" && img.caption) return img.caption;

  // Video caption
  const vid = m.videoMessage as Record<string, unknown> | undefined;
  if (vid && typeof vid.caption === "string" && vid.caption) return vid.caption;

  // Button response
  const btn = m.buttonsResponseMessage as Record<string, unknown> | undefined;
  if (btn && typeof btn.selectedDisplayText === "string") return btn.selectedDisplayText;

  // List response
  const list = m.listResponseMessage as Record<string, unknown> | undefined;
  if (list && typeof list.title === "string") return list.title;

  return null;
}

type BaileysSocket = {
  ev: {
    on(event: string, handler: (...args: unknown[]) => void): void;
  };
  end(err?: Error): void;
  sendMessage(jid: string, content: { text: string }): Promise<unknown>;
  user?: { id?: string; name?: string };
};

class WhatsAppManager extends EventEmitter {
  private sessions = new Map<number, WaSession>();
  private sockets = new Map<number, BaileysSocket>();
  private reconnectTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private sessionsDir = "/tmp/wa-sessions";
  /** Monotonically-incrementing counter per agent.
   *  A _initBaileys call that holds stale generation will self-abort,
   *  preventing zombie sockets from overwriting state after stopSession. */
  private initGeneration = new Map<number, number>();

  private _nextGen(agentId: number): number {
    const next = (this.initGeneration.get(agentId) ?? 0) + 1;
    this.initGeneration.set(agentId, next);
    return next;
  }

  private _currentGen(agentId: number): number {
    return this.initGeneration.get(agentId) ?? 0;
  }

  constructor() {
    super();
    if (!existsSync(this.sessionsDir)) {
      mkdirSync(this.sessionsDir, { recursive: true });
    }
  }

  getSession(agentId: number): WaSession | null {
    return this.sessions.get(agentId) ?? null;
  }

  async startSession(agentId: number): Promise<WaSession> {
    const existing = this.sessions.get(agentId);
    if (existing?.status === "connected") return existing;

    await this.stopSession(agentId);

    const gen = this._nextGen(agentId);
    const session: WaSession = { agentId, status: "connecting", qrCode: null, pairingCode: null, phone: null, lastError: null };
    this.sessions.set(agentId, session);
    this._initBaileys(agentId, session, gen).catch(err => {
      if (this._currentGen(agentId) !== gen) return; // superseded — ignore
      session.status = "error";
      session.lastError = String(err);
      console.error(`[WA] Init failed for agent ${agentId}:`, err);
    });
    return session;
  }

  async stopSession(agentId: number, clearCreds = false): Promise<void> {
    // Bump generation so any in-flight _initBaileys will self-abort
    this._nextGen(agentId);

    // Cancel any pending reconnect timer first so it doesn't revive the session
    const timer = this.reconnectTimers.get(agentId);
    if (timer) { clearTimeout(timer); this.reconnectTimers.delete(agentId); }

    const sock = this.sockets.get(agentId);
    if (sock) {
      try { sock.end(); } catch { /* ignore */ }
      this.sockets.delete(agentId);
    }
    const session = this.sessions.get(agentId);
    if (session) { session.status = "disconnected"; session.qrCode = null; }
    this.sessions.delete(agentId);

    if (clearCreds) {
      // Clear DB-backed auth state so the next startSession begins fresh
      try {
        await db.delete(whatsappSessionsTable)
          .where(eq(whatsappSessionsTable.agentId, agentId));
      } catch { /* ignore */ }
      // Also clean up legacy filesystem sessions if they still exist
      const authDir = path.join(this.sessionsDir, `agent-${agentId}`);
      if (existsSync(authDir)) {
        try { rmSync(authDir, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    }
  }

  /**
   * Clear stored auth credentials for an agent without closing an active session.
   * Used before requesting a pairing code to ensure a clean slate.
   */
  async clearSessionCreds(agentId: number): Promise<void> {
    try {
      await db.delete(whatsappSessionsTable)
        .where(eq(whatsappSessionsTable.agentId, agentId));
    } catch { /* ignore */ }
    const authDir = path.join(this.sessionsDir, `agent-${agentId}`);
    if (existsSync(authDir)) {
      try { rmSync(authDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }

  /** Wait up to `timeoutMs` for the session to reach qr_ready or connected state. */
  async waitForSessionReady(agentId: number, timeoutMs = 30000): Promise<WaSession> {
    const deadline = Date.now() + timeoutMs;
    const secs = Math.round(timeoutMs / 1000);
    while (Date.now() < deadline) {
      const session = this.sessions.get(agentId);
      if (!session) throw new Error("Session introuvable");
      if (session.status === "qr_ready" || session.status === "connected") return session;
      if (session.status === "error") throw new Error(session.lastError ?? "Erreur de session WhatsApp");
      await new Promise(r => setTimeout(r, 400));
    }
    throw new Error(`Timeout : impossible de joindre les serveurs WhatsApp après ${secs}s. Vérifiez la connectivité réseau du serveur.`);
  }

  async requestPairingCode(agentId: number, phoneNumber: string): Promise<string> {
    const sock = this.sockets.get(agentId);
    if (!sock) throw new Error("Session non démarrée. Démarrez d'abord la session.");
    const session = this.sessions.get(agentId);
    if (session?.status === "connected") throw new Error("Déjà connecté.");
    // Baileys expects phone without + and without spaces, e.g. "33612345678"
    const phone = phoneNumber.replace(/\D/g, "");
    if (!phone || phone.length < 7) throw new Error("Numéro de téléphone invalide. Format attendu : code pays + numéro (ex: 33612345678)");
    const code = await (sock as unknown as { requestPairingCode(p: string): Promise<string> }).requestPairingCode(phone);
    if (session) {
      session.pairingCode = code;
      session.status = "pair_ready";
    }
    return code;
  }

  async sendMessageToJid(agentId: number, jid: string, text: string): Promise<boolean> {
    const sock = this.sockets.get(agentId);
    if (!sock) { console.warn(`[WA] No socket for agent ${agentId}`); return false; }
    // Baileys v7 requires sock.user to be defined (fully authenticated) before sending
    if (!sock.user?.id) { console.warn(`[WA] Socket not authenticated for agent ${agentId}, skip send`); return false; }
    try {
      await sock.sendMessage(jid, { text });
      return true;
    } catch (err) {
      console.error(`[WA] sendMessage failed for agent ${agentId} → ${jid}:`, err);
      return false;
    }
  }

  // Send a WhatsApp notification to the admin number — always uses the freshest socket,
  // retries up to 3 times with a 3-second delay between attempts.
  async sendAdminNotif(agentId: number, notifPhone: string, message: string): Promise<void> {
    const digits = notifPhone.replace(/\D/g, "");
    if (!digits) { console.warn(`[WA] sendAdminNotif: numéro vide (agent ${agentId})`); return; }
    const jid = `${digits}@s.whatsapp.net`;
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Always get the freshest socket from the map (not a stale closure reference)
      const activeSock = this.sockets.get(agentId);
      if (!activeSock) {
        console.warn(`[WA] ⚠️ Notif admin ignorée — pas de socket actif pour agent ${agentId} (tentative ${attempt}/${maxAttempts})`);
        if (attempt < maxAttempts) await new Promise(r => setTimeout(r, 3000));
        continue;
      }
      try {
        console.log(`[WA] 📤 Notif admin → ${digits} (agent ${agentId}, tentative ${attempt}/${maxAttempts})`);
        await activeSock.sendMessage(jid, { text: message });
        console.log(`[WA] ✅ Notif admin envoyée à ${digits} (agent ${agentId})`);
        return; // success
      } catch (err) {
        console.error(`[WA] ❌ Échec notif admin ${digits} (agent ${agentId}, tentative ${attempt}/${maxAttempts}):`, err);
        if (attempt < maxAttempts) await new Promise(r => setTimeout(r, 3000));
      }
    }
    console.error(`[WA] 🚨 Toutes les tentatives de notif admin ont échoué pour ${digits} (agent ${agentId})`);
  }

  private async _processMessage(
    agentId: number,
    sock: BaileysSocket,
    jid: string,
    senderName: string,
    text: string
  ): Promise<void> {
    console.log(`[WA] Processing message from ${jid} for agent ${agentId}: "${text.slice(0, 80)}"`);

    // Load agent config
    const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
    if (!agent) { console.warn(`[WA] Agent ${agentId} not found in DB`); return; }
    if (!agent.isActive) { console.log(`[WA] Agent ${agentId} is inactive, skipping`); return; }

    const phone = jidToPhone(jid);

    // Blacklist check — skip silently if the sender is blacklisted
    try {
      const [blacklisted] = await db.select().from(blacklistTable).where(eq(blacklistTable.phone, phone));
      if (blacklisted) {
        console.log(`[WA] Phone ${phone} is blacklisted (reason: ${blacklisted.reason ?? "none"}) — skipping`);
        return;
      }
    } catch (err) {
      console.warn(`[WA] Blacklist check failed for ${phone}:`, err);
    }

    // Working hours check — skip AI if outside configured hours
    try {
      const tz = agent.timezone || "UTC";
      const start = agent.workingHoursStart || "00:00";
      const end = agent.workingHoursEnd || "23:59";
      if (start !== "00:00" || end !== "23:59") {
        const now = new Date();
        const localTime = now.toLocaleTimeString("fr-FR", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });
        const [sh, sm] = start.split(":").map(Number);
        const [eh, em] = end.split(":").map(Number);
        const [lh, lm] = localTime.split(":").map(Number);
        const nowMin = lh * 60 + lm;
        const startMin = sh * 60 + sm;
        const endMin = eh * 60 + em;
        if (nowMin < startMin || nowMin > endMin) {
          console.log(`[WA] Outside working hours (${localTime} / ${start}-${end} ${tz}) — skipping AI for ${phone}`);
          return;
        }
      }
    } catch (err) {
      console.warn(`[WA] Working hours check failed:`, err);
    }

    // Upsert conversation
    let [conv] = await db.select().from(conversationsTable).where(
      and(eq(conversationsTable.agentId, agentId), eq(conversationsTable.jid, jid))
    );

    if (!conv) {
      console.log(`[WA] Creating new conversation for ${phone} (agent ${agentId})`);
      [conv] = await db.insert(conversationsTable).values({
        agentId,
        jid,
        contactName: senderName || phone,
        contactPhone: phone,
        mode: "automatic",
        agentName: agent.personaName || agent.name,
        messageCount: 1,
        lastMessage: text,
        lastMessageAt: new Date(),
      }).returning();

      // Notify admin of new lead
      const notifPhone = agent.notificationPhone?.trim();
      if (notifPhone) {
        const notifMsg =
          `📬 *Nouveau contact*\n` +
          `👤 Nom : ${senderName || "Inconnu"}\n` +
          `📱 Tél : ${phone}\n` +
          `🤖 Agent : ${agent.personaName || agent.name}\n` +
          `💬 Premier message : "${text.slice(0, 120)}${text.length > 120 ? "…" : ""}"`;
        this.sendAdminNotif(agentId, notifPhone, notifMsg).catch(err => console.error(`[WA] Notif nouveau contact échouée:`, err));
      }
    } else {
      await db.update(conversationsTable)
        .set({ lastMessage: text, lastMessageAt: new Date(), messageCount: (conv.messageCount ?? 0) + 1 })
        .where(eq(conversationsTable.id, conv.id));
    }

    // Load history BEFORE saving current message (so current msg isn't duplicated in context)
    const history = await db.select().from(messagesTable)
      .where(eq(messagesTable.conversationId, conv.id))
      .orderBy(messagesTable.createdAt);

    // Save incoming message
    await db.insert(messagesTable).values({ conversationId: conv.id, role: "user", content: text });

    if (conv.mode !== "automatic") {
      console.log(`[WA] Conv ${conv.id} is manual mode — skipping AI`);
      return;
    }

    // Anti-ban delay: wait responseDelay seconds before sending
    // + small jitter (0–2s) to simulate human typing and avoid WhatsApp bans
    const baseDelay = Math.min((agent.responseDelay ?? 3) * 1000, 60000);
    const jitter = Math.floor(Math.random() * 2000);
    const delay = baseDelay + jitter;
    if (delay > 0) await new Promise(r => setTimeout(r, delay));

    // Load agent-specific products and build product context
    let productContext = (agent as { resources?: string | null }).resources || null;
    try {
      const agentProductLinks = await db
        .select({ productId: agentProductsTable.productId })
        .from(agentProductsTable)
        .where(eq(agentProductsTable.agentId, agentId));

      if (agentProductLinks.length > 0) {
        const productIds = agentProductLinks.map(r => r.productId);
        const agentProds = await db.select().from(productsTable)
          .where(inArray(productsTable.id, productIds));

        if (agentProds.length > 0) {
          const prodLines = agentProds
            .filter(p => p.status === "active")
            .map(p => {
              let line = `• ${p.name} — ${Number(p.price).toFixed(2)} €`;
              if (p.description) line += ` | ${p.description}`;
              if (p.category) line += ` [${p.category}]`;
              if (p.link) line += ` | Lien: ${p.link}`;
              return line;
            });

          if (prodLines.length > 0) {
            const prodSection = `=== CATALOGUE PRODUITS DE CET AGENT ===\n${prodLines.join("\n")}\n`;
            productContext = productContext ? `${productContext}\n\n${prodSection}` : prodSection;
          }
        }
      }
    } catch (err) {
      console.error(`[WA] Failed to load agent products: ${err}`);
    }

    // Call AI with per-conversation memory
    let rawReply: string;
    try {
      rawReply = await callAI(agent.prompt ?? "", history, text, agent.personaName || agent.name, productContext, conv.conversationSummary ?? null);
    } catch (aiErr) {
      rawReply = agent.fallbackMessage || "Je suis désolé, je rencontre un problème technique. Réessayez dans un moment.";
      // Notify admin of AI error
      const notifPhone = agent.notificationPhone?.trim();
      if (notifPhone) {
        const errMsg = aiErr instanceof Error ? aiErr.message : String(aiErr);
        const notifMsg =
          `⚠️ *Erreur IA*\n` +
          `🤖 Agent : ${agent.personaName || agent.name}\n` +
          `📱 Contact : ${phone}\n` +
          `❌ Erreur : ${errMsg.slice(0, 200)}`;
        this.sendAdminNotif(agentId, notifPhone, notifMsg).catch(err => console.error(`[WA] Notif erreur IA échouée:`, err));
      }
    }

    // Extract appointment marker before sending
    const { clean: reply, appt } = extractAppointmentMarker(rawReply);

    const notifPhone = (agent as { notificationPhone?: string | null }).notificationPhone?.trim();
    const clientPhone = conv.contactPhone || jidToPhone(jid);
    const agentLabel = agent.personaName || agent.name;

    // Collect pending admin notifications — sent AFTER the reply is delivered
    const pendingNotifs: string[] = [];
    const queueNotif = (msg: string) => {
      if (!notifPhone) {
        console.warn(`[WA] ⚠️ Notification ignorée — notificationPhone non configuré (agent ${agentId})`);
        return;
      }
      console.log(`[WA] 📋 Notif admin en file d'attente (sera envoyée après la réponse client)`);
      pendingNotifs.push(msg);
    };

    // Auto-create appointment if AI confirmed one via marker
    let apptCreatedWA = false;
    if (appt) {
      try {
        await db.insert(appointmentsTable).values({
          agentId,
          userId: (agent as { userId?: number | null }).userId ?? null,
          clientName: appt.clientName,
          clientPhone,
          date: appt.date,
          time: appt.time,
          notes: appt.notes || `Rendez-vous confirmé automatiquement via WhatsApp (conv #${conv.id})`,
          status: "confirmed",
        });
        apptCreatedWA = true;
        console.log(`[WA] ✓ Auto-appointment created for ${appt.clientName} on ${appt.date} at ${appt.time}`);
        queueNotif(
          `🗓 *Nouveau rendez-vous confirmé*\n` +
          `👤 Client : ${appt.clientName}\n` +
          `📱 Tél : ${clientPhone}\n` +
          `📅 Date : ${appt.date}\n` +
          `🕐 Heure : ${appt.time}` +
          (appt.notes ? `\n📝 ${appt.notes}` : "") +
          `\n🤖 Agent : ${agentLabel}`
        );
      } catch (err) {
        console.error(`[WA] Failed to create auto-appointment:`, err);
      }
    }

    // Fallback: detect appointment confirmation in plain text without marker
    let fallbackApptCreated: AppointmentMarker | null = null;
    if (!apptCreatedWA) {
      try {
        const fullHistory = [...history, { role: "user" as const, content: text }];
        const fallbackAppt = await tryFallbackAppointmentExtract(reply, fullHistory);
        if (fallbackAppt) {
          await db.insert(appointmentsTable).values({
            agentId,
            userId: (agent as { userId?: number | null }).userId ?? null,
            clientName: fallbackAppt.clientName,
            clientPhone,
            date: fallbackAppt.date,
            time: fallbackAppt.time,
            notes: fallbackAppt.notes || `Rendez-vous confirmé via WhatsApp (conv #${conv.id})`,
            status: "confirmed",
          });
          fallbackApptCreated = fallbackAppt;
          console.log(`[WA] ✓ Fallback appointment created for ${fallbackAppt.clientName} on ${fallbackAppt.date} at ${fallbackAppt.time}`);
          queueNotif(
            `🗓 *Nouveau rendez-vous confirmé*\n` +
            `👤 Client : ${fallbackAppt.clientName}\n` +
            `📱 Tél : ${clientPhone}\n` +
            `📅 Date : ${fallbackAppt.date}\n` +
            `🕐 Heure : ${fallbackAppt.time}` +
            (fallbackAppt.notes ? `\n📝 ${fallbackAppt.notes}` : "") +
            `\n🤖 Agent : ${agentLabel}`
          );
        }
      } catch (err) {
        console.error(`[WA] Fallback appointment extraction failed:`, err);
      }
    }

    // Extract ORDER marker and create order in DB
    const { clean: replyFinal, order } = extractOrderMarker(reply);
    if (order) {
      try {
        await db.insert(ordersTable).values({
          userId: (agent as { userId?: number | null }).userId ?? null,
          leadName: order.clientName,
          leadPhone: order.phone || jidToPhone(jid),
          productName: order.productName,
          amount: String(order.amount),
          status: "pending",
        });
        console.log(`[WA] ✓ Order created: ${order.clientName} | ${order.productName} | ${order.amount} €`);
        queueNotif(
          `🛒 *Nouvelle commande*\n` +
          `👤 Client : ${order.clientName}\n` +
          `📱 Tél : ${order.phone || clientPhone}\n` +
          `📦 Produit : ${order.productName}\n` +
          `💰 Montant : ${order.amount} €\n` +
          `🤖 Agent : ${agentLabel}`
        );
      } catch (err) {
        console.error(`[WA] Failed to create order:`, err);
      }
    }

    // Enforce max length
    const maxLen = agent.maxResponseLength ?? 1000;
    const finalReply = replyFinal.length > maxLen ? replyFinal.slice(0, maxLen) : replyFinal;

    // Send reply via WhatsApp (requires authenticated socket)
    console.log(`[WA] Sending reply to ${jid}: "${finalReply.slice(0, 80)}"`);
    if (!sock.user?.id) {
      console.warn(`[WA] Socket not authenticated for agent ${agentId}, cannot send reply`);
      return;
    }
    await sock.sendMessage(jid, { text: finalReply });

    // Send pending admin notifications after reply confirmed sent — fire-and-forget async IIFE
    if (pendingNotifs.length > 0 && notifPhone) {
      const _notifPhone = notifPhone;
      const _agentId = agentId;
      (async () => {
        // 1-second head-start: let Baileys finish the send before we add more traffic
        await new Promise(r => setTimeout(r, 1000));
        for (const msg of pendingNotifs) {
          await this.sendAdminNotif(_agentId, _notifPhone, msg);
        }
      })().catch(err => console.error(`[WA] ❌ Bloc notif admin post-réponse échoué:`, err));
    }

    // Save assistant message & update conversation
    await db.insert(messagesTable).values({ conversationId: conv.id, role: "assistant", content: finalReply });
    await db.update(conversationsTable)
      .set({ lastMessage: finalReply, lastMessageAt: new Date(), messageCount: (conv.messageCount ?? 0) + 2 })
      .where(eq(conversationsTable.id, conv.id));

    this.emit("messageProcessed", agentId, conv.id);
    console.log(`[WA] ✓ Replied to ${phone} for agent ${agentId}`);

    // Auto-update per-conversation memory in background (non-blocking)
    _autoUpdateConversationSummary(conv.id, conv.contactName, text, finalReply, conv.conversationSummary ?? null).catch(err => {
      console.warn(`[WA] Summary update failed for conv ${conv.id}:`, err);
    });
  }

  private async _initBaileys(agentId: number, session: WaSession, gen: number): Promise<void> {
    const baileys = await import("@whiskeysockets/baileys");
    const makeWASocket = (baileys as unknown as { default: (c: object) => BaileysSocket }).default;
    const { initAuthCreds, BufferJSON, proto, DisconnectReason, Browsers } = baileys as unknown as {
      initAuthCreds: () => Record<string, unknown>;
      BufferJSON: { replacer(k: string, v: unknown): unknown; reviver(k: string, v: unknown): unknown };
      proto: { Message: { AppStateSyncKeyData: { fromObject(o: unknown): unknown } } };
      DisconnectReason: Record<string, number>;
      Browsers: { ubuntu: (client: string) => [string, string, string] };
    };

    // Guard: abort if a newer startSession has already superseded this one
    if (this._currentGen(agentId) !== gen) {
      console.log(`[WA] _initBaileys gen=${gen} superseded for agent ${agentId}, aborting`);
      return;
    }

    // Auth state backed by PostgreSQL — survives Render restarts/deploys
    // BufferJSON + proto passed in to correctly handle binary key material
    const { state, saveCreds } = await useDbAuthState(agentId, initAuthCreds, BufferJSON, proto);

    // Guard again after the async DB load
    if (this._currentGen(agentId) !== gen) {
      console.log(`[WA] _initBaileys gen=${gen} superseded (post-db) for agent ${agentId}, aborting`);
      return;
    }

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: silentLogger,
      connectTimeoutMs: 90000,
      qrTimeout: 90000,
      defaultQueryTimeoutMs: 60000,
      browser: Browsers.ubuntu("Chrome"),
      getMessage: async () => undefined,
      markOnlineOnConnect: true,
    });

    this.sockets.set(agentId, sock);

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (raw: unknown) => {
      // Stale init — ignore all events
      if (this._currentGen(agentId) !== gen) return;

      const update = raw as {
        connection?: string;
        lastDisconnect?: { error?: { output?: { statusCode?: number } } };
        qr?: string;
      };

      if (update.qr) {
        this._generateQrPng(update.qr).then(png => {
          if (this._currentGen(agentId) !== gen) return;
          session.qrCode = png;
          session.status = "qr_ready";
          this.emit("qr", agentId, png);
        }).catch(err => {
          if (this._currentGen(agentId) !== gen) return;
          console.error(`[WA] QR gen failed:`, err);
          session.status = "error";
          session.lastError = String(err);
        });
      }

      if (update.connection === "close") {
        const code = update.lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = code !== DisconnectReason.loggedOut;
        session.status = "disconnected";
        session.qrCode = null;

        // Try to notify admin BEFORE deleting socket
        if (shouldReconnect) {
          db.select({ notificationPhone: agentsTable.notificationPhone, name: agentsTable.name, personaName: agentsTable.personaName })
            .from(agentsTable).where(eq(agentsTable.id, agentId))
            .then(([ag]) => {
              const notifPhone = ag?.notificationPhone?.trim();
              if (notifPhone && sock) {
                const msg = `🔌 *WhatsApp déconnecté*\n🤖 Agent : ${ag.personaName || ag.name}\n⚠️ Code : ${code ?? "inconnu"}\n🔄 Reconnexion automatique en cours...`;
                this.sendAdminNotif(agentId, notifPhone, msg).catch(err => console.error(`[WA] Notif déconnexion échouée:`, err));
              }
            }).catch(() => {});
        }

        this.sockets.delete(agentId);

        if (shouldReconnect) {
          console.log(`[WA] Agent ${agentId} disconnected (code=${code}), reconnecting in 5s...`);
          const nextGen = this._nextGen(agentId);
          const timer = setTimeout(() => {
            this.reconnectTimers.delete(agentId);
            this._initBaileys(agentId, session, nextGen).catch(err => {
              if (this._currentGen(agentId) !== nextGen) return;
              session.status = "error";
              session.lastError = String(err);
            });
          }, 5000);
          this.reconnectTimers.set(agentId, timer);
        } else {
          console.log(`[WA] Agent ${agentId} logged out`);
          this.sessions.delete(agentId);
          db.update(agentsTable).set({ whatsappConnected: false, whatsappPhone: null })
            .where(eq(agentsTable.id, agentId)).catch(() => {});
        }
      }

      if (update.connection === "open") {
        if (this._currentGen(agentId) !== gen) return;
        const phone = sock.user?.id ? jidToPhone(sock.user.id) : null;
        session.status = "connected";
        session.qrCode = null;
        session.phone = phone;
        console.log(`[WA] Agent ${agentId} connected ✓ phone=${phone}`);
        this.emit("connected", agentId, phone);
      }
    });

    // ── CORE: Incoming messages ──────────────────────────────────────────────
    sock.ev.on("messages.upsert", (raw: unknown) => {
      // Stale init — discard
      if (this._currentGen(agentId) !== gen) return;
      const payload = raw as {
        messages: Array<{
          key: { remoteJid?: string; fromMe?: boolean; id?: string };
          pushName?: string;
          message?: Record<string, unknown>;
        }>;
        type: string;
      };

      console.log(`[WA] messages.upsert type=${payload.type} count=${payload.messages?.length}`);

      // Only process brand-new messages pushed to us (not history/append)
      if (payload.type !== "notify") return;

      for (const msg of payload.messages) {
        const jid = msg.key.remoteJid;
        if (!jid) continue;

        // Skip group messages
        if (jid.endsWith("@g.us") || jid.endsWith("@broadcast")) continue;

        // Skip our own outgoing messages
        if (msg.key.fromMe) {
          console.log(`[WA] Skipping outgoing self-message to ${jid}`);
          continue;
        }

        if (!msg.message) {
          console.log(`[WA] No message content in upsert for ${jid}`);
          continue;
        }

        const text = extractTextFromMessage(msg.message);
        if (!text) {
          console.log(`[WA] Could not extract text from message for ${jid}`);
          continue;
        }

        const senderName = msg.pushName ?? jidToPhone(jid);
        console.log(`[WA] ← New message from ${senderName} (${jid}): "${text.slice(0, 80)}"`);

        this._processMessage(agentId, sock, jid, senderName, text).catch(err => {
          console.error(`[WA] _processMessage error for agent ${agentId}:`, err);
        });
      }
    });
  }

  private async _generateQrPng(qrData: string): Promise<string> {
    const QRCode = (await import("qrcode")).default as {
      toDataURL(data: string, opts: object): Promise<string>;
    };
    return QRCode.toDataURL(qrData, { width: 300, margin: 2, color: { dark: "#000000", light: "#FFFFFF" } });
  }
}

export const waManager = new WhatsAppManager();
