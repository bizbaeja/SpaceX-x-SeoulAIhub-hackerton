import "dotenv/config";
import { createServer } from "node:http";
import { createApp } from "../src/app.js";

async function json(res: Response) {
  return res.json() as Promise<Record<string, unknown>>;
}

async function main() {
  const app = createApp();
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("No port");
  const base = `http://127.0.0.1:${addr.port}`;

  // Minimal confirmed case fixture (재민 Case단과 계약만 맞춤)
  const createRes = await fetch(`${base}/api/cases`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      alias: "student-demo-001",
      ageBand: "13-18",
      region: "강남구",
      consentStatus: "guardian_granted",
    }),
  });
  const created = (await json(createRes)) as { id: string };
  if (createRes.status !== 201) throw new Error("case create failed");

  const structureRes = await fetch(`${base}/api/cases/${created.id}/structure`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      note: "결석이 늘고 친구랑 다툰 뒤 잠을 못 자고 힘들어함.",
    }),
  });
  if (structureRes.status !== 200) throw new Error("structure failed");

  const confirmRes = await fetch(
    `${base}/api/cases/${created.id}/profile/confirm`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        confirmedUrgency: "HIGH",
        needs: ["심리상담"],
        consentStatus: "guardian_granted",
      }),
    }
  );
  if (confirmRes.status !== 200) throw new Error("confirm failed");

  const blocked = await fetch(`${base}/api/referrals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      caseId: created.id,
      organizationId: "missing-org",
    }),
  });
  if (blocked.status !== 404) throw new Error("expected org 404");

  const createRef = await fetch(`${base}/api/referrals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      caseId: created.id,
      organizationId: "org-a",
    }),
  });
  const referral = (await json(createRef)) as {
    id: string;
    status: string;
    payload: { confirmedUrgency: string; note?: string };
  };
  if (createRef.status !== 201 || referral.status !== "REQUESTED") {
    throw new Error(`create referral failed: ${JSON.stringify(referral)}`);
  }
  if ("note" in referral.payload) {
    throw new Error("payload must not include note");
  }

  const accept = await fetch(`${base}/api/referrals/${referral.id}/accept`, {
    method: "POST",
    headers: { "x-demo-role": "organization" },
  });
  const accepted = (await json(accept)) as { status: string };
  if (accept.status !== 200 || accepted.status !== "ACCEPTED") {
    throw new Error(`accept failed: ${JSON.stringify(accepted)}`);
  }

  const again = await fetch(`${base}/api/referrals/${referral.id}/accept`, {
    method: "POST",
    headers: { "x-demo-role": "organization" },
  });
  if (again.status !== 409) throw new Error("expected 409 on second accept");

  // second referral for INFO_REQUIRED path
  const createRef2 = await fetch(`${base}/api/referrals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      caseId: created.id,
      organizationId: "org-e",
    }),
  });
  const referral2 = (await json(createRef2)) as { id: string };
  const info = await fetch(
    `${base}/api/referrals/${referral2.id}/request-info`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-demo-role": "organization",
      },
      body: JSON.stringify({ message: "보호자 동의 서류 확인 필요" }),
    }
  );
  const infoBody = (await json(info)) as { status: string };
  if (info.status !== 200 || infoBody.status !== "INFO_REQUIRED") {
    throw new Error(`request-info failed: ${JSON.stringify(infoBody)}`);
  }

  const timeline = await fetch(
    `${base}/api/referrals/${referral.id}/timeline`
  );
  const tl = (await json(timeline)) as {
    status: string;
    events: Array<{ toStatus: string }>;
  };
  if (
    timeline.status !== 200 ||
    tl.status !== "ACCEPTED" ||
    tl.events.length < 2 ||
    tl.events[0]?.toStatus !== "REQUESTED" ||
    tl.events[1]?.toStatus !== "ACCEPTED"
  ) {
    throw new Error(`timeline failed: ${JSON.stringify(tl)}`);
  }

  console.log("smoke:referrals OK", {
    acceptedId: referral.id,
    infoRequiredId: referral2.id,
    timelineEvents: tl.events.length,
  });
  server.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
