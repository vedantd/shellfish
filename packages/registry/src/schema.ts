/** Owned registry schema. Legacy API tables stay intact during adoption. */
export const REGISTRY_SCHEMA = `
CREATE TABLE IF NOT EXISTS credit_portfolios (
  portfolio_key TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  network TEXT NOT NULL,
  mode TEXT NOT NULL,
  asset_json TEXT NOT NULL,
  rep_asset_json TEXT NOT NULL,
  borrower_account TEXT NOT NULL,
  money_scale TEXT NOT NULL,
  policy_hash TEXT NOT NULL,
  model_version TEXT NOT NULL,
  seed_u TEXT NOT NULL,
  available_u TEXT NOT NULL,
  reserved_u TEXT NOT NULL,
  bonded_u TEXT NOT NULL,
  pending_return_u TEXT NOT NULL,
  growth_u TEXT NOT NULL,
  forfeited_u TEXT NOT NULL,
  suspended INTEGER NOT NULL CHECK(suspended IN (0,1)),
  version INTEGER NOT NULL,
  seed_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS credit_facilities (
  facility_id TEXT PRIMARY KEY,
  portfolio_key TEXT NOT NULL REFERENCES credit_portfolios(portfolio_key),
  lender_id TEXT NOT NULL,
  limit_minor TEXT NOT NULL,
  committed_minor TEXT NOT NULL,
  reserved_minor TEXT NOT NULL,
  version INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS credit_requests (
  request_id TEXT PRIMARY KEY,
  portfolio_key TEXT NOT NULL REFERENCES credit_portfolios(portfolio_key),
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  request_json TEXT NOT NULL,
  facility_id TEXT NOT NULL REFERENCES credit_facilities(facility_id),
  reservation_id TEXT NOT NULL UNIQUE,
  principal_minor TEXT NOT NULL,
  original_bond_u TEXT NOT NULL,
  exposure_before_minor TEXT NOT NULL,
  exposure_version INTEGER NOT NULL,
  state TEXT NOT NULL,
  prepared_commitment TEXT,
  prepared_json TEXT,
  stake_hash TEXT UNIQUE,
  loan_id TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  UNIQUE(portfolio_key,idempotency_key)
);
CREATE TABLE IF NOT EXISTS credit_mandate_uses (
  principal_id TEXT NOT NULL,
  mandate_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  request_id TEXT NOT NULL UNIQUE REFERENCES credit_requests(request_id),
  PRIMARY KEY(principal_id,mandate_id),
  UNIQUE(principal_id,nonce)
);
CREATE TABLE IF NOT EXISTS credit_loans (
  loan_id TEXT PRIMARY KEY,
  portfolio_key TEXT NOT NULL REFERENCES credit_portfolios(portfolio_key),
  facility_id TEXT NOT NULL REFERENCES credit_facilities(facility_id),
  request_id TEXT UNIQUE REFERENCES credit_requests(request_id),
  principal_minor TEXT NOT NULL,
  outstanding_minor TEXT NOT NULL,
  original_bond_u TEXT NOT NULL,
  defaulted_minor TEXT NOT NULL DEFAULT '0',
  state TEXT NOT NULL,
  origin_time INTEGER NOT NULL,
  maturity_time INTEGER NOT NULL,
  next_due_time INTEGER NOT NULL,
  grace_seconds INTEGER NOT NULL DEFAULT 0,
  last_accrual_time INTEGER NOT NULL,
  reward_area TEXT NOT NULL DEFAULT '0',
  clean INTEGER NOT NULL DEFAULT 1,
  ever_impaired INTEGER NOT NULL DEFAULT 0,
  event_cursor TEXT,
  origin_hash TEXT
);
CREATE TABLE IF NOT EXISTS credit_events (
  event_id TEXT PRIMARY KEY,
  event_hash TEXT NOT NULL,
  request_id TEXT REFERENCES credit_requests(request_id),
  loan_id TEXT REFERENCES credit_loans(loan_id),
  kind TEXT NOT NULL,
  network TEXT NOT NULL,
  tx_hash TEXT,
  ledger_index INTEGER,
  transaction_index INTEGER,
  occurred_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  UNIQUE(network,tx_hash)
);
CREATE TABLE IF NOT EXISTS rep_return_credits (
  credit_id TEXT PRIMARY KEY,
  portfolio_key TEXT NOT NULL REFERENCES credit_portfolios(portfolio_key),
  request_id TEXT REFERENCES credit_requests(request_id),
  loan_id TEXT REFERENCES credit_loans(loan_id),
  amount_u TEXT NOT NULL,
  growth_u TEXT NOT NULL,
  reason TEXT NOT NULL,
  state TEXT NOT NULL,
  return_hash TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  UNIQUE(request_id,reason)
);
CREATE TABLE IF NOT EXISTS rep_reward_awards (
  award_id TEXT PRIMARY KEY,
  portfolio_key TEXT NOT NULL REFERENCES credit_portfolios(portfolio_key),
  loan_id TEXT NOT NULL UNIQUE REFERENCES credit_loans(loan_id),
  amount_u TEXT NOT NULL,
  awarded_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS credit_attempts (
  request_id TEXT NOT NULL REFERENCES credit_requests(request_id),
  phase TEXT NOT NULL,
  attempt_hash TEXT NOT NULL UNIQUE,
  signed_blob TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  last_ledger_sequence INTEGER NOT NULL,
  state TEXT NOT NULL,
  commitment TEXT NOT NULL,
  PRIMARY KEY(request_id,phase)
);
CREATE TABLE IF NOT EXISTS credit_execution_claims (
  request_id TEXT PRIMARY KEY REFERENCES credit_requests(request_id),
  owner TEXT NOT NULL,
  fence INTEGER NOT NULL,
  active INTEGER NOT NULL CHECK(active IN (0,1))
);
CREATE TABLE IF NOT EXISTS rep_issuer_lanes (
  issuer_key TEXT PRIMARY KEY,
  network TEXT NOT NULL,
  mode TEXT NOT NULL,
  issuer TEXT NOT NULL,
  active_credit_id TEXT REFERENCES rep_return_credits(credit_id),
  owner TEXT,
  fence INTEGER NOT NULL,
  claimed INTEGER NOT NULL CHECK(claimed IN (0,1)),
  next_sequence_floor INTEGER NOT NULL,
  UNIQUE(network,mode,issuer)
);
CREATE TABLE IF NOT EXISTS rep_return_attempts (
  credit_id TEXT NOT NULL REFERENCES rep_return_credits(credit_id),
  attempt_number INTEGER NOT NULL,
  network TEXT NOT NULL,
  mode TEXT NOT NULL,
  issuer_key TEXT NOT NULL REFERENCES rep_issuer_lanes(issuer_key),
  attempt_hash TEXT NOT NULL,
  signed_blob TEXT NOT NULL,
  first_ledger_sequence INTEGER NOT NULL,
  sequence INTEGER NOT NULL,
  last_ledger_sequence INTEGER NOT NULL,
  prepared_json TEXT NOT NULL,
  commitment TEXT NOT NULL,
  state TEXT NOT NULL,
  failure_json TEXT,
  PRIMARY KEY(credit_id,attempt_number),
  UNIQUE(network,mode,attempt_hash)
);
CREATE INDEX IF NOT EXISTS credit_loans_portfolio ON credit_loans(portfolio_key,state);
CREATE INDEX IF NOT EXISTS credit_requests_portfolio ON credit_requests(portfolio_key,state);
CREATE INDEX IF NOT EXISTS rep_awards_window ON rep_reward_awards(portfolio_key,awarded_at);
CREATE UNIQUE INDEX IF NOT EXISTS credit_one_asset_per_principal ON credit_portfolios(principal_id,network);
CREATE UNIQUE INDEX IF NOT EXISTS credit_one_principal_per_wallet ON credit_portfolios(network,borrower_account);
`;
