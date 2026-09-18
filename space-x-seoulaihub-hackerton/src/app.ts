import cors from "cors";
import express from "express";
import { casesRouter } from "./routes/cases.js";
import { referralsRouter } from "./routes/referrals.js";

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/api/cases", casesRouter);
  app.use("/api/referrals", referralsRouter);

  return app;
}
