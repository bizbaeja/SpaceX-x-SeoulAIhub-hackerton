import "dotenv/config";
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
    }),
  });
  const created = (await createRes.json()) as { id: string };
  if (createRes.status !== 201) throw new Error("create failed");

  const note =
    "요즘 결석이 늘고 학교 가기 싫어한다고 함. 친구랑 다툰 뒤 잠을 못 자고 힘들어함.";

  const structureRes = await fetch(`${base}/api/cases/${created.id}/structure`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ note }),
  });
  const structured = (await structureRes.json()) as {
    profile: { suggestedUrgency: string; confirmedUrgency: null };
    provider: string;
  };
  if (
    structureRes.status !== 200 ||
    structured.profile.confirmedUrgency !== null
  ) {
    throw new Error(`structure failed: ${JSON.stringify(structured)}`);
  }

  const expectedProvider = process.env.GEMINI_API_KEY?.trim()
    ? "gemini"
    : "mock";
  if (structured.provider !== expectedProvider) {
    throw new Error(
      `provider expected ${expectedProvider}, got ${structured.provider}`
    );
  }
  if (
    expectedProvider === "mock" &&
    structured.profile.suggestedUrgency !== "HIGH"
  ) {
    throw new Error(`mock should suggest HIGH: ${JSON.stringify(structured)}`);
  }

  const confirmRes = await fetch(
    `${base}/api/cases/${created.id}/profile/confirm`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmedUrgency: "HIGH" }),
    }
  );
  if (confirmRes.status !== 200) {
    throw new Error(`confirm after structure failed: ${confirmRes.status}`);
  }
  const confirmed = (await confirmRes.json()) as {
    profile: { confirmedUrgency: string };
  };
  if (confirmed.profile.confirmedUrgency !== "HIGH") {
    throw new Error(`confirm payload mismatch: ${JSON.stringify(confirmed)}`);
  }

  const bare = await fetch(`${base}/api/cases`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      alias: "student-demo-002",
      ageBand: "13-18",
      region: "강남구",
    }),
  });
  const bareCase = (await bare.json()) as { id: string };
  const reject = await fetch(
    `${base}/api/cases/${bareCase.id}/profile/confirm`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmedUrgency: "HIGH" }),
    }
  );
  const rejectBody = (await reject.json()) as { error?: { code: string } };
  if (
    reject.status !== 422 ||
    rejectBody.error?.code !== "CONFIRMATION_REQUIRED"
  ) {
    throw new Error(
      `expected 422 before structure: ${JSON.stringify(rejectBody)}`
    );
  }

  console.log("smoke:structure OK", {
    caseId: created.id,
    provider: structured.provider,
    suggested: structured.profile.suggestedUrgency,
    confirmed: confirmed.profile.confirmedUrgency,
  });
  server.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
