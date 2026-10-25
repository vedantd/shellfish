import type {
  AuthorizationReceipt,
  BorrowingMandate,
  LenderFacilityOffer,
} from "@shellfish/schemas";

export class NotImplementedError extends Error {
  constructor(feature: string) {
    super(`[authorization] Not implemented: ${feature}`);
    this.name = "NotImplementedError";
  }
}

/** Verify a principal-signed mandate (FR-02). Stub. */
export function verifyMandate(_mandate: BorrowingMandate): boolean {
  throw new NotImplementedError("verifyMandate");
}

/**
 * Deterministic ALLOW/DENY on exact proposed terms (FR-07).
 * Must never use an LLM for final permission.
 */
export function authorizeExactAction(_input: {
  mandate: BorrowingMandate;
  offer: LenderFacilityOffer;
  proposalHash: string;
  evidenceFresh: boolean;
}): AuthorizationReceipt {
  throw new NotImplementedError("authorizeExactAction");
}

export const packageOwner = "You" as const;
