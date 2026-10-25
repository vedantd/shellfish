import { connectClient, resolveWsUrl } from "./client.js";
import { checkRequiredFeatures, printFeatureReport } from "./features.js";

async function main(): Promise<void> {
  // Resolve early so Testnet URLs fail before connect.
  const url = resolveWsUrl();
  console.log(`\n=== XRPL feature-check (${url}) ===\n`);

  const client = await connectClient();
  try {
    const report = await checkRequiredFeatures(client);
    printFeatureReport(report);

    if (!report.allEnabled) {
      console.error(
        "\nNO-GO: one or more required amendments are disabled on this network.",
      );
      console.error(
        "Use Devnet (wss://s.devnet.rippletest.net:51233). Testnet lacks lending/vaults.",
      );
      process.exitCode = 1;
      return;
    }

    console.log("\nPASS: Devnet lending path amendments are enabled.");
  } finally {
    await client.disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
