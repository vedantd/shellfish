import type { AuthorizationReceipt, LenderFacilityOffer } from "@shellfish/schemas";
import type { CreditRegistry } from "@shellfish/registry";
import type { LiveLedger } from "@shellfish/xrpl";
import type { openFixtureCreditBackend } from "./db/fixtures.js";
import type { LiveCreditBackend } from "./live-backend.js";
import type { LiveRuntimeConfig } from "./live-config.js";

type SimBackend = ReturnType<typeof openFixtureCreditBackend>;

export type CreditBackend = (SimBackend | LiveCreditBackend) & {
  registry: CreditRegistry;
  live?: LiveLedger;
  liveConfig?: LiveRuntimeConfig;
  mode?: "LIVE_DEVNET" | "SIMULATED_LOAN";
};

let backend: CreditBackend | null = null;

export function getCreditBackend(): CreditBackend | null {
  return backend;
}

export function requireCreditBackend(): CreditBackend {
  if (!backend) {
    throw new Error(
      "Credit backend not initialized (set NETWORK_MODE and complete bootstrap)",
    );
  }
  return backend;
}

export function setCreditBackend(next: CreditBackend | null): void {
  backend = next;
}

export function storeReceipt(receipt: AuthorizationReceipt): void {
  requireCreditBackend().uiState.storeReceipt(receipt);
}

export function getReceipt(id: string): AuthorizationReceipt | undefined {
  return requireCreditBackend().uiState.getReceipt(id);
}

export function storeApprovedOffer(offer: LenderFacilityOffer): void {
  requireCreditBackend().uiState.storeApprovedOffer(offer);
}

export function getApprovedOffer(commercialTermsHash: string): LenderFacilityOffer | undefined {
  return requireCreditBackend().uiState.getApprovedOffer(commercialTermsHash);
}
