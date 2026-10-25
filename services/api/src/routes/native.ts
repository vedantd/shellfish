import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getCreditBackend } from "../credit-context.js";

type IdParams = { id: string };
type OperationBody = { operation_id?: string; maximum_amount_native?: string; payment_mode?: "FULL" | "REGULAR" | "OVERPAYMENT" | "LATE" };
const validId = (id: unknown): id is string => typeof id === "string" && /^[A-Za-z0-9:_-]{1,180}$/.test(id);
function operator(req: FastifyRequest): void {
  const expected = process.env.SHELLFISH_OPERATOR_TOKEN;
  const provided = req.headers["x-shellfish-operator-token"];
  if (!expected || typeof provided !== "string") throw Object.assign(new Error("OPERATOR_AUTH_REQUIRED"), { statusCode: 403 });
  const a = Buffer.from(expected), b = Buffer.from(provided);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw Object.assign(new Error("OPERATOR_AUTH_REQUIRED"), { statusCode: 403 });
}
function native() {
  const backend = getCreditBackend();
  if (!backend || backend.mode !== "LIVE_DEVNET" || !backend.lifecycle || !backend.repReturns || !backend.nativeIntent || !backend.lifecycleStore)
    throw Object.assign(new Error("NATIVE_BACKEND_UNAVAILABLE"), { statusCode: 503 });
  return backend;
}
function failure(error: unknown, reply: FastifyReply) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : error instanceof Error ? error.message : "NATIVE_OPERATION_FAILED";
  const status = error && typeof error === "object" && "statusCode" in error ? Number(error.statusCode) : /NOT_FOUND|RETURN_CREDIT_REQUIRED/.test(code) ? 404 : /BUSY|RECONCILING/.test(code) ? 202 : 400;
  reply.code(status);
  // Error classes only. Never expose RPC payloads, signed blobs or keys.
  return { code: /^[A-Z0-9_]+$/.test(code) ? code : "NATIVE_OPERATION_FAILED", mode: "LIVE_DEVNET" };
}
function publicStatus<T extends { state: string }>(value: T, reply: FastifyReply): T {
  if (!["VALIDATED", "FAILED", "PAID"].includes(value.state)) reply.code(202);
  return value;
}

/** Rough Devnet lifecycle facade. All signing and accounting stays inside durable workers. */
export async function nativeRoutes(app: FastifyInstance) {
  app.post<{ Body: { idempotency_key?: string } }>("/v1/credit-intents", async (req, reply) => {
    try { return native().nativeIntent!(req.body?.idempotency_key); } catch (error) { return failure(error, reply); }
  });
  app.post<{ Params: IdParams; Body: OperationBody }>("/v1/loans/:id/repay", async (req, reply) => {
    try {
      const backend = native(), body = req.body;
      if (!validId(body?.operation_id) || !validId(req.params.id) || !/^[1-9][0-9]*$/.test(body.maximum_amount_native ?? "")) throw new Error("INVALID_REPAYMENT_REQUEST");
      const loan = backend.registry.getLoan(req.params.id);
      if (!loan.request_id) throw new Error("LOAN_REQUEST_BINDING_REQUIRED");
      return publicStatus(await backend.lifecycle!.repay({ operationId: body.operation_id, loanId: req.params.id,
        requestId: String(loan.request_id), maximumAmountNative: body.maximum_amount_native!, paymentMode: body.payment_mode }), reply);
    } catch (error) { return failure(error, reply); }
  });
  app.post<{ Params: IdParams; Body: OperationBody }>("/v1/loans/:id/default", async (req, reply) => {
    try {
      operator(req);
      const backend = native();
      if (!validId(req.body?.operation_id) || !validId(req.params.id)) throw new Error("INVALID_DEFAULT_REQUEST");
      const loan = backend.registry.getLoan(req.params.id);
      if (!loan.request_id) throw new Error("LOAN_REQUEST_BINDING_REQUIRED");
      return publicStatus(await backend.lifecycle!.defaultLoan({ operationId: req.body.operation_id, loanId: req.params.id, requestId: String(loan.request_id) }), reply);
    } catch (error) { return failure(error, reply); }
  });
  app.get<{ Params: IdParams }>("/v1/operations/:id", async (req, reply) => {
    try { return native().lifecycleStore!.getOperation(req.params.id); } catch (error) { return failure(error, reply); }
  });
  app.post<{ Params: IdParams }>("/v1/operations/:id/reconcile", async (req, reply) => {
    try { return publicStatus(await native().lifecycle!.reconcile(req.params.id), reply); } catch (error) { return failure(error, reply); }
  });
  app.get<{ Params: IdParams }>("/v1/rep-returns/:id", async (req, reply) => {
    try {
      const backend = native(), attempt = backend.returns.getReturnAttempt(req.params.id);
      return { instruction: backend.returns.getReturnInstruction(req.params.id), attempt: attempt ? {
        creditId: attempt.creditId, attemptHash: attempt.attemptHash, attemptNumber: attempt.attemptNumber,
        state: attempt.state, sequence: attempt.sequence, lastLedgerSequence: attempt.lastLedgerSequence } : null };
    } catch (error) { return failure(error, reply); }
  });
  app.post<{ Params: IdParams }>("/v1/rep-returns/:id/process", async (req, reply) => {
    try { return publicStatus(await native().repReturns!.processRepReturn(req.params.id), reply); } catch (error) { return failure(error, reply); }
  });
  app.post<{ Body: { kind?: "EXECUTION" | "LIFECYCLE" | "RETURN"; id?: string; expected_owner?: string; expected_fence?: number; acknowledge_worker_stopped?: boolean } }>("/v1/operator/recover", async (req, reply) => {
    try {
      operator(req);
      const backend = native(), body = req.body;
      if (!validId(body?.id) || !body.expected_owner || !Number.isSafeInteger(body.expected_fence) || body.acknowledge_worker_stopped !== true) throw new Error("INVALID_RECOVERY_ACK");
      const recovered = body.kind === "EXECUTION" ? backend.execution.acknowledgeExecutionRecovery(body.id, body.expected_owner, body.expected_fence!)
        : body.kind === "LIFECYCLE" ? backend.lifecycleStore!.recoverOperation(body.id, body.expected_owner, body.expected_fence!)
        : body.kind === "RETURN" ? backend.returns.recoverReturnWorker(body.id, body.expected_owner, body.expected_fence!) : false;
      if (!recovered) throw new Error("RECOVERY_COMPARE_AND_SET_REJECTED");
      return { recovered, id: body.id, kind: body.kind, economic_holds_released: false };
    } catch (error) { return failure(error, reply); }
  });
}
