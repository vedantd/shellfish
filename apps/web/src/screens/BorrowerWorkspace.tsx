import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  api,
  ApiError,
  type Mandate,
  type NetworkInfo,
} from "../lib/api";
import { AssetDisplay, ExplorerLink } from "../components/ExplorerLink";
import { demoMandate } from "../demo/c0Materials";
import { useDemoSession } from "../state/demoSession";

type CreditIntent = {
  mandate: Mandate;
  offer?: { facility_id?: string; principal?: string; apr_bps?: number; term_days?: number };
};

export function BorrowerWorkspace() {
  const session = useDemoSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validated, setValidated] = useState(false);
  const [network, setNetwork] = useState<NetworkInfo | null>(null);
  const [liveIntent, setLiveIntent] = useState<CreditIntent | null>(null);

  useEffect(() => {
    void api<NetworkInfo>("/v1/network")
      .then(setNetwork)
      .catch(() => setNetwork(null));
  }, []);

  const isLive = network?.mode === "LIVE_DEVNET";
  const display = (isLive ? liveIntent?.mandate : null) ?? session.mandate ?? demoMandate;
  const hasLiveMandate = Boolean(liveIntent?.mandate || session.mandate?.mode === "LIVE_DEVNET");
  const signing = network?.public_signing && typeof network.public_signing === "object"
    ? network.public_signing as Record<string, unknown> : null;
  const requested =
    isLive && liveIntent?.offer
      ? `${liveIntent.offer.principal ?? "—"} · ${liveIntent.offer.apr_bps ?? "—"} bps · ${liveIntent.offer.term_days ?? "—"} days`
      : "2,000.00 · 550 bps · 90 days";

  async function validateMandate() {
    setBusy(true);
    setError(null);
    try {
      if (isLive) {
        const intent = await api<CreditIntent>("/v1/credit-intents", {
          method: "POST",
          body: JSON.stringify({}),
        });
        setLiveIntent(intent);
        const result = await api<{ ok: boolean; mandate_id?: string; code?: string }>(
          "/v1/mandates",
          { method: "POST", body: JSON.stringify({}) },
        );
        if (!result.ok) {
          setError(result.code ?? "Mandate rejected");
          setValidated(false);
          return;
        }
        session.setMandate(intent.mandate);
        setValidated(true);
        return;
      }

      const result = await api<{ ok: boolean; mandate_id?: string; code?: string }>(
        "/v1/mandates",
        {
          method: "POST",
          body: JSON.stringify({ mandate: demoMandate }),
        },
      );
      if (!result.ok) {
        setError(result.code ?? "Mandate rejected");
        setValidated(false);
        return;
      }
      session.setMandate(demoMandate as unknown as Mandate);
      setValidated(true);
    } catch (err) {
      setValidated(false);
      setError(err instanceof ApiError ? err.message : "Mandate validation failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="screen">
      <p className="eyebrow">Your borrowing workspace</p>
      <h2>Credit, on your terms.</h2>
      <p className="lede">
        {isLive
          ? "Review the limits your agent can act within. Your signed mandate keeps every Devnet loan within the approved amount, rate and term."
          : "Review your agent’s borrowing limits in this simulation. The example requests 2,000 at 5.5% for 90 days, within a 2,500 ceiling."}
      </p>

      <div className="doc-strip">
        <h3>Your agent’s permission</h3>
        {isLive && !hasLiveMandate ? (
          <div className="empty-state">
            <p>Load your current borrowing permission from Devnet.</p>
            <p className="note">Confirm permission to review the signed limits for your agent.</p>
            {signing ? <dl className="grid">
              <div><dt>Borrower account</dt><dd><ExplorerLink kind="account" value={signing.borrower_account} native={isLive} /></dd></div>
              <div><dt>Loan token</dt><dd><AssetDisplay asset={signing.native_loan_asset} native={isLive} /></dd></div>
              <div><dt>Reputation token</dt><dd><AssetDisplay asset={signing.native_rep_asset} native={isLive} /></dd></div>
            </dl> : null}
          </div>
        ) : <dl className="grid">
          <div>
            <dt>Principal</dt>
            <dd className="mono">{display.principal_id}</dd>
          </div>
          <div>
            <dt>Agent</dt>
            <dd className="mono">{display.agent_id}</dd>
          </div>
          <div>
            <dt>Ceiling</dt>
            <dd>
              {display.max_principal} · ≤{display.max_apr_bps} bps ·{" "}
              {display.max_term_days} days · {display.allowed_purposes?.[0]}
            </dd>
          </div>
          <div>
            <dt>Asset</dt>
            <dd><AssetDisplay asset={display.asset} native={display.mode === "LIVE_DEVNET" && display.network === "devnet"} /></dd>
          </div>
          <div>
            <dt>Requested loan</dt>
            <dd>{requested}</dd>
          </div>
          <div>
            <dt>Borrower account</dt>
            <dd><ExplorerLink kind="account" value={display.xrpl_borrower} native={display.mode === "LIVE_DEVNET" && display.network === "devnet"} /></dd>
          </div>
          <div>
            <dt>Mandate commitment</dt>
            <dd className="mono">{display.mandate_hash ?? "—"}</dd>
          </div>
        </dl>}
      </div>

      <div className="actions">
        <button type="button" disabled={busy || !network} onClick={() => void validateMandate()}>
          {busy
            ? "Validating…"
            : validated
              ? "Confirm permission again"
              : "Confirm borrowing permission"}
        </button>
        {validated && session.mandate ? (
          <Link className="btn secondary" to="/credit">
            Continue to credit
          </Link>
        ) : null}
      </div>

      {error ? <p className="error">{error}</p> : null}
      {validated ? (
        <p className="note">
          Permission confirmed · <span className="mono">{session.mandate?.mandate_id}</span>. No
          credit has been reserved yet.
        </p>
      ) : null}
    </section>
  );
}
