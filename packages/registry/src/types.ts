import { ScenarioFixture, type AssetRef, type AtomicReservationRequest, type CreditSnapshot, type NetworkMode, type RepAssetRef } from "@shellfish/schemas";
export const PortfolioSeedSchema = ScenarioFixture.omit({ provenance: true, native_signing_permitted: true });
export type NativePortfolioSeed = ReturnType<typeof PortfolioSeedSchema.parse>;
export type RequestState = "AWAITING_STAKE" | "STAKE_VALIDATED" | "RECONCILING" | "ACTIVE" | "CANCELLED" | "RETURN_PENDING" | "REPAID" | "DEFAULTED";
export interface ReservationRecord {
    requestId: string;
    reservationId: string;
    state: RequestState;
    payloadHash: string;
    request: AtomicReservationRequest;
    principalMinor: string;
    originalBondU: string;
    exposureBeforeMinor: string;
    exposureVersion: number;
    stakeHash: string | null;
    loanId: string | null;
}
export interface FacilitySnapshot {
    facilityId: string;
    lenderId: string;
    principalId: string;
    network: string;
    asset: AssetRef;
    approvedLimitMinor: string;
    committedMinor: string;
    reservedMinor: string;
    headroomMinor: string;
    version: number;
}
export interface PortfolioBinding {
    principalId: string;
    network: string;
    asset: AssetRef;
}
export interface EventBinding {
    principalId: string;
    network: string;
    mode: NetworkMode;
    asset: AssetRef;
    repAsset: RepAssetRef;
    borrowerAccount: string;
    policyHash: string;
    request: ReservationRecord | null;
    returnCredit: ReturnCredit | null;
    /** Internal verifier projection. Signed blobs stay in the execution store. */
    returnAttempt: {
        attemptHash: string; sequence: number; firstLedgerSequence: number;
        lastLedgerSequence: number; commitment: string; preparedFields: Record<string, unknown>;
    } | null;
}
export interface NativeEvidence {
    txHash: string;
    ledgerIndex: number;
    transactionIndex: number;
    validated: boolean;
    result: "tesSUCCESS" | "CONCLUSIVE_FAILURE";
    transactionType: string;
}
export interface RegistryEvent {
    eventId: string;
    kind: "STAKE_VALIDATED" | "ORIGINATION_VALIDATED" | "UNKNOWN" | "CANCEL_BEFORE_BURN" | "FAIL_AFTER_BURN" | "REPAYMENT" | "DEFAULT" | "IMPAIRMENT" | "UNIMPAIRMENT" | "RETURN_VALIDATED";
    occurredAt: number;
    requestId?: string;
    loanId?: string;
    creditId?: string;
    native?: NativeEvidence;
    stake?: {
        amountU: string;
        repAsset: RepAssetRef;
        sender: string;
        destination: string;
        requestHash: string;
        partialPayment: false;
    };
    loan?: {
        loanId: string;
        maturityAt: number;
        graceSeconds: number;
        nextPaymentDueAt?: number;
    };
    repayment?: {
        principalReductionMinor: string;
        fullContractualRepayment: boolean;
        onTime: boolean;
        nextPaymentDueAt?: number;
    };
    history?: {
        complete: true;
        originHash: string;
        previousEventId: string | null;
    };
    /** Verified post-LoanManage schedule, in Unix seconds. Never inferred from local overdue status. */
    servicing?: {
        nextPaymentDueAt: number;
    };
    returned?: {
        /** Required for a persisted simulated return. Native events use native.txHash. */
        attemptHash?: string;
        amountU: string;
        repAsset: RepAssetRef;
        sender: string;
        destination: string;
        partialPayment: false;
    };
    conclusive?: true;
}
export interface RegistryOptions {
    now?: () => Date;
    /** Trusted adapter hook. Called outside the SQL transaction. Never accept a client boolean as proof. */
    verifyNativeEvent?: (event: Readonly<RegistryEvent>, binding: Readonly<EventBinding>) => Promise<void>;
    verifyNativePortfolio?: (seed: Readonly<NativePortfolioSeed>, borrowerAccount: string, evidence: unknown) => Promise<void>;
}
export interface PortfolioSnapshot extends CreditSnapshot {
    portfolioKey: string;
}
export interface ReturnCredit {
    creditId: string;
    requestId: string | null;
    loanId: string | null;
    amountU: string;
    growthU: string;
    reason: "REPAYMENT" | "FAILED_ORIGINATION";
    state: "OWED" | "PAID";
    returnHash: string | null;
}
