import { canonicalJson } from "@shellfish/schemas";
import { RegistryError } from "./registry.js";

export interface MptPaymentProjection {
    sender: string;
    destination: string;
    issuanceId: string;
    amountU: string;
}
function object(raw: unknown): Record<string, unknown> {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new RegistryError("INVALID_MPT_PAYMENT");
    return raw as Record<string, unknown>;
}

/**
 * Normalize a plain MPT Payment from signed JSON or API v2 transaction JSON.
 * This is parsing only. The native adapter must authenticate the transaction,
 * inspect delivered balance/supply changes and bind the saved attempt separately.
 * LoanPay.Amount is a spending maximum and must never pass through this function.
 */
export function projectMptPayment(raw: unknown): MptPaymentProjection {
    const tx = object(raw), flags = tx.Flags ?? 0;
    if (tx.TransactionType !== "Payment" || typeof tx.Account !== "string" || !tx.Account ||
        typeof tx.Destination !== "string" || !tx.Destination ||
        typeof flags !== "number" || !Number.isSafeInteger(flags) || flags < 0 || flags > 0xffffffff ||
        (flags !== 0 && flags !== 0x80000000) ||
        ["SendMax", "DeliverMin", "Paths"].some(field => tx[field] !== undefined))
        throw new RegistryError("INVALID_MPT_PAYMENT");
    const amount = tx.Amount, deliverMax = tx.DeliverMax;
    if (amount !== undefined && deliverMax !== undefined && canonicalJson(amount) !== canonicalJson(deliverMax))
        throw new RegistryError("PAYMENT_AMOUNT_ALIAS_CONFLICT");
    const value = object(amount ?? deliverMax);
    if (Object.keys(value).some(key => key !== "mpt_issuance_id" && key !== "value") ||
        typeof value.mpt_issuance_id !== "string" || !/^[A-Fa-f0-9]{48}$/.test(value.mpt_issuance_id) ||
        typeof value.value !== "string" || !/^[1-9][0-9]*$/.test(value.value))
        throw new RegistryError("INVALID_MPT_PAYMENT");
    return { sender: tx.Account, destination: tx.Destination,
        issuanceId: value.mpt_issuance_id.toUpperCase(), amountU: value.value };
}
