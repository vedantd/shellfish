import type { AuthorizationReceipt } from "@shellfish/schemas";
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
const receiptsByRequestId = new Map<string, AuthorizationReceipt>();
const receiptsById = new Map<string, AuthorizationReceipt>();

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
  receiptsByRequestId.set(receipt.request_id, receipt);
  const id = receipt.reservation_id ?? receipt.request_id;
  receiptsById.set(id, receipt);
  receiptsById.set(receipt.request_id, receipt);
}

export function getReceipt(id: string): AuthorizationReceipt | undefined {
  return receiptsById.get(id) ?? receiptsByRequestId.get(id);
}
