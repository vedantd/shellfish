import type { NetworkMode } from "@shellfish/schemas";

function networkMode(): NetworkMode {
  const raw = process.env.NETWORK_MODE ?? "SIMULATED_LOAN";
  if (raw === "LIVE_DEVNET" || raw === "SIMULATED_LOAN") return raw;
  throw new Error(`Invalid NETWORK_MODE: ${raw}`);
}

export const config = {
  host: process.env.API_HOST ?? "127.0.0.1",
  port: Number(process.env.API_PORT ?? 3001),
  networkMode: networkMode(),
  xrplNetwork:
    process.env.XRPL_NETWORK ?? "wss://s.devnet.rippletest.net:51233",
  databasePath: process.env.DATABASE_PATH ?? "./data/shellfish.db",
};
