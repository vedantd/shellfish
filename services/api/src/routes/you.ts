import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import {
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
  requireCreditBackend,
  storeReceipt,
} from "../credit-context.js";

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
    mandate_id: `${base.mandate_id}-${suffix}`,
    nonce: `nonce-${suffix}`,
  };
}

/**
 * Routes owned by You (Shellfish + XRPL + receipts).
 */
export async function youRoutes(app: FastifyInstance) {
  app.post<{
    Body: { mandate?: unknown };
  }>("/v1/mandates", async (req, reply) => {
    try {
      const mandate = BorrowingMandate.parse(
        req.body?.mandate ?? loadFixture("mandate.json"),
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
      const mandate = BorrowingMandate.parse(
        req.body?.mandate ?? loadFixture("mandate.json"),
      );
      const offer = LenderFacilityOffer.parse(
        req.body?.offer ?? loadFixture("offer-lender-a.json"),
      );
      const reservationFixture = ReservationFixture.parse(
        loadFixture("reservation.json"),
      );
      const match = loadFixture<{ envelope_hash?: string }>("offer-match.json");
      const useUnique = req.body?.unique !== false;
      const reservationRequest =
        req.body?.reservation_request ??
        (useUnique
          ? uniqueReservationRequest(reservationFixture.request)
          : reservationFixture.request);
      const proposalHash =
        req.body?.proposal_hash ??
        contentHash(reservationRequest);

      const receipt = authorizeExactAction({
        mandate,
        offer,
        proposalHash,
        evidenceFresh: req.body?.evidence_fresh ?? true,
        reservationRequest,
        envelopeHash: req.body?.envelope_hash ?? match.envelope_hash ?? null,
        reserveRequest: (raw) => backend.registry.reserveRequest(raw),
        now: fixtureClock(),
      });

      const parsed = AuthorizationReceipt.parse(receipt);
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
      const scenario = ScenarioFixture.parse(loadFixture("scenario.json"));
      const offer = LenderFacilityOffer.parse(loadFixture("offer-lender-a.json"));
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

      const clock = fixtureClock();
      const result = await originateLoan(
        {
          proposalHash: req.body?.proposal_hash ?? prior.proposal_hash ?? "",
          principal: req.body?.principal ?? offer.principal,
          aprBps: req.body?.apr_bps ?? offer.apr_bps,
          termDays: req.body?.term_days ?? offer.term_days,
          asset: JSON.stringify(offer.asset),
          networkMode: config.networkMode,
          requestId,
          reservationId,
        },
        {
          getRequest: (id) => backend.registry.getRequest(id),
          applyEvent: (event) => backend.registry.applyEvent(event as never),
          hashRequest: contentHash,
          clockSeconds: () => Math.floor(clock.getTime() / 1000),
          borrowerAccount: "sim:borrower-harbor-supply",
          repAsset: scenario.rep_asset,
        },
      );

      const updated = {
        ...prior,
        signature_state: "SIGNATURE_ISSUED" as const,
        xrpl_state: "SIMULATED" as const,
        tx_hash: null,
        stake_proof_id: prior.stake_proof_id,
      };
      storeReceipt(AuthorizationReceipt.parse(updated));

      return {
        ...result,
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
      return { mode: config.networkMode, simulated: true, loan };
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
    return receipt;
  });
}
