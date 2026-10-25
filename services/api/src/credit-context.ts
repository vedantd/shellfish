import type { AuthorizationReceipt } from "@shellfish/schemas";
import { openFixtureCreditBackend } from "./db/fixtures.js";

export type CreditBackend = ReturnType<typeof openFixtureCreditBackend>;

let backend: CreditBackend | null = null;
const receiptsByRequestId = new Map<string, AuthorizationReceipt>();
const receiptsById = new Map<string, AuthorizationReceipt>();

export function getCreditBackend(): CreditBackend | null {
  return backend;
}

export function requireCreditBackend(): CreditBackend {
  if (!backend) {
    throw new Error("Credit backend not initialized (SIMULATED_LOAN bootstrap required)");
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
