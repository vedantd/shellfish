import type Database from "better-sqlite3";
import {
  AuthorizationReceipt,
  LenderFacilityOffer,
  ReservationFixture,
  canonicalJson,
  withoutFields,
  type NetworkMode,
} from "@shellfish/schemas";

export class UiStateError extends Error {
  public readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "UiStateError";
  }
}

export interface UiStateOptions {
  hash: (value: unknown) => string;
  now?: () => Date;
  mode?: NetworkMode;
  network?: string;
}

const TABLES = `
CREATE TABLE IF NOT EXISTS app_ui_offers (
  commercial_terms_hash TEXT PRIMARY KEY,
  offer_hash TEXT NOT NULL,
  mode TEXT NOT NULL,
  network TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  stored_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS app_ui_receipts (
  request_id TEXT PRIMARY KEY,
  reservation_id TEXT UNIQUE,
  mode TEXT NOT NULL,
  network TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  stored_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS app_ui_receipt_history (
  receipt_hash TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  network TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  stored_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS app_ui_history_request ON app_ui_receipt_history(request_id);
`;
const TERMS_KEYS = ["lender_id", "borrower_id", "facility_id", "offer_id", "asset", "principal", "apr_bps", "rate_kind", "term_days", "fees", "purpose", "expires_at", "schedule", "network"];
const IMMUTABLE_RECEIPT_KEYS = ["contract_version", "model_version", "network", "mode", "request_id", "offer_id", "mandate_id", "proposal_hash", "envelope_hash", "reservation_id", "quote_bond_u", "policy_hash", "commercial_terms_hash"] as const;
type Row = Record<string, string | number | null>;

