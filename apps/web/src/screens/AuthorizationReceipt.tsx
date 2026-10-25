import { useEffect, useState } from "react";
import {
  api,
  ApiError,
  apiBase,
  type AuthReceipt,
  type NetworkInfo,
  type OriginateResult,
} from "../lib/api";
import { AssetDisplay, ExplorerLink } from "../components/ExplorerLink";
import { demoMandate } from "../demo/c0Materials";
import { useDemoSession } from "../state/demoSession";

type DenialKind = "amount" | "rate" | "replay";

export function AuthorizationReceiptScreen() {
  const session = useDemoSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [network, setNetwork] = useState<NetworkInfo | null>(null);
  const [denial, setDenial] = useState<AuthReceipt | null>(null);

  useEffect(() => {
    void api<NetworkInfo>("/v1/network")
      .then(setNetwork)
      .catch(() => setNetwork(null));
  }, []);

  const mode = network?.mode ?? "SIMULATED_LOAN";
  const isLive = mode === "LIVE_DEVNET";

  async function runHappyPath() {
    setBusy(true);
    setError(null);
    setDenial(null);
    session.clearExecution();
    try {
      const authBody = await api<AuthReceipt>("/v1/authorizations", {
        method: "POST",
        body: JSON.stringify({
          unique: true,
          evidence_fresh: true,
          ...(session.mandate ? { mandate: session.mandate } : {}),
          ...(session.matchedOffer ? { offer: session.matchedOffer } : {}),
        }),
      }).catch(async (err) => {
        if (err instanceof ApiError && err.status === 403) {
          return err.body as AuthReceipt;
        }
        throw err;
      });

      if (authBody.decision !== "ALLOW") {
        session.setReceipt(authBody);
        setError(
          authBody.reason_codes?.join(", ") ||
            `Authorization ${authBody.decision ?? "failed"}`,
        );
        return;
      }
      session.setReceipt(authBody);

      const origBody = await api<OriginateResult>("/v1/loans/originate", {
        method: "POST",
        body: JSON.stringify({
          request_id: authBody.request_id,
          reservation_id: authBody.reservation_id,
          proposal_hash: authBody.proposal_hash,
        }),
      });
      session.setOriginate(origBody);

      const joined = await api(`/v1/requests/${authBody.request_id}`);
      session.setJoinedRequest(joined);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? `${err.message} — is the API running on ${apiBase}?`
            : "Request failed",
      );
    } finally {
      setBusy(false);
    }
  }

  async function runDenial(kind: DenialKind) {
    setBusy(true);
    setError(null);
    setDenial(null);
    try {
      if (kind === "replay") {
        await api<AuthReceipt>("/v1/authorizations", {
          method: "POST",
          body: JSON.stringify({ unique: true, evidence_fresh: true }),
        });
        const second = await api<AuthReceipt>("/v1/authorizations", {
          method: "POST",
          body: JSON.stringify({ unique: true, evidence_fresh: true }),
        }).catch((err) => {
          if (err instanceof ApiError) return err.body as AuthReceipt;
          throw err;
        });
        setDenial(second);
        return;
      }

      if (isLive && !session.matchedOffer) {
        setError("Find a matched Devnet offer in Credit & lenders before checking guardrails.");
        return;
      }

      const baseOffer =
        session.matchedOffer ??
        ({
          ...demoMandate,
          lender_id: "lender-A",
          borrower_id: demoMandate.principal_id,
          facility_id: "facility-A-001",
          offer_id: "offer-deny-demo",
          principal: "2000.00",
          apr_bps: 550,
          term_days: 90,
          fees: "0.00",
          purpose: "working_capital",
          facility_limit: "5000.00",
          active_commitments: "1000.00",
          reserved: "0.00",
          expires_at: "2026-10-24T22:00:00Z",
          underwriting_policy: "lenderA-v2",
          approval_ref: "uw-deny",
          lender_signature: "sig-simulated-lender",
          rate_kind: "NOMINAL_ANNUAL",
          schedule: {
            kind: "BULLET",
            payment_total: 1,
            payment_interval_seconds: 7776000,
            native_acceptance: "PENDING_VEDANT",
          },
          commercial_terms_hash: "sha256:deny-demo",
          offer_hash: "sha256:deny-demo",
          contract_version: "C0-REP-1",
          model_version: "REP-CURVE-v0.2",
          network: "devnet",
          mode: "SIMULATED_LOAN",
        } as Record<string, unknown>);

      const offer =
        kind === "amount"
          ? { ...baseOffer, principal: "3000.00" }
          : { ...baseOffer, apr_bps: 900 };

      const receipt = await api<AuthReceipt>("/v1/authorizations", {
        method: "POST",
        body: JSON.stringify({
          unique: true,
          evidence_fresh: true,
          offer,
          ...(isLive
            ? {}
            : { mandate: session.mandate ?? demoMandate }),
        }),
      }).catch((err) => {
        if (err instanceof ApiError) return err.body as AuthReceipt;
        throw err;
      });
      setDenial(receipt);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Denial demo failed");
    } finally {
      setBusy(false);
    }
  }

  const receipt = session.receipt;
  const originate = session.originate;
  const joined = session.joinedRequest as Record<string, unknown> | null;
  const signing = network?.public_signing && typeof network.public_signing === "object"
    ? network.public_signing as Record<string, unknown> : null;
  const transactions = Array.isArray(joined?.transactions)
    ? joined.transactions.filter((v): v is Record<string, unknown> => Boolean(v && typeof v === "object")) : [];
  const attempts = Array.isArray(joined?.attempts)
    ? joined.attempts.filter((v): v is Record<string, unknown> => Boolean(v && typeof v === "object")) : [];
  const eventLabels: Record<string, string> = {
    STAKE_VALIDATED: "REP stake payment", ORIGINATION_VALIDATED: "LoanSet",
    REP_RETURN_VALIDATED: "REP return payment", REPAYMENT: "LoanPay", DEFAULT: "LoanManage",
  };

  return (
    <section className="screen">
      <p className="eyebrow">Authorization &amp; ledger receipt</p>
      <h2>Every action accounted for.</h2>
      <p className="lede">
        {isLive
          ? "Review the approved action, reputation bond and Devnet record. Each native identifier opens directly in the explorer."
          : "Preview the authorization and loan flow in simulation. Simulated records do not create ledger transactions."}
        {isLive && network?.live_ready === false ? " Devnet connection is not ready yet." : ""}
      </p>

      <div className="actions" style={{ marginTop: 0 }}>
        <button type="button" disabled={busy} onClick={() => void runHappyPath()}>
          {busy ? "Processing loan…" : isLive ? "Authorize & originate loan" : "Preview loan authorization"}
        </button>
      </div>

      <details className="guardrails">
        <summary>Check borrowing guardrails</summary>
        <p className="note">These checks demonstrate denied requests against the current mandate.</p>
        <div className="actions">
          <button type="button" className="deny" disabled={busy} onClick={() => void runDenial("amount")}>Excess amount · 3,000</button>
          <button type="button" className="deny" disabled={busy} onClick={() => void runDenial("rate")}>Excess rate · 9%</button>
          <button type="button" className="deny" disabled={busy} onClick={() => void runDenial("replay")}>Repeated request</button>
        </div>
      </details>

      {error ? <p className="error" role="alert">{error}</p> : null}

      {signing ? (
        <div className="doc-strip">
          <h3>Devnet assets</h3>
          <dl className="grid">
            <div><dt>Loan token</dt><dd><AssetDisplay asset={signing.native_loan_asset} native={isLive} /></dd></div>
            <div><dt>Reputation token</dt><dd><AssetDisplay asset={signing.native_rep_asset} native={isLive} /></dd></div>
            <div><dt>Borrower</dt><dd><ExplorerLink kind="account" value={signing.borrower_account} native={isLive} /></dd></div>
          </dl>
        </div>
      ) : null}

      {denial ? (
        <div className="ledger ledger-denied">
          <h3>Request declined</h3>
          <p><span className="pill-status decline">{denial.decision}</span></p>
          <p>Reason · {(denial.reason_codes ?? []).join(", ") || "—"}</p>
          <p>Reservation · {denial.reservation_id ?? "None created"}</p>
        </div>
      ) : null}

      {receipt ? (
        <div className={`ledger ${receipt.decision === "DENY" ? "ledger-denied" : ""}`}>
          <h3>Authorization record</h3>
          <dl className="grid">
            <div><dt>Decision</dt><dd><span className={`pill-status ${receipt.decision === "ALLOW" ? "approve" : "decline"}`}>{receipt.decision}</span></dd></div>
            <div><dt>REP bond · atomic units</dt><dd>{receipt.quote_bond_u ?? "—"}</dd></div>
            <div><dt>Request</dt><dd className="mono">{receipt.request_id}</dd></div>
            <div><dt>Reservation</dt><dd className="mono">{receipt.reservation_id ?? "—"}</dd></div>
          </dl>
          {receipt.tx_hash ? <p>Transaction · <ExplorerLink kind="transaction" value={receipt.tx_hash} native={isLive && receipt.mode === "LIVE_DEVNET"} /></p> : null}
          {receipt.stake_proof_id ? <p>Stake proof · <ExplorerLink kind="transaction" value={receipt.stake_proof_id} native={isLive && receipt.mode === "LIVE_DEVNET"} /></p> : null}
          <details className="technical-details"><summary>Application commitment</summary><p className="mono">{receipt.proposal_hash ?? "—"}</p></details>
        </div>
      ) : null}

      {originate ? (
        <div className="ledger">
          <h3>{originate.simulated ? "Simulated loan" : "LoanSet record"}</h3>
          <p><span className={`pill-status ${originate.validated ? "approve" : "pending"}`}>{originate.simulated ? "Simulation" : originate.validated ? "Validated on Devnet" : "Awaiting validation"}</span></p>
          <p>Loan ID · <span className="mono">{originate.loanId ?? "—"}</span></p>
          <p>LoanSet transaction · <ExplorerLink kind="transaction" value={originate.txHash} native={isLive && originate.simulated !== true} /></p>
        </div>
      ) : null}

      {joined ? (
        <div className="ledger">
          <h3>Loan activity</h3>
          <p>Current state · <strong>{String(joined.request_state ?? (joined.request as { state?: string } | undefined)?.state ?? joined.state ?? "—")}</strong></p>
          {transactions.length ? <div className="transaction-list">{transactions.map((event, index) => (
            <div className="transaction-row" key={String(event.event_id ?? index)}>
              <span>{eventLabels[String(event.kind)] ?? String(event.kind ?? "Transaction")}</span>
              <ExplorerLink kind="transaction" value={event.tx_hash} native={isLive && joined.mode === "LIVE_DEVNET" && joined.network === "devnet"} />
              <span className={`pill-status ${event.recorded_validated === true ? "approve" : "pending"}`}>{event.recorded_validated === true ? "Recorded" : joined.mode === "SIMULATED_LOAN" ? "Simulation" : "Pending"}</span>
            </div>
          ))}</div> : <p className="note">No recorded ledger transactions yet.</p>}
          {attempts.length ? <details className="technical-details"><summary>Transaction attempts</summary>{attempts.map((attempt,index) => <p key={index}>{String(attempt.phase ?? "Attempt")} · <ExplorerLink kind="transaction" value={attempt.tx_hash} native={isLive && joined.mode === "LIVE_DEVNET" && joined.network === "devnet"} /> · {String(attempt.state ?? "Pending")}</p>)}</details> : null}
          <details className="technical-details"><summary>Full request record</summary><pre>{JSON.stringify(joined, null, 2)}</pre></details>
        </div>
      ) : null}
    </section>
  );
}
