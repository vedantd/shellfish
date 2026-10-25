export class NotImplementedError extends Error {
  constructor(feature: string) {
    super(`[registry] Not implemented: ${feature}`);
    this.name = "NotImplementedError";
  }
}

export type ReservationState =
  | "PENDING"
  | "RESERVED"
  | "COMMITTED"
  | "RELEASED"
  | "EXPIRED";

export interface FacilitySnapshot {
  facilityId: string;
  lenderId: string;
  borrowerId: string;
  approvedLimit: string;
  committed: string;
  reserved: string;
  asset: string;
  version: number;
}

/** Read facility headroom. Stub. */
export function getFacility(_facilityId: string): FacilitySnapshot {
  throw new NotImplementedError("getFacility");
}

/**
 * Atomically reserve lender headroom (FR-08).
 * Must use optimistic locking / serializable TX + idempotency on proposal_hash.
 */
export function reserveFacility(_input: {
  facilityId: string;
  proposalHash: string;
  amount: string;
  expiresAt: string;
}): { reservationId: string; state: ReservationState } {
  throw new NotImplementedError("reserveFacility");
}

/** Release or commit reservation after XRPL reconcile. Stub. */
export function settleReservation(_input: {
  reservationId: string;
  outcome: "COMMITTED" | "RELEASED";
}): void {
  throw new NotImplementedError("settleReservation");
}

export const packageOwner = "Gita" as const;
