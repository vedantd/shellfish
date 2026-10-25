import type {
  BorrowingMandate,
  EvidencePassport,
  LenderEvaluateResult,
  LenderFacilityOffer,
  OfferMatchResult,
} from "@shellfish/schemas";

export class NotImplementedError extends Error {
  constructor(feature: string) {
    super(`[compatibility] Not implemented: ${feature}`);
    this.name = "NotImplementedError";
  }
}

/** Independent lender underwriting (FR-04). Stub. */
export async function evaluateLender(
  _lenderId: string,
  _evidence: EvidencePassport,
): Promise<LenderEvaluateResult> {
  throw new NotImplementedError("evaluateLender");
}

/**
 * Intersect lender offer with borrower mandate (FR-05 / FR-06).
 * No LLM final permissions.
 */
export function matchOffers(_input: {
  mandate: BorrowingMandate;
  offers: LenderFacilityOffer[];
}): OfferMatchResult {
  throw new NotImplementedError("matchOffers");
}

export const packageOwner = "Gita" as const;
