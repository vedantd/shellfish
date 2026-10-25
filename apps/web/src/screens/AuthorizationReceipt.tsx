import { useEffect, useState } from "react";
import {
  api,
  ApiError,
  apiBase,
  type AuthReceipt,
  type NetworkInfo,
  type OriginateResult,
} from "../lib/api";
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
        setError("Load a matched LIVE offer on Screen B before denial demos.");
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

  return (
    <section className="screen">
      <h2>Authorization &amp; receipt</h2>
      <p className="lede">
        Mode: <strong>{mode}</strong>
        {isLive
          ? " — LIVE Devnet. Show explorer links only for real validated hashes."
          : " — labeled SIMULATED_LOAN; tx_hash stays null (not on-chain)."}
        {isLive && network?.live_ready === false
          ? " live_ready is false (handles not fully configured)."
          : ""}
      </p>

      <div className="actions" style={{ marginTop: 0 }}>
        <button type="button" disabled={busy} onClick={() => void runHappyPath()}>
          {busy
            ? "Working…"
            : isLive
              ? "Run LIVE ALLOW → stake → LoanSet"
              : "Run simulated ALLOW → originate"}
        </button>
      </div>

      <div className="actions">
        <button
          type="button"
          className="deny"
          disabled={busy}
          onClick={() => void runDenial("amount")}
        >
          Deny amount (3,000)
        </button>
        <button
          type="button"
          className="deny"
          disabled={busy}
          onClick={() => void runDenial("rate")}
        >
          Deny rate (9%)
        </button>
        <button
          type="button"
          className="deny"
          disabled={busy}
          onClick={() => void runDenial("replay")}
        >
          Deny replay
        </button>
      </div>

      {error ? <p className="error">{error}</p> : null}

      {denial ? (
        <div className="ledger">
          <h3>Denial receipt</h3>
          <p>decision: {denial.decision}</p>
          <p>reasons: {(denial.reason_codes ?? []).join(", ") || "—"}</p>
          <p>reservation_id: {denial.reservation_id ?? "null"}</p>
          <p>mode: {denial.mode}</p>
        </div>
      ) : null}

      {receipt ? (
        <div className="ledger">
          <h3>Authorization</h3>
          <p>
            decision: {receipt.decision} · mode: {receipt.mode}
          </p>
          <p>request_id: {receipt.request_id}</p>
          <p>reservation_id: {receipt.reservation_id ?? "—"}</p>
          <p>proposal_hash: {receipt.proposal_hash ?? "—"}</p>
          <p>quote_bond_u: {receipt.quote_bond_u ?? "—"}</p>
          <p>
            tx_hash: {receipt.tx_hash ?? "null"} · native_signing:{" "}
            {String(receipt.native_signing_permitted)}
          </p>
          {receipt.stake_proof_id ? (
            <p>stake_proof_id: {receipt.stake_proof_id}</p>
          ) : null}
        </div>
      ) : null}

      {originate ? (
        <div className="ledger">
          <h3>
            Originate {originate.simulated ? "(simulated)" : "(live)"}
          </h3>
          <p>
            simulated: {String(originate.simulated)} · validated:{" "}
            {String(originate.validated)}
          </p>
          <p>loanId: {originate.loanId ?? "—"}</p>
          <p>
            txHash:{" "}
            {originate.txHash ? (
              <span className={isLive ? "hash-pulse" : undefined}>
                {originate.txHash}
              </span>
            ) : (
              "null"
            )}
          </p>
          {originate.explorer && originate.txHash ? (
            <p>
              explorer:{" "}
              <a href={originate.explorer} target="_blank" rel="noreferrer">
                {originate.explorer}
              </a>
            </p>
          ) : (
            <p>explorer: none (sim or missing hash)</p>
          )}
        </div>
      ) : null}

      {joined ? (
        <div className="ledger">
          <h3>Joined request view</h3>
          <p>GET /v1/requests/:id — source of truth after ALLOW</p>
          <p>
            request state:{" "}
            {String(
              (joined as { request_state?: string }).request_state ??
                (joined.request as { state?: string } | undefined)?.state ??
                joined.state ??
                "—",
            )}
          </p>
          <pre style={{ margin: "0.5rem 0 0", whiteSpace: "pre-wrap" }}>
            {JSON.stringify(joined, null, 2).slice(0, 1800)}
            {JSON.stringify(joined).length > 1800 ? "\n…" : ""}
          </pre>
        </div>
      ) : null}

      <p className="note">API: {apiBase}</p>
    </section>
  );
}
