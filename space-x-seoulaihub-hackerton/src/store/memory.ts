import { randomUUID } from "node:crypto";
import type {
  CaseProfile,
  CaseRecord,
  ConsentStatus,
  Organization,
  Referral,
  ReferralLog,
  Service,
} from "../types.js";

/** In-memory store for MVP smoke before Supabase is wired. */
export class MemoryStore {
  cases = new Map<string, CaseRecord>();
  organizations = new Map<string, Organization>();
  services = new Map<string, Service>();
  referrals = new Map<string, Referral>();
  referralLogs: ReferralLog[] = [];

  createCase(input: {
    alias: string;
    ageBand: string;
    region: string;
    consentStatus?: ConsentStatus;
  }): CaseRecord {
    const record: CaseRecord = {
      id: randomUUID(),
      alias: input.alias,
      ageBand: input.ageBand,
      region: input.region,
      note: null,
      consentStatus: input.consentStatus ?? "guardian_pending",
      profile: null,
      createdAt: new Date().toISOString(),
    };
    this.cases.set(record.id, record);
    return record;
  }

  listCases(): CaseRecord[] {
    return [...this.cases.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );
  }

  getCase(id: string): CaseRecord | undefined {
    return this.cases.get(id);
  }

  updateCase(
    id: string,
    patch: Partial<Pick<CaseRecord, "note" | "consentStatus" | "profile">>
  ): CaseRecord | undefined {
    const current = this.cases.get(id);
    if (!current) return undefined;
    const next = { ...current, ...patch };
    this.cases.set(id, next);
    return next;
  }

  seedDemoOrgs(): void {
    if (this.organizations.size > 0) return;
    const orgs: Organization[] = [
      {
        id: "org-a",
        name: "강남 청소년상담복지센터",
        region: "강남구",
        ageMin: 13,
        ageMax: 24,
        emergencyCapable: true,
        availability: "AVAILABLE",
      },
      {
        id: "org-b",
        name: "강남 학업지원센터",
        region: "강남구",
        ageMin: 13,
        ageMax: 18,
        emergencyCapable: false,
        availability: "AVAILABLE",
      },
      {
        id: "org-c",
        name: "서울 전역 심리지원단",
        region: "서울",
        ageMin: 13,
        ageMax: 24,
        emergencyCapable: true,
        availability: "WAITLIST",
      },
      {
        id: "org-d",
        name: "수원 청소년상담센터",
        region: "수원",
        ageMin: 13,
        ageMax: 24,
        emergencyCapable: true,
        availability: "AVAILABLE",
      },
      {
        id: "org-e",
        name: "강남 학교적응지원센터",
        region: "강남구",
        ageMin: 13,
        ageMax: 18,
        emergencyCapable: true,
        availability: "AVAILABLE",
      },
    ];
    for (const org of orgs) this.organizations.set(org.id, org);

    const services: Service[] = [
      { id: "svc-a1", organizationId: "org-a", needTags: ["심리상담"] },
      { id: "svc-b1", organizationId: "org-b", needTags: ["학업지원"] },
      { id: "svc-c1", organizationId: "org-c", needTags: ["심리상담"] },
      { id: "svc-d1", organizationId: "org-d", needTags: ["심리상담"] },
      { id: "svc-e1", organizationId: "org-e", needTags: ["학교적응"] },
      {
        id: "svc-a2",
        organizationId: "org-a",
        needTags: ["심리상담", "학교적응"],
      },
    ];
    for (const svc of services) this.services.set(svc.id, svc);
  }

  getOrganization(id: string): Organization | undefined {
    return this.organizations.get(id);
  }

  getReferral(id: string): Referral | undefined {
    return this.referrals.get(id);
  }

  createReferral(input: {
    caseId: string;
    organizationId: string;
  }): Referral {
    const now = new Date().toISOString();
    const referral: Referral = {
      id: randomUUID(),
      caseId: input.caseId,
      organizationId: input.organizationId,
      status: "REQUESTED",
      createdAt: now,
      updatedAt: now,
    };
    this.referrals.set(referral.id, referral);
    this.appendReferralLog({
      referralId: referral.id,
      fromStatus: null,
      toStatus: "REQUESTED",
      actorRole: "teacher",
      meta: { organizationId: input.organizationId },
    });
    return referral;
  }

  updateReferralStatus(input: {
    referralId: string;
    toStatus: Referral["status"];
    actorRole: ReferralLog["actorRole"];
    meta?: Record<string, unknown>;
  }): Referral | undefined {
    const current = this.referrals.get(input.referralId);
    if (!current) return undefined;
    const updated: Referral = {
      ...current,
      status: input.toStatus,
      updatedAt: new Date().toISOString(),
    };
    this.referrals.set(updated.id, updated);
    this.appendReferralLog({
      referralId: updated.id,
      fromStatus: current.status,
      toStatus: input.toStatus,
      actorRole: input.actorRole,
      meta: input.meta ?? {},
    });
    return updated;
  }

  appendReferralLog(input: {
    referralId: string;
    fromStatus: Referral["status"] | null;
    toStatus: Referral["status"];
    actorRole: ReferralLog["actorRole"];
    meta?: Record<string, unknown>;
  }): ReferralLog {
    const log: ReferralLog = {
      id: randomUUID(),
      referralId: input.referralId,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      actorRole: input.actorRole,
      meta: input.meta ?? {},
      createdAt: new Date().toISOString(),
    };
    this.referralLogs.push(log);
    return log;
  }

  listReferralLogs(referralId: string): ReferralLog[] {
    return this.referralLogs
      .filter((log) => log.referralId === referralId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}

export const store = new MemoryStore();
store.seedDemoOrgs();

export function toCaseListItem(c: CaseRecord) {
  return {
    id: c.id,
    alias: c.alias,
    ageBand: c.ageBand,
    region: c.region,
    hasProfile: c.profile !== null,
    confirmedUrgency: c.profile?.confirmedUrgency ?? null,
    createdAt: c.createdAt,
  };
}

export function toCaseDetail(c: CaseRecord) {
  return {
    id: c.id,
    alias: c.alias,
    ageBand: c.ageBand,
    region: c.region,
    consentStatus: c.consentStatus,
    note: c.note,
    profile: c.profile,
    createdAt: c.createdAt,
  };
}

export type { CaseProfile };
