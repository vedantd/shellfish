import { Client } from "xrpl";

/** Locked Devnet WS — Testnet lacks LendingProtocol / SingleAssetVault. */
export const DEVNET_WS = "wss://s.devnet.rippletest.net:51233";

const TESTNET_MARKERS = ["altnet", "s.altnet", "testnet"];

export function resolveWsUrl(): string {
  const fromEnv = process.env.XRPL_WS?.trim();
  if (!fromEnv) return DEVNET_WS;

  const lower = fromEnv.toLowerCase();
  if (TESTNET_MARKERS.some((m) => lower.includes(m))) {
    throw new Error(
      `Refusing Testnet URL (${fromEnv}). This POC requires Devnet lending+vaults. Use ${DEVNET_WS}`,
    );
  }
  if (!lower.includes("devnet") && fromEnv !== DEVNET_WS) {
    console.warn(
      `[warn] XRPL_WS=${fromEnv} does not look like Devnet; feature-check will still verify amendments.`,
    );
  }
  return fromEnv;
}

export async function connectClient(): Promise<Client> {
  const url = resolveWsUrl();
  const client = new Client(url);
  await client.connect();
  return client;
}
