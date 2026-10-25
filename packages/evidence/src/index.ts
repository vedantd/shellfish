import type { EvidencePassport } from "@shellfish/schemas";

export class NotImplementedError extends Error {
  constructor(feature: string) {
    super(`[evidence] Not implemented: ${feature}`);
    this.name = "NotImplementedError";
  }
}

/** Fetch a versioned evidence passport (FR-03). Stub. */
export async function getEvidencePassport(
  _subjectId: string,
): Promise<EvidencePassport> {
  throw new NotImplementedError("getEvidencePassport");
}

/** Record repayment performance back into evidence history. Stub. */
export async function recordPerformanceEvent(_input: {
  subjectId: string;
  loanId: string;
  eventType: "on_time" | "late" | "default" | "repaid";
  amount: string;
}): Promise<void> {
  throw new NotImplementedError("recordPerformanceEvent");
}

export const packageOwner = "Gita" as const;
