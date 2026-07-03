import app from "./app";
import { logger } from "./lib/logger";
import { runMigrations } from "./lib/migrate";
import { autoReconnectAgents } from "./routes/agents";
import { startDailySummaryScheduler } from "./services/dailySummary";

// Global safety nets: a single WhatsApp agent error (decrypt failure, socket
// glitch, etc.) must never take down the whole platform for every tenant.
// Without these, an unhandled promise rejection anywhere (e.g. inside a
// Baileys event handler) crashes the entire Node process by default.
process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "Unhandled promise rejection (ignored, server continues)");
});

process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception (ignored, server continues)");
});

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function startServer(maxRetries = 10, delayMs = 2000): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const server = app.listen(port, (err?: Error) => {
          if (err) { reject(err); return; }
          resolve();
        });
        server.on("error", reject);
      });
      logger.info({ port }, "Server listening");
      return;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EADDRINUSE" && attempt < maxRetries) {
        logger.warn({ port, attempt, maxRetries }, `Port ${port} busy, waiting ${delayMs}ms before retry...`);
        await new Promise(r => setTimeout(r, delayMs));
      } else {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }
    }
  }
  logger.error({ port, maxRetries }, "Failed to bind after all retries");
  process.exit(1);
}

// Run DB migrations, then start server, then auto-reconnect agents and start scheduler
// Order matters: migrations must complete before any DB query with new columns
runMigrations()
  .catch((err) => logger.error({ err }, "Migration failed — starting server anyway"))
  .finally(() => startServer())
  .then(() => autoReconnectAgents())
  .then(() => startDailySummaryScheduler())
  .catch((err) => logger.error({ err }, "Post-startup setup failed"));
