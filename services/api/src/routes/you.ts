import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import {
  attachLiveStakeProof,
  authorizeExactAction,
  verifyMandate,
} from "@shellfish/authorization";
import { contentHash, RegistryError } from "@shellfish/registry";
import {
  AuthorizationReceipt,
  BorrowingMandate,
  LenderFacilityOffer,
  ReservationFixture,
  ScenarioFixture,
} from "@shellfish/schemas";
import { originateLoan } from "@shellfish/xrpl";
import { config } from "../config.js";
import {
  getReceipt,
  getApprovedOffer,
  storeApprovedOffer,
  requireCreditBackend,
  storeReceipt,
} from "../credit-context.js";
import { buildLiveAuthMaterials } from "../live-materials.js";

const fixturesDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../fixtures",
);

function loadFixture<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(fixturesDir, name), "utf8")) as T;
}

function fixtureClock(): Date {
  const scenario = ScenarioFixture.parse(loadFixture("scenario.json"));
  return new Date(scenario.clock);
}

function uniqueReservationRequest(
  base: ReturnType<typeof ReservationFixture.parse>["request"],
): typeof base {
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    ...base,
    request_id: `req-${suffix}`,
    idempotency_key: `idem-${suffix}`,
  };
}

function explorerUrl(txHash: string | null | undefined): string | null {
  if (!txHash) return null;
  return `https://devnet.xrpl.org/transactions/${txHash}`;
}

/**
 * Routes owned by You (Shellfish + XRPL + receipts).
 */
