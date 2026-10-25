import type { Client } from "xrpl";

/** Amendments required for the full Devnet loan demo (Gita check 2026-10-25). */
export const REQUIRED_AMENDMENTS = [
  "MPTokensV1",
  "SingleAssetVault",
  "LendingProtocol",
  "LendingProtocolV1_1",
  "DynamicMPT",
] as const;

export type AmendmentName = (typeof REQUIRED_AMENDMENTS)[number];

export type FeatureReport = {
  networkUrl: string;
  checkedAt: string;
  results: Record<AmendmentName, { enabled: boolean; raw?: unknown }>;
  allEnabled: boolean;
};

function isFeatureEnabled(entry: unknown): boolean {
  if (entry === true) return true;
  if (entry && typeof entry === "object") {
    const obj = entry as Record<string, unknown>;
    if (obj.enabled === true) return true;
    if (obj.Enabled === true) return true;
  }
  return false;
}

export async function checkRequiredFeatures(
  client: Client,
): Promise<FeatureReport> {
  const response = await client.request({ command: "feature" });
  const features = (response.result as { features?: Record<string, unknown> })
    .features;
  if (!features || typeof features !== "object") {
    throw new Error("feature response missing features map");
  }

  // rippled keys features by amendment hash; each value has { name, enabled, supported }.
  const byName = new Map<string, unknown>();
  for (const value of Object.values(features)) {
    if (value && typeof value === "object" && "name" in value) {
      byName.set(String((value as { name: string }).name), value);
    }
  }

  const results = {} as FeatureReport["results"];
  for (const name of REQUIRED_AMENDMENTS) {
    const raw = byName.get(name) ?? features[name];
    results[name] = { enabled: isFeatureEnabled(raw), raw };
  }

  return {
    networkUrl: client.url,
    checkedAt: new Date().toISOString(),
    results,
    allEnabled: REQUIRED_AMENDMENTS.every((n) => results[n].enabled),
  };
}

export function printFeatureReport(report: FeatureReport): void {
  console.log(`Network: ${report.networkUrl}`);
  console.log(`Checked: ${report.checkedAt}`);
  for (const name of REQUIRED_AMENDMENTS) {
    const row = report.results[name];
    console.log(`  ${name}: ${row.enabled ? "ENABLED" : "DISABLED"}`);
  }
}
