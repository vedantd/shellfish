import { createLedgerNativeVerifiers, createXrplLiveLedger, createLifecycleWorker, createRepReturnWorker, type LiveLedger, type NativeQueryClient } from "@shellfish/xrpl";
import { openCreditRegistry } from "./db/registry.js";
import { livePortfolioSeed, loadLiveRuntimeConfig } from "./live-config.js";
import { createNativeCreditSources } from "./native-credit.js";

export async function openLiveCreditBackend(databasePath: string, options: {
  env?: NodeJS.ProcessEnv; connectLedger?: boolean; live?: LiveLedger; queryClient?: NativeQueryClient; now?: () => Date;
} = {}) {
  const liveConfig = loadLiveRuntimeConfig(options.env ?? process.env);
  if (!liveConfig) throw new Error("LIVE_CONFIG_REQUIRED");
  // Devnet ledger close_time often lags wall clock. Reservation created_at uses
  // registry.now(); stake occurredAt uses ledger unix. Keep reserve clock behind
  // wall, then pin applyEvent clock to the ledger instant so both bounds pass.
  let applyUnix: number | null = null;
  const now =
    options.now ??
    (() =>
      applyUnix !== null
        ? new Date(applyUnix * 1000)
        : new Date(Date.now() - 120_000));
  const handle = !options.live && options.connectLedger !== false ? await createXrplLiveLedger(liveConfig) : null;
  const live = options.live ?? handle?.ledger;
  if (!live?.transport) { await handle?.close(); throw new Error("DURABLE_NATIVE_TRANSPORT_REQUIRED"); }
  const transport = live.transport;
  const client = options.queryClient ?? { request: (input: Record<string, unknown>) => transport.request(input) };
  let backend: ReturnType<typeof openCreditRegistry> | undefined;
  const verifiers = createLedgerNativeVerifiers({ client, expectedNetworkId: 2,
    borrowerAccount: liveConfig.borrowerAddress, brokerAccount: liveConfig.brokerAddress,
    brokerId: liveConfig.loanBrokerId, loanAsset: { mpt_issuance_id: liveConfig.loanMptIssuanceId },
    repAsset: liveConfig.publicSigning.native_rep_asset, moneyScale: 100n, loanAssetScale: liveConfig.loanAssetScale ?? 6,
    originationFee: liveConfig.loanOriginationFee ?? "0", serviceFee: liveConfig.loanServiceFee ?? "0",
    getApprovedOffer: hash => backend?.uiState.getApprovedOffer(hash),
    getPreparedFields: id => backend?.execution.getPreparedAction(id)?.preparedFields,
    getAttemptHash: (id, phase) => backend?.execution.getAttempt(id, phase)?.attemptHash,
    getLoanContext: id => {
      if (!backend) return undefined;
      const loan = backend.registry.getLoan(id);
      const prior = backend.db.prepare("SELECT tx_hash FROM credit_events WHERE event_id=?").get(loan.event_cursor) as { tx_hash: string } | undefined;
      if (!prior?.tx_hash) return undefined;
      return { originHash: String(loan.origin_hash), eventCursor: String(loan.event_cursor), previousEventHash: prior.tx_hash,
        maturityAt: Number(loan.maturity_time), nextDueAt: Number(loan.next_due_time), graceSeconds: Number(loan.grace_seconds) };
    },
  });
  try {
    backend = openCreditRegistry(databasePath, { now, uiMode: "LIVE_DEVNET", uiNetwork: "devnet",
      verifyNativeEvent: verifiers.verifyNativeEvent, verifyNativePortfolio: verifiers.verifyNativePortfolio, verifyReturnFailure: verifiers.verifyReturnFailure });
    const binding = { principalId: liveConfig.principalId, network: "devnet", asset: { mpt_issuance_id: liveConfig.loanMptIssuanceId } };
    let enrolled = false;
    try { backend.registry.getPortfolio(binding); enrolled = true; } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "NOT_FOUND")) throw error;
    }
    if (!enrolled) {
      // Opening REP must match the live holder balance (post-growth micro-units included).
      const configuration = await verifiers.verifyAssetConfiguration({
        lenderId: liveConfig.brokerAddress,
      });
      const seed = livePortfolioSeed(liveConfig, now().toISOString());
      seed.opening.reputation.seed_u = configuration.borrowerRepBalanceU;
      seed.opening.reputation.available_u = configuration.borrowerRepBalanceU;
      await backend.registry.initializeNativePortfolio(
        seed,
        liveConfig.borrowerAddress,
        { source: "queried-devnet" },
      );
    } else await verifiers.verifyAssetConfiguration({ lenderId: liveConfig.brokerAddress });
    const sources = createNativeCreditSources(backend.db, backend.registry, backend.uiState, liveConfig, now);
    const registry = backend.registry;
    const applyEvent = registry.applyEvent.bind(registry);
    registry.applyEvent = (async (event: Parameters<typeof applyEvent>[0]) => {
      const occurred =
        event && typeof event === "object" && "occurredAt" in event
          ? Number((event as { occurredAt: number }).occurredAt)
          : NaN;
      if (Number.isSafeInteger(occurred) && occurred >= 0) applyUnix = occurred;
      try {
        return await applyEvent(event);
      } finally {
        applyUnix = null;
      }
    }) as typeof registry.applyEvent;
    const lifecycle = createLifecycleWorker({ registry, store: backend.lifecycleStore,
      transport, signerLanes: backend.signerLanes, moneyScale: 100n, nativeAssetScale: liveConfig.loanAssetScale ?? 6,
      loanAsset: { mpt_issuance_id: liveConfig.loanMptIssuanceId } });
    const repReturns = createRepReturnWorker({ registry, returns: backend.returns, transport, signerLanes: backend.signerLanes });
    return { ...backend, registry, services: sources.services, verifyNativeMandate: sources.verifyNativeMandate,
      nativeIntent: sources.intent, lifecycle, repReturns, live, liveConfig, mode: "LIVE_DEVNET" as const,
      transaction: <T>(work: () => T): T => backend!.db.transaction(work).immediate(),
      close: () => { void handle?.close().catch(() => {}); backend?.close(); } };
  } catch (error) { backend?.close(); await handle?.close(); throw error; }
}
export type LiveCreditBackend = Awaited<ReturnType<typeof openLiveCreditBackend>>;
