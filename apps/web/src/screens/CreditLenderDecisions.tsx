export function CreditLenderDecisions() {
  return (
    <section className="screen">
      <h2>B — Credit &amp; lender decisions</h2>
      <p className="muted">
        Gita evidence coverage, Lender A approve / Lender B decline, Nick
        compatible envelope.
      </p>
      <div className="cards">
        <article className="card">
          <h3>Gita passport</h3>
          <p>Known exposure 3,000 · participating_sources_only</p>
          <p className="todo">GET /v1/evidence/:id — TODO</p>
        </article>
        <article className="card">
          <h3>Lender A</h3>
          <p>Expected: APPROVE 2,000 @ 550 bps / 90 days</p>
          <p className="todo">POST /v1/lenders/lender-A/evaluate — TODO</p>
        </article>
        <article className="card">
          <h3>Lender B</h3>
          <p>Expected: DECLINE (requires ≥12 months history)</p>
          <p className="todo">POST /v1/lenders/lender-B/evaluate — TODO</p>
        </article>
      </div>
    </section>
  );
}
