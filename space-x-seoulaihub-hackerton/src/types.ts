export type Urgency = "LOW" | "MEDIUM" | "HIGH";
export type ConsentStatus =
  | "guardian_pending"
  | "guardian_granted"
  | "guardian_denied";
export type Availability = "AVAILABLE" | "WAITLIST" | "UNAVAILABLE";
export type ReferralStatus = "REQUESTED" | "ACCEPTED" | "INFO_REQUIRED";
export type ActorRole = "teacher" | "organization";

export type CaseProfile = {
  summary: string;
  riskTypes: string[];
  needs: string[];
  suggestedUrgency: Urgency;
  confirmedUrgency: Urgency | null;
  confirmedAt: string | null;
};

export type CaseRecord = {
  id: string;
  alias: string;
  ageBand: string;
  region: string;
  note: string | null;
  consentStatus: ConsentStatus;
  profile: CaseProfile | null;
  createdAt: string;
};

export type Organization = {
  id: string;
  name: string;
  region: string;
  ageMin: number;
  ageMax: number;
  emergencyCapable: boolean;
  availability: Availability;
};

export type Service = {
  id: string;
  organizationId: string;
  needTags: string[];
};

export type Referral = {
  id: string;
  caseId: string;
  organizationId: string;
  status: ReferralStatus;
  createdAt: string;
  updatedAt: string;
};

export type ReferralLog = {
  id: string;
  referralId: string;
  fromStatus: ReferralStatus | null;
  toStatus: ReferralStatus;
  actorRole: ActorRole;
  meta: Record<string, unknown>;
  createdAt: string;
};