export async function youRoutes(app: FastifyInstance) {
  app.get("/v1/network", async () => {
    const backend = requireCreditBackend();
    return {
      mode: config.networkMode,
      live_ready: Boolean(backend.live && backend.liveConfig),
      public_signing: backend.liveConfig?.publicSigning ?? null,
      explorer_base: "https://devnet.xrpl.org/transactions/",
    };
  });

  app.post<{
    Body: { mandate?: unknown };
  }>("/v1/mandates", async (req, reply) => {
    try {
      const backend = requireCreditBackend();
      let mandateRaw = req.body?.mandate;
      if (!mandateRaw && config.networkMode === "LIVE_DEVNET") {
        if (!backend.liveConfig) {
          reply.code(503);
          return { ok: false, code: "LIVE_NOT_CONFIGURED", mode: config.networkMode };
        }
        mandateRaw = buildLiveAuthMaterials(backend.liveConfig, new Date()).mandate;
      }
      const mandate = BorrowingMandate.parse(
        mandateRaw ?? loadFixture("mandate.json"),
      );
      const ok = verifyMandate(mandate);
      if (!ok) {
        reply.code(400);
        return { ok: false, code: "DENY_SIGNATURE", mode: config.networkMode };
      }
      return { ok: true, mandate_id: mandate.mandate_id, mode: config.networkMode };
    } catch (err) {
      reply.code(400);
      return {
        ok: false,
        code: "DENY_TRANSACTION_MISMATCH",
        message: err instanceof Error ? err.message : "invalid mandate",
        mode: config.networkMode,
      };
    }
  });

  app.post<{
    Body: {
      mandate?: unknown;
      offer?: unknown;
      proposal_hash?: string;
      envelope_hash?: string;
      evidence_fresh?: boolean;
      reservation_request?: unknown;
      unique?: boolean;
    };
  }>("/v1/authorizations", async (req, reply) => {
    try {
      const backend = requireCreditBackend();
      let mandate;
      let offer;
      let reservationRequest;
      let now: Date;

      if (config.networkMode === "LIVE_DEVNET") {
        if (!backend.liveConfig) {
          reply.code(503);
          return { code: "LIVE_NOT_CONFIGURED", mode: config.networkMode };
        }
        now = new Date();
        const materials = buildLiveAuthMaterials(backend.liveConfig, now);
        mandate = BorrowingMandate.parse(req.body?.mandate ?? materials.mandate);
        offer = LenderFacilityOffer.parse(req.body?.offer ?? materials.offer);
        reservationRequest =
          req.body?.reservation_request ?? materials.reservationRequest;
      } else {
        now = fixtureClock();
        mandate = BorrowingMandate.parse(
          req.body?.mandate ?? loadFixture("mandate.json"),
        );
        offer = LenderFacilityOffer.parse(
          req.body?.offer ?? loadFixture("offer-lender-a.json"),
        );
        const reservationFixture = ReservationFixture.parse(
          loadFixture("reservation.json"),
        );
        const useUnique = req.body?.unique !== false;
        reservationRequest =
          req.body?.reservation_request ??
          (useUnique
            ? uniqueReservationRequest(reservationFixture.request)
            : reservationFixture.request);
      }

      const match =
        config.networkMode === "SIMULATED_LOAN"
          ? loadFixture<{ envelope_hash?: string }>("offer-match.json")
          : { envelope_hash: null };
      const proposalHash =
        req.body?.proposal_hash ?? contentHash(reservationRequest);

      const receipt = authorizeExactAction({
        mandate,
        offer,
        proposalHash,
        evidenceFresh: req.body?.evidence_fresh ?? true,
        hashContent: contentHash,
        reservationRequest,
        envelopeHash: req.body?.envelope_hash ?? match.envelope_hash ?? null,
        reserveRequest: (raw) => backend.registry.reserveRequest(raw),
        now,
      });

      const parsed = AuthorizationReceipt.parse(receipt);
      if (parsed.decision === "ALLOW") storeApprovedOffer(offer);
      storeReceipt(parsed);
      if (parsed.decision === "DENY") {
        reply.code(403);
      }
      return parsed;
    } catch (err) {
      if (err instanceof RegistryError) {
        reply.code(400);
        return { code: err.code, message: err.message, mode: config.networkMode };
      }
      reply.code(400);
      return {
        code: "DENY_TRANSACTION_MISMATCH",
        message: err instanceof Error ? err.message : "authorization failed",
        mode: config.networkMode,
      };
    }
  });

  app.post<{
    Body: {
      request_id?: string;
      reservation_id?: string;
      proposal_hash?: string;
      principal?: string;
      apr_bps?: number;
      term_days?: number;
    };
  }>("/v1/loans/originate", async (req, reply) => {
    try {
      const backend = requireCreditBackend();
      const requestId = req.body?.request_id;
      const reservationId = req.body?.reservation_id;
      if (!requestId || !reservationId) {
        reply.code(400);
        return {
          code: "DENY_TRANSACTION_MISMATCH",
          message: "request_id and reservation_id required from ALLOW receipt",
          mode: config.networkMode,
        };
      }

      const prior = getReceipt(requestId);
      if (!prior || prior.decision !== "ALLOW") {
        reply.code(403);
        return {
          code: "DENY_SCOPE",
          message: "Origination requires a prior ALLOW receipt for this request",
          mode: config.networkMode,
        };
      }
      if (prior.reservation_id !== reservationId) {
        reply.code(400);
        return {
          code: "DENY_TRANSACTION_MISMATCH",
          message: "reservation_id does not match ALLOW receipt",
          mode: config.networkMode,
        };
      }

      const isLive = config.networkMode === "LIVE_DEVNET";
      if (isLive && !backend.live) {
        reply.code(503);
        return {
          code: "LIVE_LEDGER_UNAVAILABLE",
          message: "LIVE ledger not connected",
          mode: config.networkMode,
        };
      }

      const record = backend.registry.getRequest(requestId);
      const approvedOffer = getApprovedOffer(record.request.commercial_terms_hash);
      if (!approvedOffer) throw new Error("Approved offer snapshot unavailable; reauthorize the exact request");
      const principal = req.body?.principal ?? approvedOffer.principal;
      const aprBps = req.body?.apr_bps ?? approvedOffer.apr_bps;
      const termDays = req.body?.term_days ?? approvedOffer.term_days;
      let borrowerAccount: string;
      let repAsset;
      let clockSeconds: () => number;
      if (isLive && backend.liveConfig) {
        borrowerAccount = backend.liveConfig.borrowerAddress;
        repAsset = backend.liveConfig.publicSigning.native_rep_asset;
        clockSeconds = () => Math.floor(Date.now() / 1000);
      } else {
        const scenario = ScenarioFixture.parse(loadFixture("scenario.json"));
        borrowerAccount = "sim:borrower-harbor-supply";
        repAsset = scenario.rep_asset;
        const clock = fixtureClock();
        clockSeconds = () => Math.floor(clock.getTime() / 1000);
      }

      const result = await originateLoan(
        {
          proposalHash: req.body?.proposal_hash ?? prior.proposal_hash ?? "",
          principal: principal!,
          aprBps: aprBps!,
          termDays: termDays!,
          asset: JSON.stringify(approvedOffer.asset),
          networkMode: config.networkMode,
          requestId,
          reservationId,
        },
        {
          getRequest: (id) => backend.registry.getRequest(id),
          applyEvent: (event) => backend.registry.applyEvent(event as never),
          hashRequest: contentHash,
          getApprovedOffer,
          clockSeconds,
          borrowerAccount,
          repAsset,
          live: backend.live,
        },
      );

      let updated;
      if (isLive) {
        if (!result.stakeProofId || !result.preparedTxCommitment || !result.txHash) {
          throw new Error("LIVE originate missing stake proof, commitment, or txHash");
        }
        const permitted = attachLiveStakeProof(prior, {
          stakeProofId: result.stakeProofId,
          preparedTxCommitment: result.preparedTxCommitment,
        });
        updated = {
          ...permitted,
          signature_state: "SIGNATURE_ISSUED" as const,
          xrpl_state: "VALIDATED_ACTIVE" as const,
          tx_hash: result.txHash,
        };
      } else {
        updated = {
          ...prior,
          signature_state: "SIGNATURE_ISSUED" as const,
          xrpl_state: "SIMULATED" as const,
          tx_hash: null,
          stake_proof_id: prior.stake_proof_id,
        };
      }
      storeReceipt(AuthorizationReceipt.parse(updated));

      return {
        ...result,
        explorer: explorerUrl(result.txHash),
        receipt: updated,
        loan: backend.registry.getLoan(result.loanId!),
      };
    } catch (err) {
      reply.code(400);
      return {
        code: "DENY_STAKE_PROOF",
        message: err instanceof Error ? err.message : "originate failed",
        mode: config.networkMode,
      };
    }
  });

  app.get<{ Params: { id: string } }>("/v1/loans/:id", async (req, reply) => {
    try {
      const backend = requireCreditBackend();
      const loan = backend.registry.getLoan(req.params.id);
      return {
        mode: config.networkMode,
        simulated: config.networkMode === "SIMULATED_LOAN",
        loan,
      };
    } catch (err) {
      reply.code(404);
      return {
        code: "NOT_FOUND",
        message: err instanceof Error ? err.message : "loan not found",
        mode: config.networkMode,
      };
    }
  });

  app.get<{ Params: { id: string } }>("/v1/receipts/:id", async (req, reply) => {
    const receipt = getReceipt(req.params.id);
    if (!receipt) {
      reply.code(404);
      return {
        code: "NOT_FOUND",
        message: "receipt not found",
        mode: config.networkMode,
      };
    }
    return {
      ...receipt,
      explorer: explorerUrl(receipt.tx_hash),
    };
  });
}
