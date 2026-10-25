/** Devnet routes verified against the current devnet.xrpl.org explorer router. */
export const DEVNET_EXPLORER = "https://devnet.xrpl.org";
export type ExplorerKind = "transaction" | "mpt" | "account";

export function devnetExplorerUrl(kind: ExplorerKind, value: unknown, native = false): string | null {
  if (!native || typeof value !== "string") return null;
  if (kind === "transaction" && /^[a-fA-F0-9]{64}$/.test(value))
    return `${DEVNET_EXPLORER}/transactions/${value.toUpperCase()}`;
  if (kind === "mpt" && /^[a-fA-F0-9]{48}$/.test(value))
    return `${DEVNET_EXPLORER}/mpt/${value.toUpperCase()}`;
  if (kind === "account" && /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(value))
    return `${DEVNET_EXPLORER}/accounts/${value}`;
  return null;
}

export function shortIdentifier(value: string): string {
  return value.length > 25 ? `${value.slice(0, 12)}…${value.slice(-8)}` : value;
}
