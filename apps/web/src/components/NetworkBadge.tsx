const mode =
  (import.meta.env.VITE_NETWORK_MODE as string | undefined) ?? "SIMULATED_LOAN";

export function NetworkBadge() {
  const live = mode === "LIVE_DEVNET";
  return (
    <div
      className={`badge ${live ? "badge-live" : "badge-sim"}`}
      title={
        live
          ? "Showing real Devnet LoanSet results when available"
          : "Labeled simulation — never present as on-chain lending"
      }
    >
      {live ? "LIVE_DEVNET" : "SIMULATED_LOAN"}
    </div>
  );
}
