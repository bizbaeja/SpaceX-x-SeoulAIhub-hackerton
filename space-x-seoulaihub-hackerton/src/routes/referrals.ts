import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { store } from "../store/memory.js";
import type { ActorRole, ReferralStatus } from "../types.js";

export const referralsRouter = Router();

const createSchema = z.object({
  caseId: z.string().uuid(),
  organizationId: z.string().min(1),
});

const requestInfoSchema = z.object({
  message: z.string().min(1),
});

function demoRole(req: Request): ActorRole {
  const role = req.header("x-demo-role")?.toLowerCase();
  return role === "organization" ? "organization" : "teacher";
}

function referralPayload(caseId: string) {
  const c = store.getCase(caseId);
  if (!c?.profile?.confirmedUrgency) return null;
  return {
    alias: c.alias,
    ageBand: c.ageBand,
    region: c.region,
    summary: c.profile.summary,
    confirmedUrgency: c.profile.confirmedUrgency,
    needs: c.profile.needs,
    consentStatus: c.consentStatus,
  };
}

referralsRouter.post("/", (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "Invalid body",
      },
    });
  }

  const { caseId, organizationId } = parsed.data;
  const caseRecord = store.getCase(caseId);
  if (!caseRecord) {
    return res.status(404).json({
      error: { code: "NOT_FOUND", message: "Case not found" },
    });
  }
  if (!caseRecord.profile?.confirmedUrgency) {
    return res.status(422).json({
      error: {
        code: "CONFIRMATION_REQUIRED",
        message: "confirmedUrgency required before referral",
      },
    });
  }
  if (!store.getOrganization(organizationId)) {
    return res.status(404).json({
      error: { code: "NOT_FOUND", message: "Organization not found" },
    });
  }

  const referral = store.createReferral({ caseId, organizationId });
  const payload = referralPayload(caseId)!;

  return res.status(201).json({
    id: referral.id,
    caseId: referral.caseId,
    organizationId: referral.organizationId,
    status: referral.status,
    payload,
    createdAt: referral.createdAt,
  });
});

function paramId(req: Request): string {
  const id = req.params.id;
  return Array.isArray(id) ? id[0]! : (id as string);
}

function transition(
  req: Request,
  res: Response,
  toStatus: ReferralStatus,
  meta?: Record<string, unknown>
) {
  const referral = store.getReferral(paramId(req));
  if (!referral) {
    return res.status(404).json({
      error: { code: "NOT_FOUND", message: "Referral not found" },
    });
  }
  if (referral.status !== "REQUESTED") {
    return res.status(409).json({
      error: {
        code: "INVALID_STATE",
        message: `Cannot move from ${referral.status} to ${toStatus}`,
      },
    });
  }

  const updated = store.updateReferralStatus({
    referralId: referral.id,
    toStatus,
    actorRole: demoRole(req),
    meta,
  });

  return res.json({
    id: updated!.id,
    status: updated!.status,
    updatedAt: updated!.updatedAt,
  });
}

referralsRouter.post("/:id/accept", (req, res) => {
  return transition(req, res, "ACCEPTED");
});

referralsRouter.post("/:id/request-info", (req, res) => {
  const parsed = requestInfoSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "Invalid body",
      },
    });
  }
  return transition(req, res, "INFO_REQUIRED", {
    message: parsed.data.message,
  });
});

referralsRouter.get("/:id/timeline", (req, res) => {
  const referral = store.getReferral(paramId(req));
  if (!referral) {
    return res.status(404).json({
      error: { code: "NOT_FOUND", message: "Referral not found" },
    });
  }

  const events = store.listReferralLogs(referral.id).map((log) => ({
    id: log.id,
    fromStatus: log.fromStatus,
    toStatus: log.toStatus,
    actorRole: log.actorRole,
    meta: log.meta,
    createdAt: log.createdAt,
  }));

  return res.json({
    referralId: referral.id,
    status: referral.status,
    events,
  });
});
