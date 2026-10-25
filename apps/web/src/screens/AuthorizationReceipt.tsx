import { useEffect, useState } from "react";

type AuthReceipt = {
  decision: string;
  reservation_id: string | null;
  request_id: string;
  reason_codes: string[];
  quote_bond_u: string;
  mode: string;
  tx_hash: string | null;
  native_signing_permitted: boolean;
  proposal_hash: string | null;
  stake_proof_id?: string | null;
};

type OriginateResult = {
  simulated?: boolean;
  validated?: boolean;
  txHash?: string | null;
  loanId?: string | null;
  explorer?: string | null;
  message?: string;
  code?: string;
  mode?: string;
};

type NetworkInfo = {
  mode: string;
  live_ready?: boolean;
};

const apiBase =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  "http://127.0.0.1:3001";

export function AuthorizationReceiptScreen() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<AuthReceipt | null>(null);
  const [originate, setOriginate] = useState<OriginateResult | null>(null);
  const [network, setNetwork] = useState<NetworkInfo | null>(null);

  useEffect(() => {
    void fetch(`${apiBase}/v1/network`)
      .then(async (res) => {
        if (!res.ok) return;
        setNetwork((await res.json()) as NetworkInfo);
      })
      .catch(() => {
        /* API may be down; button still works once up */
      });
  }, []);

  const mode = network?.mode ?? "SIMULATED_LOAN";
  const isLive = mode === "LIVE_DEVNET";

  async function runHappyPath() {
    setBusy(true);
    setError(null);
    setOriginate(null);
    try {
      const authRes = await fetch(`${apiBase}/v1/authorizations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ unique: true, evidence_fresh: true }),
      });
      const authBody = (await authRes.json()) as AuthReceipt & {
        code?: string;
        message?: string;
      };
      if (!authRes.ok || authBody.decision !== "ALLOW") {
        setReceipt(authBody.decision ? authBody : null);
        setError(
          authBody.reason_codes?.join(", ") ||
            authBody.code ||
            authBody.message ||
            `Authorization failed (${authRes.status})`,
        );
        return;
      }
      setReceipt(authBody);

      const origRes = await fetch(`${apiBase}/v1/loans/originate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          request_id: authBody.request_id,
          reservation_id: authBody.reservation_id,
          proposal_hash: authBody.proposal_hash,
        }),
      });
      const origBody = (await origRes.json()) as OriginateResult;
      if (!origRes.ok) {
        setError(origBody.message || origBody.code || "Originate failed");
        return;
      }
      setOriginate(origBody);
    } catch (err) {
      setError(
        err instanceof Error
          ? `${err.message} — is the API running on ${apiBase}?`
          : "Request failed",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="screen">
      <h2>C — Authorization &amp; XRPL receipt</h2>
      <p className="muted">
        Mode: <strong>{mode}</strong>
        {isLive ? (
          <>
            {" "}
            — LIVE Devnet path. Real <code>tx_hash</code> only after validated
            ledger success (never invented).
          </>
        ) : (
          <>
            {" "}
            — labeled <strong>SIMULATED_LOAN</strong>; <code>tx_hash</code> stays
            null (not on-chain).
          </>
        )}
      </p>
      <ul className="checklist">
        <li>
          Happy path: authorize → {isLive ? "stake + LoanSet" : "simulate originate"}
        </li>
        <li>Denial: 3,000 → DENY_AMOUNT (see tests/authorization.test.ts)</li>
        <li>Denial: 9% APR → DENY_RATE (see tests)</li>
        <li>Denial: replay nonce → DENY_REPLAY (see tests)</li>
      </ul>

      <button type="button" disabled={busy} onClick={() => void runHappyPath()}>
        {busy
          ? "Working…"
          : isLive
            ? "Run LIVE ALLOW → stake → LoanSet"
            : "Run simulated ALLOW → originate"}
      </button>

      {error ? <p className="todo">{error}</p> : null}

      {receipt ? (
        <div style={{ marginTop: "1rem" }}>
          <h3>Authorization</h3>
          <p>
            Decision: <strong>{receipt.decision}</strong> · {receipt.mode}
          </p>
          <p>request_id: {receipt.request_id}</p>
          <p>reservation_id: {receipt.reservation_id ?? "—"}</p>
          <p>quote_bond_u: {receipt.quote_bond_u}</p>
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
        <div style={{ marginTop: "1rem" }}>
          <h3>Originate {originate.simulated ? "(simulated)" : "(live)"}</h3>
          <p>
            simulated: {String(originate.simulated)} · validated:{" "}
            {String(originate.validated)}
          </p>
          <p>loanId: {originate.loanId ?? "—"}</p>
          <p>txHash: {originate.txHash ?? "null"}</p>
          {originate.explorer ? (
            <p>
              explorer:{" "}
              <a href={originate.explorer} target="_blank" rel="noreferrer">
                {originate.explorer}
              </a>
            </p>
          ) : null}
        </div>
      ) : null}

      <p className="muted" style={{ marginTop: "1rem" }}>
        API: <code>{apiBase}</code>
      </p>
    </section>
  );
}
