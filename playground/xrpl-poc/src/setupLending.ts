/**
 * Adaption of XRPLF portal lendingSetup.js — stops after Investment phase opens.
 * Sample loans are left to execute-loan (this POC's core deliverable).
 */
import {
  convertStringToHex,
  encodeMPTokenMetadata,
  MPTokenIssuanceCreateFlags,
  VaultCreateFlags,
  type Client,
  type Wallet,
} from "xrpl";
import { connectClient, DEVNET_WS } from "./client.js";
import { checkRequiredFeatures, printFeatureReport } from "./features.js";
import { saveSetup, setupExists, type LendingSetup } from "./wallets.js";

type TxResponse = Awaited<ReturnType<Client["submitAndWait"]>>;

function extractTickets(response: TxResponse): number[] {
  const meta = response.result.meta;
  if (!meta || typeof meta === "string") return [];
  return (meta.AffectedNodes ?? [])
    .filter(
      (node) =>
        "CreatedNode" in node &&
        node.CreatedNode?.LedgerEntryType === "Ticket",
    )
    .map((node) => {
      const created = "CreatedNode" in node ? node.CreatedNode : undefined;
      return created?.NewFields?.TicketSequence as number;
    })
    .filter((n): n is number => typeof n === "number");
}

function findCreatedLedgerIndex(
  response: TxResponse,
  entryType: string,
): string {
  const meta = response.result.meta;
  if (!meta || typeof meta === "string") {
    throw new Error(`No meta for ${entryType}`);
  }
  const node = meta.AffectedNodes?.find(
    (n) =>
      "CreatedNode" in n && n.CreatedNode?.LedgerEntryType === entryType,
  );
  const index =
    node && "CreatedNode" in node
      ? node.CreatedNode?.LedgerIndex
      : undefined;
  if (!index) throw new Error(`Could not find created ${entryType}`);
  return index;
}

