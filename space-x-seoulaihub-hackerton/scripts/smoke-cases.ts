/**
 * Smoke: create → list → get without a long-running server.
 * Uses the same in-memory store via createApp + http.
 */
import { createServer } from "node:http";
import { createApp } from "../src/app.js";

async function main() {
  const app = createApp();
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("No port");
  const base = `http://127.0.0.1:${addr.port}`;

  const createRes = await fetch(`${base}/api/cases`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      alias: "student-demo-001",
      ageBand: "13-18",
      region: "강남구",
      consentStatus: "guardian_pending",
    }),
  });
  const created = (await createRes.json()) as { id: string };
  if (createRes.status !== 201 || !created.id) {
    throw new Error(`POST failed: ${createRes.status} ${JSON.stringify(created)}`);
  }

  const listRes = await fetch(`${base}/api/cases`);
  const list = (await listRes.json()) as { items: { id: string }[] };
  if (listRes.status !== 200 || !list.items.some((i) => i.id === created.id)) {
    throw new Error(`GET list failed: ${listRes.status}`);
  }

  const getRes = await fetch(`${base}/api/cases/${created.id}`);
  const detail = (await getRes.json()) as { id: string; note: string | null };
  if (getRes.status !== 200 || detail.id !== created.id) {
    throw new Error(`GET detail failed: ${getRes.status}`);
  }

  console.log("smoke:cases OK", {
    id: created.id,
    listCount: list.items.length,
    note: detail.note,
  });
  server.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