/** Existing SQLite connection owns this store. Importing the module opens no database. */
export function createUiStateStore(db: Database.Database, options: UiStateOptions) {
  db.exec(TABLES);
  const now = () => {
    const date = options.now?.() ?? new Date();
    if (!Number.isFinite(date.getTime())) throw new UiStateError("UI_STATE_INVALID_CLOCK");
    return date.toISOString();
  };
  const scopeMatches = (value: { mode: string; network: string }) =>
    (!options.mode || value.mode === options.mode) && (!options.network || value.network === options.network);
  const requireScope = (value: { mode: string; network: string }) => {
    if (!scopeMatches(value)) throw new UiStateError("UI_STATE_SCOPE_MISMATCH");
  };

  function checkedOffer(raw: unknown): LenderFacilityOffer {
    const offer = LenderFacilityOffer.parse(raw);
    requireScope(offer);
    const terms = Object.fromEntries(Object.entries(offer).filter(([key]) => TERMS_KEYS.includes(key)));
    if (options.hash(terms) !== offer.commercial_terms_hash ||
        options.hash(withoutFields(offer, ["lender_signature", "offer_hash"])) !== offer.offer_hash)
      throw new UiStateError("UI_STATE_OFFER_COMMITMENT_MISMATCH");
    return offer;
  }

  function storeApprovedOffer(raw: LenderFacilityOffer): void {
    const offer = checkedOffer(raw);
    const json = canonicalJson(offer);
    db.transaction(() => {
      const prior = db.prepare("SELECT payload_json FROM app_ui_offers WHERE commercial_terms_hash=?").get(offer.commercial_terms_hash) as Row | undefined;
      if (prior) {
        if (prior.payload_json !== json) throw new UiStateError("UI_STATE_IMMUTABLE_OFFER_CONFLICT");
        return;
      }
      db.prepare("INSERT INTO app_ui_offers (commercial_terms_hash,offer_hash,mode,network,payload_json,stored_at) VALUES (?,?,?,?,?,?)")
        .run(offer.commercial_terms_hash, offer.offer_hash, offer.mode, offer.network, json, now());
    }).immediate();
  }

  function getApprovedOffer(commercialTermsHash: string): LenderFacilityOffer | undefined {
    const row = db.prepare("SELECT payload_json,mode,network FROM app_ui_offers WHERE commercial_terms_hash=?").get(commercialTermsHash) as Row | undefined;
    if (!row || !scopeMatches({ mode: String(row.mode), network: String(row.network) })) return undefined;
    return checkedOffer(JSON.parse(String(row.payload_json)));
  }

  function getReceipt(id: string): AuthorizationReceipt | undefined {
    const row = (db.prepare("SELECT payload_json,mode,network FROM app_ui_receipts WHERE request_id=?").get(id) ??
      db.prepare("SELECT payload_json,mode,network FROM app_ui_receipts WHERE reservation_id=?").get(id)) as Row | undefined;
    if (!row || !scopeMatches({ mode: String(row.mode), network: String(row.network) })) return undefined;
    return AuthorizationReceipt.parse(JSON.parse(String(row.payload_json)));
  }

  function bindAllow(receipt: AuthorizationReceipt): void {
    const row = db.prepare(`SELECT r.*, p.mode AS portfolio_mode, p.network AS portfolio_network
      FROM credit_requests r JOIN credit_portfolios p ON p.portfolio_key=r.portfolio_key WHERE r.request_id=?`)
      .get(receipt.request_id) as Row | undefined;
    if (!row) throw new UiStateError("UI_STATE_RESERVATION_REQUIRED");
    const request = ReservationFixture.shape.request.parse(JSON.parse(String(row.request_json)));
    const offer = getApprovedOffer(request.commercial_terms_hash);
    if (!offer) throw new UiStateError("UI_STATE_APPROVED_OFFER_REQUIRED");
    if (!receipt.compatible || receipt.reason_codes.length || Object.values(receipt.checks).some(result => result !== "PASS") ||
        receipt.reservation_id !== row.reservation_id || receipt.proposal_hash !== row.payload_hash ||
        options.hash(request) !== row.payload_hash || receipt.quote_bond_u !== row.original_bond_u ||
        receipt.mode !== request.mode || receipt.network !== request.network ||
        receipt.mode !== row.portfolio_mode || receipt.network !== row.portfolio_network ||
        receipt.contract_version !== request.contract_version || receipt.model_version !== request.model_version ||
        receipt.mandate_id !== request.mandate_id || receipt.offer_id !== request.offer_id ||
        receipt.policy_hash !== request.policy_hash || receipt.commercial_terms_hash !== request.commercial_terms_hash ||
        offer.mode !== request.mode || offer.network !== request.network || offer.offer_id !== request.offer_id ||
        offer.facility_id !== request.facility_id || offer.borrower_id !== request.principal_id ||
        canonicalJson(offer.asset) !== canonicalJson(request.asset) ||
        BigInt(offer.principal.replace(".", "")) !== BigInt(request.principal_minor))
      throw new UiStateError("UI_STATE_RECEIPT_BINDING_MISMATCH");
    if (receipt.signature_state === "DENIED") throw new UiStateError("UI_STATE_RECEIPT_BINDING_MISMATCH");
    if (receipt.xrpl_state === "SIMULATED" && (!row.loan_id || request.mode !== "SIMULATED_LOAN"))
      throw new UiStateError("UI_STATE_EXECUTION_EVIDENCE_REQUIRED");
    if (receipt.tx_hash !== null) {
      if (receipt.mode !== "LIVE_DEVNET" || !/^[A-Fa-f0-9]{64}$/.test(receipt.tx_hash))
        throw new UiStateError("UI_STATE_EXECUTION_EVIDENCE_REQUIRED");
      const event = db.prepare("SELECT event_id FROM credit_events WHERE request_id=? AND tx_hash=? AND network=? AND kind='ORIGINATION_VALIDATED'")
        .get(receipt.request_id, receipt.tx_hash, receipt.network);
      if (!event || !row.loan_id || receipt.stake_proof_id !== row.stake_hash)
        throw new UiStateError("UI_STATE_EXECUTION_EVIDENCE_REQUIRED");
    }
    if (receipt.xrpl_state === "VALIDATED_ACTIVE" && receipt.tx_hash === null)
      throw new UiStateError("UI_STATE_EXECUTION_EVIDENCE_REQUIRED");
    if (row.prepared_commitment !== null && receipt.prepared_tx_commitment !== null && row.prepared_commitment !== receipt.prepared_tx_commitment)
      throw new UiStateError("UI_STATE_RECEIPT_BINDING_MISMATCH");
  }

  function mergeProgress(previous: AuthorizationReceipt, incoming: AuthorizationReceipt): AuthorizationReceipt {
    if (IMMUTABLE_RECEIPT_KEYS.some(key => previous[key] !== incoming[key]))
      throw new UiStateError("UI_STATE_IMMUTABLE_RECEIPT_CONFLICT");
    for (const key of ["tx_hash", "prepared_tx_commitment", "stake_proof_id"] as const)
      if (previous[key] !== null && incoming[key] !== null && previous[key] !== incoming[key])
        throw new UiStateError("UI_STATE_EXECUTION_CONFLICT");
    const rank = { NOT_SUBMITTED: 0, SUBMITTED: 1, RECONCILING: 2, FAILED: 3, VALIDATED_ACTIVE: 4, SIMULATED: 4 };
    if (rank[incoming.xrpl_state] < rank[previous.xrpl_state]) return previous;
    if (previous.signature_state === "SIGNATURE_ISSUED" && incoming.signature_state !== "SIGNATURE_ISSUED") return previous;
    if (previous.native_signing_permitted && !incoming.native_signing_permitted) return previous;
    return incoming;
  }

  function storeReceipt(raw: AuthorizationReceipt): void {
    const receipt = AuthorizationReceipt.parse(raw);
    requireScope(receipt);
    if (receipt.decision === "DENY" && (receipt.compatible || receipt.reservation_id !== null || receipt.tx_hash !== null || receipt.native_signing_permitted))
      throw new UiStateError("UI_STATE_INVALID_DENIAL");
    db.transaction(() => {
      if (receipt.decision === "ALLOW") bindAllow(receipt);
      // Writes inspect the exact existing request across scopes. A scoped miss must not
      // turn into permission to replace another mode's accepted receipt.
      const priorRow = db.prepare("SELECT payload_json FROM app_ui_receipts WHERE request_id=?").get(receipt.request_id) as Row | undefined;
      const prior = priorRow ? AuthorizationReceipt.parse(JSON.parse(String(priorRow.payload_json))) : undefined;
      if (prior && (prior.mode !== receipt.mode || prior.network !== receipt.network))
        throw new UiStateError("UI_STATE_SCOPE_MISMATCH");
      const collision = db.prepare("SELECT request_id FROM app_ui_receipts WHERE reservation_id=? AND request_id<>?").get(receipt.request_id, receipt.request_id);
      const reverseCollision = receipt.reservation_id === null ? undefined :
        db.prepare("SELECT request_id FROM app_ui_receipts WHERE request_id=? AND request_id<>?").get(receipt.reservation_id, receipt.request_id);
      if (collision || reverseCollision) throw new UiStateError("UI_STATE_LOOKUP_IDENTITY_CONFLICT");
      let selected = receipt;
      if (prior?.decision === "ALLOW") selected = receipt.decision === "DENY" ? prior : mergeProgress(prior, receipt);
      const timestamp = now();
      db.prepare("INSERT OR IGNORE INTO app_ui_receipt_history (receipt_hash,request_id,mode,network,payload_json,stored_at) VALUES (?,?,?,?,?,?)")
        .run(options.hash(receipt), receipt.request_id, receipt.mode, receipt.network, canonicalJson(receipt), timestamp);
      db.prepare(`INSERT INTO app_ui_receipts (request_id,reservation_id,mode,network,payload_json,stored_at) VALUES (?,?,?,?,?,?)
        ON CONFLICT(request_id) DO UPDATE SET reservation_id=excluded.reservation_id,mode=excluded.mode,network=excluded.network,payload_json=excluded.payload_json,stored_at=excluded.stored_at`)
        .run(selected.request_id, selected.reservation_id, selected.mode, selected.network, canonicalJson(selected), timestamp);
    }).immediate();
  }

  return { storeApprovedOffer, getApprovedOffer, storeReceipt, getReceipt };
}

export type UiStateStore = ReturnType<typeof createUiStateStore>;
