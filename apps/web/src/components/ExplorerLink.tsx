import type { ReactNode } from "react";
import { formatAsset } from "../lib/api";
import { devnetExplorerUrl, shortIdentifier, type ExplorerKind } from "../lib/explorer";

export function ExplorerLink({ kind, value, native = false, children, compact = true }: {
  kind: ExplorerKind; value: unknown; native?: boolean; children?: ReactNode; compact?: boolean;
}) {
  const text = typeof value === "string" ? value : "—";
  const href = devnetExplorerUrl(kind, value, native);
  const content = children ?? (compact ? shortIdentifier(text) : text);
  if (!href) return <span className="mono" title={text}>{content}</span>;
  return <a className="explorer-link mono" href={href} target="_blank" rel="noopener noreferrer"
    title={text} aria-label={`Open ${kind} ${text} on XRPL Devnet`}>
    <span>{content}</span><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M14 4h6v6M20 4 10 14"/><path d="M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5"/></svg>
  </a>;
}

export function AssetDisplay({ asset, native = false }: { asset: unknown; native?: boolean }) {
  const value = asset && typeof asset === "object" ? asset as { currency?: string; issuer?: string; mpt_issuance_id?: string } : undefined;
  if (value?.mpt_issuance_id) return <ExplorerLink kind="mpt" value={value.mpt_issuance_id} native={native}>MPT · {shortIdentifier(value.mpt_issuance_id)}</ExplorerLink>;
  return <>{formatAsset(value)}</>;
}