async function waitForInvestmentPhase(
  client: Client,
  subscriptionDate: number,
): Promise<void> {
  let latest = await client.request({
    command: "ledger",
    ledger_index: "validated",
  });
  for (
    let secondsLeft =
      subscriptionDate - latest.result.ledger.close_time;
    secondsLeft > 0;
    secondsLeft--
  ) {
    process.stdout.write(
      `\x1b[KInvestment phase opens in ${secondsLeft}s\r`,
    );
    await new Promise((r) => setTimeout(r, 1000));
  }

  process.stdout.write("\x1b[KWaiting for ledger past SubscriptionDate...\r");
  while (true) {
    latest = await client.request({
      command: "ledger",
      ledger_index: "validated",
    });
    if (latest.result.ledger.close_time > subscriptionDate) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  process.stdout.write("\x1b[KInvestment phase open.\n");
}

async function runSetup(client: Client): Promise<LendingSetup> {
  process.stdout.write("Setting up: 0/6\r");

  const [
    { wallet: loanBroker },
    { wallet: borrower },
    { wallet: depositor },
    { wallet: credentialIssuer },
  ] = await Promise.all([
    client.fundWallet(),
    client.fundWallet(),
    client.fundWallet(),
    client.fundWallet(),
  ]);

  process.stdout.write("Setting up: 1/6 wallets funded\r");

  const [ciTicketResponse, lbTicketResponse, brTicketResponse, dpTicketResponse] =
    await Promise.all([
      client.submitAndWait(
        {
          TransactionType: "TicketCreate",
          Account: credentialIssuer.address,
          TicketCount: 4,
        },
        { wallet: credentialIssuer, autofill: true },
      ),
      client.submitAndWait(
        {
          TransactionType: "TicketCreate",
          Account: loanBroker.address,
          TicketCount: 2,
        },
        { wallet: loanBroker, autofill: true },
      ),
      client.submitAndWait(
        {
          TransactionType: "TicketCreate",
          Account: borrower.address,
          TicketCount: 2,
        },
        { wallet: borrower, autofill: true },
      ),
      client.submitAndWait(
        {
          TransactionType: "TicketCreate",
          Account: depositor.address,
          TicketCount: 2,
        },
        { wallet: depositor, autofill: true },
      ),
    ]);

  const ciTickets = extractTickets(ciTicketResponse);
  const lbTickets = extractTickets(lbTicketResponse);
  const brTickets = extractTickets(brTicketResponse);
  const dpTickets = extractTickets(dpTicketResponse);

  process.stdout.write("Setting up: 2/6 tickets\r");

  const credentialType = convertStringToHex("KYC-Verified");
  const mptData = {
    ticker: "TSTUSD",
    name: "Test USD MPT",
    desc: "Shellfish playground non-yield MPT for Devnet loan POC.",
    icon: "https://example.org/tstusd-icon.png",
    asset_class: "rwa",
    asset_subclass: "stablecoin",
    issuer_name: "Shellfish Playground",
    uris: [
      {
        uri: "https://exampletreasury.com/tstusd",
        category: "website",
        title: "Product Page",
      },
    ],
    additional_info: {
      pegged_currency: "USD",
      purpose: "local-playground-only",
    },
  };

  const [mptIssuanceResponse, domainSetResponse] = await Promise.all([
    client.submitAndWait(
      {
        TransactionType: "MPTokenIssuanceCreate",
        Account: depositor.address,
        MaximumAmount: "100000000",
        TransferFee: 0,
        Flags:
          MPTokenIssuanceCreateFlags.tfMPTCanTransfer |
          MPTokenIssuanceCreateFlags.tfMPTCanClawback |
          MPTokenIssuanceCreateFlags.tfMPTCanTrade,
        MPTokenMetadata: encodeMPTokenMetadata(mptData),
      },
      { wallet: depositor, autofill: true },
    ),
    client.submitAndWait(
      {
        TransactionType: "PermissionedDomainSet",
        Account: credentialIssuer.address,
        AcceptedCredentials: [
          {
            Credential: {
              Issuer: credentialIssuer.address,
              CredentialType: credentialType,
            },
          },
        ],
        Sequence: 0,
        TicketSequence: ciTickets[0],
      },
      { wallet: credentialIssuer, autofill: true },
    ),
    client.submitAndWait(
      {
        TransactionType: "CredentialCreate",
        Account: credentialIssuer.address,
        Subject: loanBroker.address,
        CredentialType: credentialType,
        Sequence: 0,
        TicketSequence: ciTickets[1],
      },
      { wallet: credentialIssuer, autofill: true },
    ),
    client.submitAndWait(
      {
        TransactionType: "CredentialCreate",
        Account: credentialIssuer.address,
        Subject: borrower.address,
        CredentialType: credentialType,
        Sequence: 0,
        TicketSequence: ciTickets[2],
      },
      { wallet: credentialIssuer, autofill: true },
    ),
    client.submitAndWait(
      {
        TransactionType: "CredentialCreate",
        Account: credentialIssuer.address,
        Subject: depositor.address,
        CredentialType: credentialType,
        Sequence: 0,
        TicketSequence: ciTickets[3],
      },
      { wallet: credentialIssuer, autofill: true },
    ),
  ]);

  const mptID = (
    mptIssuanceResponse.result.meta as { mpt_issuance_id?: string }
  ).mpt_issuance_id;
  if (!mptID) throw new Error("Missing mpt_issuance_id");
  const domainID = findCreatedLedgerIndex(domainSetResponse, "PermissionedDomain");

  process.stdout.write("Setting up: 3/6 MPT + domain\r");

  await Promise.all([
    client.submitAndWait(
      {
        TransactionType: "CredentialAccept",
        Account: loanBroker.address,
        Issuer: credentialIssuer.address,
        CredentialType: credentialType,
        Sequence: 0,
        TicketSequence: lbTickets[0],
      },
      { wallet: loanBroker, autofill: true },
    ),
    client.submitAndWait(
      {
        TransactionType: "MPTokenAuthorize",
        Account: loanBroker.address,
        MPTokenIssuanceID: mptID,
        Sequence: 0,
        TicketSequence: lbTickets[1],
      },
      { wallet: loanBroker, autofill: true },
    ),
    client.submitAndWait(
      {
        TransactionType: "CredentialAccept",
        Account: borrower.address,
        Issuer: credentialIssuer.address,
        CredentialType: credentialType,
        Sequence: 0,
        TicketSequence: brTickets[0],
      },
      { wallet: borrower, autofill: true },
    ),
    client.submitAndWait(
      {
        TransactionType: "MPTokenAuthorize",
        Account: borrower.address,
        MPTokenIssuanceID: mptID,
        Sequence: 0,
        TicketSequence: brTickets[1],
      },
      { wallet: borrower, autofill: true },
    ),
    client.submitAndWait(
      {
        TransactionType: "CredentialAccept",
        Account: depositor.address,
        Issuer: credentialIssuer.address,
        CredentialType: credentialType,
      },
      { wallet: depositor, autofill: true },
    ),
  ]);

  process.stdout.write("Setting up: 4/6 auth\r");

  let latestLedger = await client.request({
    command: "ledger",
    ledger_index: "validated",
  });
  const subscriptionDate = latestLedger.result.ledger.close_time + 30;
  const redemptionDate = subscriptionDate + 3650 * 24 * 60 * 60;

  const [vaultCreateResponse] = await Promise.all([
    client.submitAndWait(
      {
        TransactionType: "VaultCreate",
        Account: loanBroker.address,
        Asset: { mpt_issuance_id: mptID },
        Flags: VaultCreateFlags.tfVaultPrivate,
        DomainID: domainID,
        VaultKind: 1,
        SubscriptionDate: subscriptionDate,
        RedemptionDate: redemptionDate,
      },
      { wallet: loanBroker, autofill: true },
    ),
    client.submitAndWait(
      {
        TransactionType: "Payment",
        Account: depositor.address,
        Destination: loanBroker.address,
        Amount: { mpt_issuance_id: mptID, value: "5000" },
        Sequence: 0,
        TicketSequence: dpTickets[0],
      },
      { wallet: depositor, autofill: true },
    ),
    client.submitAndWait(
      {
        TransactionType: "Payment",
        Account: depositor.address,
        Destination: borrower.address,
        Amount: { mpt_issuance_id: mptID, value: "2500" },
        Sequence: 0,
        TicketSequence: dpTickets[1],
      },
      { wallet: depositor, autofill: true },
    ),
  ]);

  const vaultID = findCreatedLedgerIndex(vaultCreateResponse, "Vault");

  process.stdout.write("Setting up: 5/6 vault\r");

  const [loanBrokerSetResponse] = await Promise.all([
    client.submitAndWait(
      {
        TransactionType: "LoanBrokerSet",
        Account: loanBroker.address,
        VaultID: vaultID,
      },
      { wallet: loanBroker, autofill: true },
    ),
    client.submitAndWait(
      {
        TransactionType: "VaultDeposit",
        Account: depositor.address,
        VaultID: vaultID,
        Amount: { mpt_issuance_id: mptID, value: "50000000" },
      },
      { wallet: depositor, autofill: true },
    ),
  ]);

  const loanBrokerID = findCreatedLedgerIndex(
    loanBrokerSetResponse,
    "LoanBroker",
  );

  process.stdout.write("\x1b[KSetting up: 6/6 waiting for Investment...\n");
  await waitForInvestmentPhase(client, subscriptionDate);

  const seedOrThrow = (w: Wallet): string => {
    if (!w.seed) throw new Error(`Wallet ${w.address} missing seed`);
    return w.seed;
  };

  return {
    description:
      "Auto-generated by playground setup-lending. Local-only; never commit.",
    network: DEVNET_WS,
    createdAt: new Date().toISOString(),
    loanBroker: {
      address: loanBroker.address,
      seed: seedOrThrow(loanBroker),
    },
    borrower: {
      address: borrower.address,
      seed: seedOrThrow(borrower),
    },
    depositor: {
      address: depositor.address,
      seed: seedOrThrow(depositor),
    },
    credentialIssuer: {
      address: credentialIssuer.address,
      seed: seedOrThrow(credentialIssuer),
    },
    domainID,
    mptID,
    vaultID,
    loanBrokerID,
    subscriptionDate,
    redemptionDate,
  };
}

async function main(): Promise<void> {
  if (setupExists() && !process.argv.includes("--force")) {
    console.log(
      "Setup already exists at .wallets/lendingSetup.json (pass --force to recreate).",
    );
    return;
  }

  const client = await connectClient();
  try {
    const report = await checkRequiredFeatures(client);
    printFeatureReport(report);
    if (!report.allEnabled) {
      console.error("NO-GO: required amendments missing. Aborting setup.");
      process.exitCode = 1;
      return;
    }

    console.log("\n=== setup-lending (Devnet vault + LoanBroker) ===\n");
    const setup = await runSetup(client);
    saveSetup(setup);
    console.log("VaultID:", setup.vaultID);
    console.log("LoanBrokerID:", setup.loanBrokerID);
    console.log("Addresses only — seeds stay in .wallets/");
    console.log(`  broker: ${setup.loanBroker.address}`);
    console.log(`  borrower: ${setup.borrower.address}`);
    console.log("\nNext: pnpm execute-loan");
  } finally {
    await client.disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
