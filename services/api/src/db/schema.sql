-- Shellfish demo registry (PRD §7.2)
-- Apply with: pnpm db:init
-- Legacy orchestration tables remain intact.
-- REP-CURVE tables are initialized by @shellfish/registry initializeRegistrySchema.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS principals (
  principal_id TEXT PRIMARY KEY,
  verified_by TEXT,
  legal_name_stub TEXT NOT NULL,
  borrower_xrpl_account TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS agents (
  agent_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES principals(principal_id),
  key_id TEXT,
  delegated_scope TEXT,
  disabled_at TEXT
);

CREATE TABLE IF NOT EXISTS mandates (
  mandate_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES principals(principal_id),
  version TEXT NOT NULL,
  signature TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  immutable_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evidence_passports (
  evidence_id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  issuer_id TEXT NOT NULL,
  version TEXT NOT NULL,
  as_of TEXT NOT NULL,
  expiry TEXT NOT NULL,
  hash TEXT NOT NULL,
  coverage TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS facilities (
  facility_id TEXT PRIMARY KEY,
  lender_id TEXT NOT NULL,
  borrower_id TEXT NOT NULL,
  approved_limit TEXT NOT NULL,
  committed TEXT NOT NULL DEFAULT '0.00',
  reserved TEXT NOT NULL DEFAULT '0.00',
  asset TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS offers (
  offer_id TEXT PRIMARY KEY,
  facility_id TEXT NOT NULL REFERENCES facilities(facility_id),
  apr_bps INTEGER NOT NULL,
  fees TEXT NOT NULL,
  principal TEXT NOT NULL,
  term_days INTEGER NOT NULL,
  approved_ref TEXT NOT NULL,
  expiry TEXT NOT NULL,
  signed_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reservations (
  reservation_id TEXT PRIMARY KEY,
  facility_id TEXT NOT NULL REFERENCES facilities(facility_id),
  proposal_hash TEXT NOT NULL UNIQUE,
  amount TEXT NOT NULL,
  state TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS authorizations (
  decision_id TEXT PRIMARY KEY,
  nonce TEXT NOT NULL,
  proposal_hash TEXT NOT NULL,
  envelope_hash TEXT,
  status TEXT NOT NULL,
  reason TEXT,
  UNIQUE (nonce)
);

CREATE TABLE IF NOT EXISTS loan_executions (
  execution_id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL REFERENCES authorizations(decision_id),
  xrpl_tx_hash TEXT UNIQUE,
  loan_id TEXT,
  validated_status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS loan_events (
  loan_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  type TEXT NOT NULL,
  amount TEXT,
  ledger_index INTEGER,
  evidence_eligible INTEGER NOT NULL DEFAULT 0,
  event_time TEXT NOT NULL,
  PRIMARY KEY (loan_id, event_id)
);
