import { Router } from "express";
import { z } from "zod";
import { getStructureProvider } from "../ai/index.js";
import { store, toCaseDetail, toCaseListItem } from "../store/memory.js";

export const casesRouter = Router();

const createCaseSchema = z.object({
  alias: z.string().min(1),
  ageBand: z.string().min(1),
  region: z.string().min(1),
  consentStatus: z
    .enum(["guardian_pending", "guardian_granted", "guardian_denied"])
    .optional(),
});

const structureSchema = z.object({
  note: z.string().min(1),
});

const confirmSchema = z.object({
  confirmedUrgency: z.enum(["LOW", "MEDIUM", "HIGH"]),
  needs: z.array(z.string().min(1)).optional(),
  consentStatus: z
    .enum(["guardian_pending", "guardian_granted", "guardian_denied"])
    .optional(),
});

casesRouter.post("/", (req, res) => {
  const parsed = createCaseSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "Invalid body",
      },
    });
  }

  const created = store.createCase(parsed.data);
  return res.status(201).json({
    id: created.id,
    alias: created.alias,
    ageBand: created.ageBand,
    region: created.region,
    consentStatus: created.consentStatus,
    createdAt: created.createdAt,
  });
});

casesRouter.get("/", (_req, res) => {
  return res.json({ items: store.listCases().map(toCaseListItem) });
});

casesRouter.post("/:id/structure", async (req, res) => {
  const caseId = Array.isArray(req.params.id)
    ? req.params.id[0]
    : req.params.id;
  const found = store.getCase(caseId!);
  if (!found) {
    return res.status(404).json({
      error: { code: "NOT_FOUND", message: "Case not found" },
    });
  }

  const parsed = structureSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "Invalid body",
      },
    });
  }

  const note = parsed.data.note;
  // Same note already structured → reuse (no AI call)
  if (found.note === note && found.profile) {
    return res.json({
      caseId,
      profile: {
        ...found.profile,
        confirmedUrgency: null,
        confirmedAt: null,
      },
      provider: "cache",
    });
  }

  const provider = getStructureProvider();
  const profile = await provider.structure({ note });
  // Keep prior confirmation only if note unchanged — here note changed so reset
  const updated = store.updateCase(caseId!, {
    note,
    profile,
  });

  return res.json({
    caseId,
    profile: updated!.profile,
    provider: provider.name,
  });
});

casesRouter.post("/:id/profile/confirm", (req, res) => {
  const caseId = req.params.id;
  const found = store.getCase(caseId);
  if (!found) {
    return res.status(404).json({
      error: { code: "NOT_FOUND", message: "Case not found" },
    });
  }
  if (!found.profile) {
    return res.status(422).json({
      error: {
        code: "CONFIRMATION_REQUIRED",
        message: "Run structure before confirm",
      },
    });
  }

  const parsed = confirmSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "Invalid body",
      },
    });
  }

  const profile = {
    ...found.profile,
    needs: parsed.data.needs ?? found.profile.needs,
    confirmedUrgency: parsed.data.confirmedUrgency,
    confirmedAt: new Date().toISOString(),
  };

  const updated = store.updateCase(caseId, {
    profile,
    consentStatus: parsed.data.consentStatus ?? found.consentStatus,
  });

  return res.json({
    caseId,
    profile: updated!.profile,
    consentStatus: updated!.consentStatus,
  });
});

casesRouter.get("/:id", (req, res) => {
  const found = store.getCase(req.params.id);
  if (!found) {
    return res.status(404).json({
      error: { code: "NOT_FOUND", message: "Case not found" },
    });
  }
  return res.json(toCaseDetail(found));
});
