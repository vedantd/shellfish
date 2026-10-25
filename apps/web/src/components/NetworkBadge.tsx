import { useEffect, useState } from "react";
import { api, type NetworkInfo } from "../lib/api";

export function NetworkBadge() {
  const [network, setNetwork] = useState<NetworkInfo | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api<NetworkInfo>("/v1/network")
      .then((info) => {
        if (!cancelled) setNetwork(info);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const mode = network?.mode ?? (error ? "API_OFFLINE" : "…");
  const live = mode === "LIVE_DEVNET";
  const sim = mode === "SIMULATED_LOAN";

  return (
    <div
      className={`badge ${live ? "badge-live" : "badge-sim"}`}
      title={
        live
          ? "LIVE_DEVNET — explorer links only for real validated hashes. live_ready is configuration, not ledger proof."
          : sim
            ? "SIMULATED_LOAN — labeled simulation; tx_hash stays null"
            : "Waiting for GET /v1/network"
      }
    >
      {live ? "XRPL Devnet" : sim ? "Demo mode" : error ? "API offline" : "Connecting…"}
      {live && network?.live_ready === false ? " · connecting" : ""}
    </div>
  );
}
