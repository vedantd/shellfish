# Connected consumer conformance fixture

This fixture executes the current checkout's authorization and XRPL functions against the
real SQLite registry. It uses the accepted synthetic C0 example and fixed fixture clock.
It does not implement another authorization engine. It loads no wallets, connects to no
ledger and submits no transactions.

Run from a Shellfish checkout with the existing Node 24.21 runtime and locked dependencies:

```sh
node --test fixtures/consumer-acceptance/checker.test.mjs
node fixtures/consumer-acceptance/run.mjs --repo . --output /tmp/shellfish-consumer-results.json
```

An external copy needs `--repo /absolute/path/to/shellfish` or `SHELLFISH_REPO`.
No package installation is part of this tool. Missing locked TypeScript, Zod or SQLite
dependencies must be resolved through the repository's installation approval rule.

`source-runtime.mjs` uses the already installed TypeScript compiler to read the current
source in memory. Its workspace aliases point to this checkout's source. It does not
depend on an old `dist` build or write a build into the checkout. This execution does not
replace a workspace build or type check.

The CLI exits 0 only when every available consumer case passes. Exit 1 records an
acceptance failure. A failing report is evidence to fix the application, not an expected
success condition. Each case starts with a separate temporary database and removes that
database after use. Reports contain allowlisted balances, case names and observed call
order. They omit mandates, signatures, raw signed bytes and uncontrolled error messages.

The cases cover:

- Real reserve-before-ALLOW, then simulated stake before origination accounting.
- Amount, rate and stale-evidence denials with no economic change.
- Exact retry, consumed nonce and a changed valid payload under the same key.
- Reservation identity, nonce, mandate hash, approved offer, principal and REP consent.
- Origination principal, APR, term, asset and proposal commitment.
- Full repayment queuing the fixed original bond plus principal-time growth. Owed REP
  remains unavailable until a separate issuer return.

The accepted example opens with 1,000 principal exposure, a 240 REP original bond and
760 available REP. A new 2,000 loan reserves 720 REP. Clean repayment at 90 days queues
732 REP, including 12 REP growth, leaving 40 REP available until return validation.

`checker.mjs` provides reusable balance, receipt and observation-order assertions. The
trace is recorded around calls to the actual injected registry. No fake signer trace is
invented. Native signature authenticity, native submission, consumer execution fencing,
native default and the fresh migrated native return path remain `NOT AVAILABLE` in this
fixture. The separate native replay harness owns its existing ledger evidence.

The optional `hashContent` and `getApprovedOffer` injections are supplied from the trusted
fixture context. Current code can ignore them. The proposed consumer binding repair uses
them to bind all inspected objects to the persisted approval. They are never HTTP input.

Observed before the owner repair, on application source `3c5f9bc`: **8 pass, 12 fail**.
An isolated repair candidate passed the same **20 cases**, with zero failures. The latter
does not claim the patch is applied, merged, accepted by Vedant or native-validated.

The six shared security TODOs are not silently closed by this fixture. In particular,
consumer-side signing/submission, multi-process race instrumentation and recovery after
a signed timeout still need the actual integration workers. Existing producer tests
continue to provide their separate registry evidence.
