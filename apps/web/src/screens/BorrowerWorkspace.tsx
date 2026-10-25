import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  api,
  ApiError,
  formatAsset,
  type Mandate,
  type NetworkInfo,
} from "../lib/api";
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
      <h2>Borrower workspace</h2>
      <p className="lede">
        {isLive
          ? "LIVE Devnet mandate from the API credit-intent (native signature). Commercial terms stay the locked C0 product schedule."
          : "Confirm the principal mandate. Validation calls the API; commercial terms stay the fixed C0 example (ceiling 2,500 · request 2,000 @ 550 bps / 90 days)."}
      </p>

      <div className="doc-strip">
        <h3>Signed mandate</h3>
        <dl className="grid">
          <div>
            <dt>Principal</dt>
            <dd>{display.principal_id}</dd>
          </div>
          <div>
            <dt>Agent</dt>
            <dd>{display.agent_id}</dd>
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
            <dd>{formatAsset(display.asset)}</dd>
          </div>
          <div>
            <dt>Requested (demo)</dt>
            <dd>{requested}</dd>
          </div>
          <div>
            <dt>Mandate hash</dt>
            <dd className="mono">{display.mandate_hash ?? "—"}</dd>
          </div>
        </dl>
      </div>

      <div className="actions">
        <button type="button" disabled={busy || !network} onClick={() => void validateMandate()}>
          {busy
            ? "Validating…"
            : validated
              ? "Re-validate mandate"
              : isLive
                ? "Validate LIVE mandate"
                : "Validate mandate"}
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
          API accepted mandate <span className="mono">{session.mandate?.mandate_id}</span>. No
          reservation was created.
        </p>
      ) : null}
    </section>
  );
}
