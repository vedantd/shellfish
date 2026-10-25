import type Database from "better-sqlite3";
import { createPrivateKey, sign } from "node:crypto";
import { Wallet } from "@shellfish/xrpl";
import { createEvidenceService, completedHistoryMonths } from "@shellfish/evidence";
import { createCompatibilityService } from "@shellfish/compatibility";
import { contentHash, type CreditRegistry } from "@shellfish/registry";
import { EvidencePassport, canonicalJson, type BorrowingMandate, type LenderFacilityOffer } from "@shellfish/schemas";
import { buildLiveAuthMaterials } from "./live-materials.js";
import { signMandate, createNativeMandateVerifier } from "./mandate-signature.js";
import type { LiveRuntimeConfig } from "./live-config.js";
import type { UiStateStore } from "./db/ui-state.js";

/** Operator-seeded native demo approval. Ledger event history supplies observed performance, not a universal score. */
export function createNativeCreditSources(db: Database.Database, registry: CreditRegistry, state: UiStateStore, config: LiveRuntimeConfig, now: () => Date) {
  db.exec("CREATE TABLE IF NOT EXISTS native_credit_intents(intent_key TEXT PRIMARY KEY,config_hash TEXT NOT NULL,payload_json TEXT NOT NULL,created_at TEXT NOT NULL)");
  const borrower = Wallet.fromSeed(config.borrowerSeed), broker = Wallet.fromSeed(config.brokerSeed);
  const verifyNativeMandate = createNativeMandateVerifier({ expectedPublicKey: borrower.publicKey, expectedBorrower: borrower.classicAddress, now });
  const configuration = contentHash({ borrower: config.borrowerAddress, broker: config.loanBrokerId,
    asset: config.loanMptIssuanceId, rep: config.repIssuanceId, principal: config.principalMinor,
    loan_asset_scale: config.loanAssetScale ?? 6,
    interval: config.paymentIntervalSec ?? 7776000, fees: [config.loanOriginationFee ?? "0", config.loanServiceFee ?? "0"] });
  function attest(domain: string, value: unknown): string {
    if (!broker.privateKey.startsWith("ED")) throw new Error("DEMO_ATTESTOR_ED25519_REQUIRED");
    const key = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(broker.privateKey.slice(2), "hex")]), format: "der", type: "pkcs8" });
    const signature = sign(null, Buffer.from(canonicalJson({ domain, value })), key).toString("hex");
    return "SFATTEST1." + Buffer.from(canonicalJson({ domain, public_key: broker.publicKey, signature })).toString("base64url");
  }
  function createIntent(intentKey = "default") {
    if (!/^[A-Za-z0-9:_-]{1,160}$/.test(intentKey)) throw new Error("INVALID_INTENT_KEY");
    const previous = db.prepare("SELECT config_hash,payload_json FROM native_credit_intents WHERE intent_key=?").get(intentKey) as { config_hash: string; payload_json: string } | undefined;
    if (previous) {
      if (previous.config_hash !== configuration) throw new Error("INTENT_CONFIGURATION_CONFLICT");
      return JSON.parse(previous.payload_json) as NativeIntent;
    }
    const at = now(), materials = buildLiveAuthMaterials(config, at);
    const identity = contentHash({ configuration, intentKey }).slice("sha256:".length);
    materials.mandate.mandate_id = `m-live-${identity}`;
    materials.mandate.nonce = `nonce-live-${identity}`;
    const status = registry.getCreditStatus(config.facilityId);
    const rows = db.prepare("SELECT l.state,l.clean,l.origin_time FROM credit_loans l JOIN credit_portfolios p USING(portfolio_key) WHERE p.principal_id=? AND p.network='devnet'").all(config.principalId) as Array<{ state: string; clean: number; origin_time: number }>;
    const observed = rows.length ? new Date(Math.min(...rows.map(r => r.origin_time * 1000), at.getTime())).toISOString() : at.toISOString();
    const passport = {
      contract_version: "C0-REP-1" as const, model_version: "REP-CURVE-v0.2" as const,
      network: "devnet", mode: "LIVE_DEVNET" as const, subject_id: config.principalId,
      issuer_id: "shellfish:devnet-registry-attestor:" + config.brokerAddress,
      issued_at: at.toISOString(), expires_at: materials.mandate.expires_at,
      evidence_version: "registry:" + materials.reservationRequest.request_id,
      history: { observation_start: observed, observation_end: at.toISOString(),
        accepted_history_months: completedHistoryMonths(observed, at.toISOString()),
        on_time: rows.filter(r => r.state === "REPAID" && r.clean === 1).length,
        late: rows.filter(r => r.state === "REPAID" && r.clean !== 1).length,
        default: rows.filter(r => r.state === "DEFAULTED").length },
      known_exposure: { asset: status.asset, amount: `${BigInt(status.exposure_for_curve_minor) / 100n}.${(BigInt(status.exposure_for_curve_minor) % 100n).toString().padStart(2, "0")}`,
        coverage: "participating_sources_only" as const, as_of: at.toISOString() },
      evidence_hash: "", signature: "",
    };
    passport.evidence_hash = contentHash(Object.fromEntries(Object.entries(passport).filter(([k]) => !["signature", "evidence_hash"].includes(k))));
    passport.signature = attest("XRPL_SHELLFISH_EVIDENCE_V1", passport.evidence_hash);
    const evidence = EvidencePassport.parse(passport);
    const mandate = signMandate(materials.mandate as BorrowingMandate, borrower);
    const offer = { ...materials.offer, lender_signature: attest("XRPL_SHELLFISH_OFFER_V1", materials.offer.offer_hash) } as LenderFacilityOffer;
    const reservationRequest = { ...materials.reservationRequest, request_id: `req-live-${identity}`,
      idempotency_key: `idem-live-${identity}`, mandate_id: mandate.mandate_id, nonce: mandate.nonce,
      mandate_hash: mandate.mandate_hash, evidence_hash: evidence.evidence_hash };
    const value = { mandate, offer, reservationRequest, evidence };
    db.transaction(() => {
      state.storeApprovedOffer(offer);
      db.prepare("INSERT INTO native_credit_intents(intent_key,config_hash,payload_json,created_at) VALUES(?,?,?,?)")
        .run(intentKey, configuration, canonicalJson(value), at.toISOString());
    }).immediate();
    return value;
  }
  type NativeIntent = { mandate: BorrowingMandate; offer: LenderFacilityOffer; reservationRequest: ReturnType<typeof buildLiveAuthMaterials>["reservationRequest"]; evidence: ReturnType<typeof EvidencePassport.parse> };
  let current = createIntent();
  function service() {
    return createCompatibilityService({ hash: contentHash, now, approvedOffers: [{ offer: current.offer, evidenceHash: current.evidence.evidence_hash, evidenceVersion: current.evidence.evidence_version }] });
  }
  return {
    verifyNativeMandate,
    intent(key?: string) { current = createIntent(key); return structuredClone(current); },
    services: {
      evidence: {
        getEvidencePassport: (id: string) => createEvidenceService({ passports: [current.evidence], hash: contentHash, now }).getEvidencePassport(id),
        recordPerformanceEvent: async () => { throw new Error("PERFORMANCE_DERIVED_FROM_VERIFIED_REGISTRY_ONLY"); },
      },
      credit: {
        evaluateLender: (id: string, evidence: Parameters<ReturnType<typeof createCompatibilityService>["evaluateLender"]>[1]) => service().evaluateLender(id === "lender-A" ? config.brokerAddress : id, evidence),
        matchOffers: (input: Parameters<ReturnType<typeof createCompatibilityService>["matchOffers"]>[0]) => service().matchOffers(input),
      }, registry,
    },
  };
}
