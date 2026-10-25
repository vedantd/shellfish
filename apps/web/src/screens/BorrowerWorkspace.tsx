export function BorrowerWorkspace() {
  return (
    <section className="screen">
      <h2>A — Borrower workspace</h2>
      <p className="muted">
        Business principal, delegated agent, signed mandate (max 2,500), purpose,
        term, cost cap, requested 2,000.
      </p>
      <dl className="grid">
        <div>
          <dt>Principal</dt>
          <dd>HarborSupply (fictional)</dd>
        </div>
        <div>
          <dt>Agent</dt>
          <dd>agent:procurement-01</dd>
        </div>
        <div>
          <dt>Mandate ceiling</dt>
          <dd>2,500 · ≤600 bps · 90 days · working_capital</dd>
        </div>
        <div>
          <dt>Requested</dt>
          <dd>2,000 RLUSD-like · 5.5% APR · 90 days</dd>
        </div>
      </dl>
      <p className="todo">UI wired to POST /v1/mandates — TODO</p>
    </section>
  );
}
