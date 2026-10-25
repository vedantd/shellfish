import {
  EvidencePassport as EvidencePassportSchema,
  withoutFields,
  type EvidencePassport,
} from "@shellfish/schemas";

// Shared schemas contain JSON values only. Return detached copies without a DOM/Node global.
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

export class EvidenceError extends Error {
  constructor(public readonly code: "DENY_IDENTITY" | "DENY_EVIDENCE_STALE" | "DENY_TRANSACTION_MISMATCH" | "DENY_IDEMPOTENCY_CONFLICT" | "PERFORMANCE_ATTESTATION_REQUIRED" | "EVIDENCE_NOT_CONFIGURED", message: string) {
    super(message);
    this.name = "EvidenceError";
  }
}

export interface PerformanceEventInput {
  eventId: string;
  subjectId: string;
  loanId: string;
  eventType: "on_time" | "late" | "default" | "repaid";
  amount: string;
  observedAt: string;
}
export interface EvidenceServiceOptions {
  passports: readonly EvidencePassport[];
  hash: (value: unknown) => string;
  now?: () => Date;
  // Trusted attestor/reconciler hook. Raw HTTP callers must not supply this hook.
  attestPerformance?: (event: Readonly<PerformanceEventInput>, current: EvidencePassport) => Promise<EvidencePassport>;
}

/** Calendar months completed inside the attested observation window. */
export function completedHistoryMonths(startIso: string, endIso: string): number {
  const start = new Date(startIso), end = new Date(endIso);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) return -1;
  let months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth();
  const anniversary = new Date(start);
  anniversary.setUTCMonth(anniversary.getUTCMonth() + months);
  if (anniversary > end) months--;
  return months;
}

/** Validates content and dated provenance. Signature verification belongs to the attestor adapter. */
export function validateEvidencePassport(raw: unknown, now: Date, hash: (value: unknown) => string): EvidencePassport {
  const parsed = EvidencePassportSchema.safeParse(raw);
  if (!parsed.success) throw new EvidenceError("DENY_TRANSACTION_MISMATCH", "Evidence does not match the shared schema");
  const passport = parsed.data;
  if (hash(withoutFields(passport, ["signature", "evidence_hash"])) !== passport.evidence_hash)
    throw new EvidenceError("DENY_TRANSACTION_MISMATCH", "Evidence content commitment changed");
  const issued = Date.parse(passport.issued_at), expires = Date.parse(passport.expires_at);
  const start = Date.parse(passport.history.observation_start), end = Date.parse(passport.history.observation_end);
  const asOf = Date.parse(passport.known_exposure.as_of), instant = now.getTime();
  if (!Number.isFinite(instant)) throw new TypeError("Invalid evidence clock");
  if (expires <= issued || start > end || end > issued || asOf > issued ||
      passport.history.accepted_history_months > completedHistoryMonths(passport.history.observation_start, passport.history.observation_end))
    throw new EvidenceError("DENY_TRANSACTION_MISMATCH", "Evidence observation dates or accepted history are inconsistent");
  if (issued > instant || instant >= expires)
    throw new EvidenceError("DENY_EVIDENCE_STALE", "Evidence is future-dated or expired at the supplied clock");
  return clone(passport);
}

export function createEvidenceService(options: EvidenceServiceOptions) {
  const now = options.now ?? (() => new Date());
  const hash = options.hash;
  const passports = new Map<string, EvidencePassport>();
  for (const raw of options.passports) {
    const parsed = validateEvidencePassport(raw, now(), hash);
    if (passports.has(parsed.subject_id)) throw new EvidenceError("DENY_IDENTITY", "Duplicate seeded subject");
    passports.set(parsed.subject_id, parsed);
  }
  const applied = new Map<string, string>();
  const queues = new Map<string, Promise<void>>();
  async function getEvidencePassport(subjectId: string): Promise<EvidencePassport> {
    const passport = passports.get(subjectId);
    if (!passport) throw new EvidenceError("DENY_IDENTITY", "No enrolled evidence for this subject");
    return validateEvidencePassport(passport, now(), hash);
  }
  async function recordPerformanceEvent(input: PerformanceEventInput): Promise<void> {
    if (!options.attestPerformance) throw new EvidenceError("PERFORMANCE_ATTESTATION_REQUIRED", "A trusted attestor must produce the updated passport");
    if (!input.eventId || !input.subjectId || !input.loanId || !["on_time", "late", "default", "repaid"].includes(input.eventType) ||
        !/^(0|[1-9][0-9]*)\.[0-9]{2}$/.test(input.amount) || !Number.isFinite(Date.parse(input.observedAt)) || Date.parse(input.observedAt) > now().getTime())
      throw new EvidenceError("DENY_TRANSACTION_MISMATCH", "Invalid performance event identity, amount or time");
    const event = clone(input), fingerprint = hash(event), key = `${event.subjectId}\u0000${event.eventId}`;
    const previous = queues.get(event.subjectId) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(async () => {
      const oldFingerprint = applied.get(key);
      if (oldFingerprint) {
        if (oldFingerprint !== fingerprint) throw new EvidenceError("DENY_IDEMPOTENCY_CONFLICT", "Event ID already selects different content");
        return;
      }
      const current = await getEvidencePassport(event.subjectId);
      const next = validateEvidencePassport(await options.attestPerformance!(Object.freeze(event), clone(current)), now(), hash);
      if (next.subject_id !== current.subject_id || next.issuer_id !== current.issuer_id || next.network !== current.network ||
          next.mode !== current.mode || next.contract_version !== current.contract_version || next.model_version !== current.model_version ||
          next.evidence_version === current.evidence_version || Date.parse(next.issued_at) < Date.parse(current.issued_at))
        throw new EvidenceError("DENY_TRANSACTION_MISMATCH", "Attestation must preserve identity/context and issue a new evidence version");
      for (const counter of ["on_time", "late", "default"] as const) {
        const expected = current.history[counter] + Number(event.eventType === counter);
        if (next.history[counter] !== expected) throw new EvidenceError("DENY_TRANSACTION_MISMATCH", "Attested counters do not match the verified event");
      }
      passports.set(event.subjectId, next);
      applied.set(key, fingerprint);
    });
    queues.set(event.subjectId, operation);
    try { await operation; } finally { if (queues.get(event.subjectId) === operation) queues.delete(event.subjectId); }
  }
  return { getEvidencePassport, recordPerformanceEvent };
}

export type EvidenceService = ReturnType<typeof createEvidenceService>;
let configured: EvidenceService | undefined;
export function configureEvidenceService(options: EvidenceServiceOptions): EvidenceService {
  configured = createEvidenceService(options);
  return configured;
}
function service(): EvidenceService {
  if (!configured) throw new EvidenceError("EVIDENCE_NOT_CONFIGURED", "Configure an explicit evidence source before use");
  return configured;
}
export async function getEvidencePassport(subjectId: string): Promise<EvidencePassport> { return service().getEvidencePassport(subjectId); }
export async function recordPerformanceEvent(input: PerformanceEventInput): Promise<void> { return service().recordPerformanceEvent(input); }
export const packageOwner = "Gita" as const;
