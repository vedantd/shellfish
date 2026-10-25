import { useState } from "react";
import { Link } from "react-router-dom";
import {
  api,
  ApiError,
  type EvidencePassport,
  type LenderEvaluateResult,
  type LenderOffer,
} from "../lib/api";
import { AssetDisplay } from "../components/ExplorerLink";
import { EVIDENCE_ID, FACILITY_ID, SUBJECT_ID } from "../demo/c0Materials";
import { useDemoSession } from "../state/demoSession";

export function CreditLenderDecisions() {
  const session = useDemoSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runCreditPath() {
    if (!session.mandate) {
      setError("Confirm borrowing permission in your workspace first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const isLive = session.mandate.mode === "LIVE_DEVNET";
      const subjectId = isLive ? session.mandate.principal_id : SUBJECT_ID;
      const evidenceId = isLive ? session.mandate.principal_id : EVIDENCE_ID;

      const evidence = await api<EvidencePassport>(`/v1/evidence/${encodeURIComponent(evidenceId)}`);
      session.setEvidence(evidence);

      const lenderA = await api<LenderEvaluateResult>(
        `/v1/lenders/lender-A/evaluate`,
        { method: "POST", body: JSON.stringify({ subject_id: subjectId }) },
      );
      session.setLenderA(lenderA);

      const lenderB = await api<LenderEvaluateResult>(
        `/v1/lenders/lender-B/evaluate`,
        { method: "POST", body: JSON.stringify({ subject_id: subjectId }) },
      );
      session.setLenderB(lenderB);

      const offers: LenderOffer[] = [];
      if (lenderA.decision === "APPROVE") offers.push(lenderA.offer);

      const match = await api<{
        decision?: string;
        offer?: LenderOffer;
        envelope_hash?: string;
        reason_codes?: string[];
      }>("/v1/offers/match", {
        method: "POST",
        body: JSON.stringify({
          mandate: session.mandate,
          offers,
          evidence,
        }),
      });
      const matched = match.offer ?? offers[0] ?? null;
      session.setMatch(matched, match);

      const facilityId =
        (matched?.facility_id as string | undefined) ??
        (isLive ? undefined : FACILITY_ID);
      if (!facilityId) {
        throw new Error("No facility_id on matched LIVE offer");
      }

      const status = await api(`/v1/facilities/${encodeURIComponent(facilityId)}/credit-status`);
      session.setCreditStatus(status);

      const quote = await api(`/v1/facilities/${encodeURIComponent(facilityId)}/quote`, {
        method: "POST",
        body: JSON.stringify({ principal_minor: "200000" }),
      });
      session.setQuote(quote);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Credit path failed");
    } finally {
      setBusy(false);
    }
  }

  const evidence = session.evidence;
  const exposure = evidence?.known_exposure?.amount ?? "—";
  const coverage = evidence?.known_exposure?.coverage ?? "—";
  const historyMonths = evidence?.history?.accepted_history_months;

  return (
    <section className="screen">
      <p className="eyebrow">Credit &amp; lender decisions</p>
      <h2>Find the right fit.</h2>
      <p className="lede">
        Share one evidence passport with participating lenders. Compare their decisions
        and review the offer that fits your borrowing permission.
      </p>

      <div className="actions" style={{ marginTop: 0, marginBottom: "1rem" }}>
        <button type="button" disabled={busy} onClick={() => void runCreditPath()}>
          {busy ? "Comparing lenders…" : "Check my credit options"}
        </button>
        {session.matchedOffer ? (
          <Link className="btn secondary" to="/receipt">
            Continue to authorization
          </Link>
        ) : null}
      </div>

      {error ? <p className="error">{error}</p> : null}

      {evidence ? (
        <div className="band">
          <h3>Evidence passport</h3>
          <p>
            Known exposure <strong>{exposure}</strong> · {coverage}
          </p>
          <p>
            Observation{" "}
            {evidence.history?.observation_start?.slice(0, 10) ?? "—"} →{" "}
            {evidence.history?.observation_end?.slice(0, 10) ?? "—"}
            {typeof historyMonths === "number"
              ? ` · ${historyMonths} accepted months`
              : ""}
          </p>
          {evidence.known_exposure?.asset ? (
            <p className="note">
              Asset <AssetDisplay asset={evidence.known_exposure.asset} native={evidence.mode === "LIVE_DEVNET" && session.mandate?.network === "devnet"} />
            </p>
          ) : null}
        </div>
      ) : null}

      {session.lenderA ? (
        <div
          className={`outcome ${
            session.lenderA.decision === "APPROVE"
              ? "settled-approve"
              : "settled-decline"
          }`}
        >
          <h3>
            Lender A{" "}
            <span
              className={`pill-status ${
                session.lenderA.decision === "APPROVE" ? "approve" : "decline"
              }`}
            >
              {session.lenderA.decision}
            </span>
          </h3>
          {session.lenderA.decision === "APPROVE" ? (
            <p>
              Firm offer {session.lenderA.offer.principal} @{" "}
              {session.lenderA.offer.apr_bps} bps / {session.lenderA.offer.term_days}{" "}
              days · {session.lenderA.offer.offer_id}
            </p>
          ) : (
            <p>{session.lenderA.human_explanation ?? session.lenderA.reason_codes?.join(", ")}</p>
          )}
        </div>
      ) : null}

      {session.lenderB ? (
        <div
          className={`outcome ${
            session.lenderB.decision === "APPROVE"
              ? "settled-approve"
              : "settled-decline"
          }`}
        >
          <h3>
            Lender B{" "}
            <span
              className={`pill-status ${
                session.lenderB.decision === "APPROVE" ? "approve" : "decline"
              }`}
            >
              {session.lenderB.decision}
            </span>
          </h3>
          {session.lenderB.decision === "DECLINE" ? (
            <p>
              {session.lenderB.human_explanation ??
                session.lenderB.reason_codes.join(", ")}
            </p>
          ) : (
            <p>Unexpected approve from Lender B in this demo.</p>
          )}
        </div>
      ) : null}

      {session.matchedOffer ? (
        <div className="doc-strip">
          <h3>Your matched offer</h3>
          <dl className="grid">
            <div>
              <dt>Offer</dt>
              <dd>{session.matchedOffer.offer_id}</dd>
            </div>
            <div>
              <dt>Principal</dt>
              <dd>{session.matchedOffer.principal}</dd>
            </div>
            <div>
              <dt>Rate / term</dt>
              <dd>
                {session.matchedOffer.apr_bps} bps · {session.matchedOffer.term_days}{" "}
                days
              </dd>
            </div>
            <div>
              <dt>Asset</dt>
              <dd><AssetDisplay asset={session.matchedOffer.asset} native={session.mandate?.mode === "LIVE_DEVNET" && session.mandate.network === "devnet"} /></dd>
            </div>
          </dl>
        </div>
      ) : null}

      {session.creditStatus ? (
        <div className="note">
          Facility{" "}
          <span className="mono">
            {(session.matchedOffer?.facility_id as string | undefined) ?? FACILITY_ID}
          </span>{" "}
          · Current REP balance and facility headroom loaded.
        </div>
      ) : null}
      {session.quote ? (
        <div className="note">
          Reputation bond estimate ready. <strong>Final approval reserves credit and REP together.</strong>
        </div>
      ) : null}
    </section>
  );
}
