export function AuthorizationReceiptScreen() {
  return (
    <section className="screen">
      <h2>C — Authorization &amp; XRPL receipt</h2>
      <p className="muted">
        Shellfish check matrix, reservation, signer status, validated hash / Loan
        ID, repayment event; one DENY attempt.
      </p>
      <ul className="checklist">
        <li>Happy path: 2,000 @ 550 bps → ALLOW → sign → validate</li>
        <li>Denial: 3,000 → DENY_AMOUNT</li>
        <li>Denial: 9% APR → DENY_RATE</li>
        <li>Denial: replay nonce → DENY_REPLAY</li>
      </ul>
      <p className="todo">
        POST /v1/authorizations · POST /v1/loans/originate · GET /v1/receipts/:id —
        TODO
      </p>
    </section>
  );
}
