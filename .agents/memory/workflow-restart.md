---
name: Workflow restart EADDRINUSE
description: How to prevent port-in-use errors when Replit restarts a workflow that holds a TCP port.
---

**Rule:** Prefix each workflow shell command with `fuser -k <port>/tcp 2>/dev/null; sleep 1;` so the zombie process from the previous run is killed before the new server tries to bind.

**Why:** When Replit restarts a workflow, SIGTERM is sent to the process group, but the old Node.js process sometimes lingers. The new process starts immediately and hits EADDRINUSE. A retry loop inside index.ts (10 × 2 s) is not enough when the old process holds the port beyond the timeout.

**How to apply:** In .replit [[workflows.workflow.tasks]], set:
  args = "fuser -k 8080/tcp 2>/dev/null; sleep 1; pnpm --filter @workspace/api-server run dev"
Use verifyAndReplaceDotReplit to write .replit — direct edits are blocked.
