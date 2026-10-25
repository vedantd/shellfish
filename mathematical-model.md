# Shellfish mathematical model

- Decision: REP-CURVE-v0.2.
- Status: APPROVED for the mathematical policy by Nick and Gita, as confirmed by Gita in the request to save this document.
- Approval evidence: Gita's Codex instruction on 24 October 2026 to record the algorithm as an approved decision from Nick and Gita. Nick's approval is attributed through Gita's confirmation. No separate Nick signature is asserted.
- Engineering integration: Vedant retains coordinator ownership of B-0001 and acceptance of the C0 implementation contract. This document does not allocate implementation IDs or start code work.
- Canonical decision record: [REP-CURVE-v0.2](docs/decisions/REP-CURVE-v0.2.md).
- Runnable simulation: [REP exposure curve](docs/simulations/rep-exposure-curve.html).
- Editable simulation source: [HTML fragment](docs/simulations/rep-exposure-curve.fragment.html).

## Purpose and application boundary

Borrowers commit scarce, nontransferable reputation against loans. A larger outstanding
credit exposure requires more REP for the next loan. Full repayment returns the original
bond. Clean repayment earns bounded appreciation. Confirmed default forfeits the bond
and suspends new borrowing across participating lenders.

The reputation cost is a commitment of future borrowing privileges. It is not cash
collateral, a transferable market price, a prediction of default, or lender reimbursement.

This mechanism belongs in the application backend. Gita implements the policy, evidence,
matching and transactional accounting. Vedant implements the authorization gate,
controlled required signer, native XRPL adapter, receipts and UI. No XRPL consensus
change, validator modification, custom EVM contract, AMM or new amendment is required.

| Responsibility | Gita application modules | Vedant application and XRPL modules | Native XRPL |
| --- | --- | --- | --- |
| Quote required REP | Schemas, compatibility and registry | Recheck accepted quote before signing | Does not evaluate the curve |
| Reserve exposure and REP | One atomic database transaction | Calls reservation before ALLOW | Does not provide the application lock |
| Consume REP | Record and bind validated proof | Construct and sign issuer-bound MPT Payment | Validates Payment and burns issuer-bound REP |
| Originate loan | Preserve both reservations | Prepare exact LoanSet, controlled signatures, submit and verify | Creates the native loan |
| Return or appreciate REP | Calculate an idempotent return credit | Controlled issuer Payment and outcome receipt | Validates new issuance |
| Forfeit and suspend | Record loss of privileges and default history | Verify native servicing outcome and enforce denial | Records broker LoanManage default where used |

Lender underwriting, monetary facilities and signed principal mandates remain independent
requirements. REP cannot turn a lender decline into an approval. Only participating
sources contribute to the known exposure total.

## Policy parameters and units

| Parameter | Approved initial rule |
| --- | --- |
| Loan asset | One exactly identified demo USD asset and issuer |
| Principal owner | One accountable enrolled principal across their agents and linked wallets |
| REP precision | Six decimal places, stored as integer micro-REP |
| Seed reputation | 1,000 REP |
| Maximum surviving reputation | 1,200 REP |
| Curve | C(E) = 0.2E + 0.00004E squared |
| Bond quotation | C(E + P) minus C(E), rounded upward once to micro-REP |
| Bond return | Entire original loan bond after full contractual repayment |
| Partial repayment | Reduces active principal and reward exposure, but releases no bond |
| Default | Forfeit the entire original bond and suspend new borrowing pending explicit review |
| Appreciation | 1% per 30 days of base principal-weighted reputation exposure |
| Appreciation budget | At most 20 REP awarded per principal in any rolling 30 days |
| Late but fully repaid | Return original bond, no appreciation |
| Default recovery | Record recovery. No automatic reversal of forfeiture or suspension |

These coefficients are deterministic demo admission rules, not calibrated credit estimates.
One REP does not redeem for five USD. The linear coefficient is a policy ratio.

Examples use USD cents. The adapter must select an exact fixed monetary scale compatible
with the chosen native loan and its repayment data. Reject unsupported precision.
Never round an observed debt balance downward to make it fit. REP atomic amounts use
1 REP = 1,000,000 micro-REP. API integers travel as decimal strings. Use BigInt or
equivalent exact arithmetic in implementation.

Freeze the curve version for a principal until all their active loans and pending
originations settle. Appreciation changes the available REP budget, not curve coefficients.

## Exposure curve and stake quotation

Let E be active principal plus principal reserved for unresolved originations.
Sum it across participating lenders for the same principal, network and loan asset.
Do not use transaction count or lifetime cumulative borrowing.

Let P be the new principal. The reference requirement is:

$$
C(E)=aE+bE^2,\qquad a=0.2,\quad b=0.00004.
$$

The incremental bond is:

$$
B(E,P)=C(E+P)-C(E)=0.2P+0.00004P^2+0.00008EP.
$$

The marginal REP cost increases with exposure:

$$
C'(E)=0.2+0.00008E.
$$

| Exposure before loan | New principal | New bond | Cumulative reference requirement |
| --- | --- | --- | --- |
| 0 | 1,000 | 240 REP | 240 REP |
| 1,000 | 1,000 | 320 REP | 560 REP |
| 2,000 | 1,000 | 400 REP | 960 REP |
| 3,000 | 1,000 | 480 REP | 1,440 REP |
| 4,000 | 1,000 | 560 REP | 2,000 REP |

With an initial 1,000 REP budget, the fourth 1,000-unit loan in this uninterrupted
sequence fails the REP check. The lender facility and mandate can impose tighter bounds.

Sequential splitting does not reduce the exact charge:

$$
B(E,P_1)+B(E+P_1,P_2)=B(E,P_1+P_2).
$$

Include pending exposure inside the same transaction as the REP reservation.
Two concurrent requests must not quote against the same unreserved exposure.

For e and p in cents, the exact integer bond is:

$$
B_{\mu REP}=2000p+\left\lceil\frac{2ep+p^2}{250}\right\rceil.
$$

For a general monetary scale M, where p = P times M, use:

$$
B_{\mu REP}=
\left\lceil
\frac{10^6(5000Mp+2ep+p^2)}{25000M^2}
\right\rceil.
$$

Round the exact increment once. Do not subtract separately rounded values of C.

## Fixed bonds per loan

Store the quoted bond B_j on each request and resulting loan. Do not reprice it after
origination. Full repayment returns that original bond. Default forfeits that bond.

Out-of-order repayments can leave excess REP locked on surviving loans. For example,
a 2,000-unit first loan locks 560 REP. A subsequent 1,000-unit loan locks 400 REP.
Repaying the first loan returns 560 REP. The remaining loan still locks 400 REP,
greater than C(1,000) = 240 REP. The excess is an accepted MVP tradeoff.

Under one fixed shared curve and atomic reservations, surviving fixed bonds remain
at least the reference requirement for surviving exposure. Do not claim equality
after repayments. Do not substitute C(E) for the actual sum of outstanding bonds.

## Reputation accounting

| Symbol | Meaning |
| --- | --- |
| R0 | Seed reputation |
| A | Confirmed available REP |
| Q | REP reserved for unresolved originations |
| K | REP bonded to active loans |
| C_return | Return credits awaiting validated issuer Payment |
| G | Cumulative appreciation awarded |
| S | Cumulative forfeited REP |

The conservation rule is:

$$
R_0+G=A+Q+K+C_{return}+S.
$$

Surviving reputation is:

$$
R=R_0+G-S.
$$

Q is reserved reputation, not floating money. It covers both unburned reserved tokens
and validated redemption waiting for a loan outcome. The monetary facility reservation
is a separate hold on lender-approved credit headroom. It does not lock vault cash.

Reserve facility principal and REP together. A points credit waiting in C_return cannot
fund another reservation. Count awarded pending appreciation against its reward budget.

| Event | Reputation transition |
| --- | --- |
| Request reserved | A to Q |
| REP redemption validated, loan unresolved | Keep Q |
| LoanSet validated successfully | Q to K |
| Never-burned origination conclusively cancelled | Q to A |
| REP burned, origination conclusively fails | Q to C_return, then issuer Payment to A |
| Fully repaid loan | K to C_return, with eligible growth credited once |
| Issuer return Payment validates | C_return to A |
| Confirmed default | K to S and principal suspension |
| Unknown signed transaction outcome | Keep reservation or pending return credit |

A transaction timeout is neither repayment nor default. Retain uncertain state.

## Slashing

For a confirmed default:

$$
Slash_j=B_j.
$$

The convex origination bond already increases the consequence of borrowing at higher
exposure. Do not apply a second leverage multiplier to this amount.

Forfeit the entire bond, award no appreciation and suspend new borrowing for the principal.
Continue processing legitimate outcomes of their other loans. Retain default and
recovery records. A write-off or deleted native Loan is not a successful repayment.

If native default accounting removes principal from active exposure, preserve the
defaulted balance in the recovery/history records. It is not debt forgiveness.
Suspension prevents the numerical fall in active exposure from restoring usable credit.

## Appreciation

Higher leverage must not earn a larger bonus merely through its larger convex bond.
Reward the base principal-time exposure instead.

For each interval k, let P_j,k be outstanding principal and delta d_k elapsed days.
Use verified ledger event times and stop accrual at contractual maturity.

$$
G_j^{raw}
=
\operatorname{floor}_6
\left[
\frac{0.01}{30}
\sum_k(0.2P_{j,k})\Delta d_k
\right].
$$

Award once after clean, on-time, full contractual repayment. A missed due date,
impairment, or default disqualifies appreciation under this initial policy.
Grace protects against premature default. It does not turn a late payment into an on-time one.

The award is the minimum of the raw amount, remaining rolling 30-day budget, and
the nonnegative gap to 1,200 surviving REP. A fully repaid late loan gets its bond
back but earns no bonus. Defaulted loans get neither restoration nor appreciation.

| Example | Convex bond at zero starting exposure | Appreciation |
| --- | --- | --- |
| 2,000 outstanding for 30 days, clean full repayment | 560 REP | 4 REP |
| 2,000 outstanding for 90 days, clean full repayment | 560 REP | 12 REP |
| Repay 500 on day 30, then 1,500 on day 90 | 560 REP | 10 REP |
| 2,000 outstanding for five minutes, clean closure | 560 REP | 0.000462 REP |
| Immediate repayment with zero elapsed exposure | 560 REP | 0 REP |

No bonus is awarded per payment transaction or per loan count. Related-party fabrication
still requires trustworthy evidence and identity policy. The formula does not authenticate history.

## Credit bump and inverse curve

For a fresh portfolio, the curve-based exposure ceiling is:

$$
C^{-1}(R)=\frac{2R}{0.2+\sqrt{0.04+0.00016R}}.
$$

At 1,000 REP, the illustrative ceiling is 3,090.16 USD, rounded down to cents.
At 1,004 REP it is 3,099.10 USD. Lender and mandate limits still apply.

For existing exposure and actually available REP A:

$$
P_{max}=C^{-1}(C(E)+A)-E.
$$

Do not use total reputation minus current exposure after repayments. Historical
excess bonds can make that calculation overstate available capacity.
Implementation should binary-search the exact integer quote function under lender,
offer and mandate bounds. Floating-point square roots are explanatory only.

## Simulation and AMMs

Open the [standalone simulation](docs/simulations/rep-exposure-curve.html) in a browser.
Its [source fragment](docs/simulations/rep-exposure-curve.fragment.html) is retained for editing.

The simulation assumes current bonded REP equals C(E), with a 1,000 REP budget and
no historical excess bonds. Its reward output assumes clean 30-day bullet repayment
before caps. It uses display arithmetic and never signs or submits transactions.
The registry must use actual A, Q, K and return credits with exact integer arithmetic.

An AMM prices exchange between pool assets. It does not implement this principal-level
credit reservation rule. REP remains nontransferable and nontradeable. The curve is
an application policy. No AMM, liquidity pool or MPT DEX amendment is part of this build.

## Native XRPL mapping and amendments

REP staking uses burn with conditional reissuance, not literal escrow.

| Mechanic | Native operation and application interpretation |
| --- | --- |
| Create REP | MPTokenIssuanceCreate by the reputation issuer |
| Enroll holder | Holder opts in with MPTokenAuthorize. Issuer authorizes that Holder |
| Seed REP | Issuer Payment to the principal-linked wallet |
| Stake | Exact holder Payment to the actual REP issuer. XRPL burns those units |
| Prove commitment | Validate network, issuance, parties, amount and request commitment. Allocate hash once |
| Originate | Controlled required LoanSet signature after facility reservation and validated stake |
| Return | New issuer Payment after verified full repayment |
| Appreciate | Bounded new issuance, combined with return or recorded separately |
| Slash | Permanently forfeit the restoration entitlement. Do not burn already-redeemed tokens twice |
| Default proof | Broker's validated LoanManage default after the applicable grace boundary |

Use REP AssetScale 6 and integer Payment amounts. Initial issuance Flags = 4
(RequireAuth). Keep CanTransfer, CanTrade, CanEscrow, CanLock and CanClawback unset.
On Devnet, ImmutableFlags = 126 freezes those six core capability states.
Omit TransferFee so it defaults to zero. Set an explicit MaximumAmount at issuance,
but do not treat that circulation cap as the principal's earned allowance or
as a cap on free plus bonded reputation.

| Amendment | Role | Devnet at recorded check | Testnet at recorded check |
| --- | --- | --- | --- |
| MPTokensV1 | REP issuance, holding and Payments | Enabled | Enabled |
| SingleAssetVault | Native loan funding vault | Enabled | Disabled |
| LendingProtocol | LoanSet, LoanPay and LoanManage | Enabled | Disabled |
| LendingProtocolV1_1 | Current closed-ended lending lifecycle | Enabled | Disabled |
| DynamicMPT | ImmutableFlags for permanent capability choices | Enabled | Disabled |
| TokenEscrow | Not required by this model | Not a dependency | Not a dependency |
| AMM or MPT DEX integration | Not used | Not a dependency | Not a dependency |

Recorded read-only check: 2026-10-25 02:34:15 UTC, or 24 October 22:34:15 New York.
Devnet ledger 6,394,108 and Testnet ledger 21,802,335 reported rippled 3.4.1.
Endpoints were https://s.devnet.rippletest.net:51234/ and
https://s.altnet.rippletest.net:51234/. Recheck feature flags at implementation start.
This is amendment/specification compatibility evidence, not a transaction round trip.

REP redemption and LoanSet are separate transactions. rippled 3.4.1 excludes lending
transactions from Batch. Persist and reconcile each leg. Do not promise atomic
stake-plus-loan settlement.

A closed-ended vault must be in Investment. The loan's final scheduled payment must
precede RedemptionDate by the required 60-second buffer. Default must satisfy the
native grace boundary. A short live demo needs its own approved short offer/schedule.
Do not accelerate the clock of a 90-day native loan.

The inspected scaffold declares xrpl ^4.0.0. Use a reviewed exact SDK pin supporting
LoanSet counterparty signing and ImmutableFlags. xrpl 5.3.0 was verified during this
research, with Node >=20.19.0. Vedant owns the manifest/lockfile change.
Dependency installation remains separately authorized. No package was installed here.

## Data contract additions

Gita publishes these shapes for Vedant to accept in C0:

- Policy ID/hash, curve version, exact asset and money scale, REP issuance and scale.
- Principal-linked wallet, lender/facility, broker and signed mandate references.
- Maximum REP stake and policy hash explicitly permitted by the principal mandate.
- Request ID, idempotency key, nonce, exposure version, exposure before reservation,
  requested principal, quoted bond, expiry and canonical commercial-terms hash.
- Unique stake transaction hash and verified redemption result.
- Separate offer hash, prepared transaction-fields commitment and final signed transaction hash.
- Loan ID, original principal/bond, outstanding principal, accrual numerator, maturity,
  clean-payment flag, default flag, origin ledger, applied event cursor, verified history
  coverage and terminal outcome reference.
- Return-credit ID, reward-credit timestamp, amount, one pending issuer attempt, final
  issuer transaction hash, result and reconciliation state.

Do not bind the redemption to a final LoanSet hash that does not exist yet.
Bind it to immutable commercial terms and request identity. After redemption validates,
autofill LoanSet using the current sequence. Freeze its non-signature fields before
the required signatures. No later autofill may alter the approved action.

## Implementation pseudocode

This is language-neutral pseudocode for agents. It specifies behavior, not a library
already present in the scaffold. Database functions below are atomic storage operations.
XRPL verification functions must inspect validated ledger data. No network call belongs
inside a database transaction.

A conclusive failure means a validated failure or proven noninclusion after expiry
with the required continuous ledger coverage. An initial submit response alone is not
that proof. Unknown or incomplete history must remain RECONCILING.

### Exact quote and capacity

~~~python
REP_SCALE = 1_000_000
DAY = 86_400
REWARD_PERIOD = 30 * DAY

def ceil_div(n, d):
    assert n >= 0 and d > 0
    return (n + d - 1) // d

def required_bond_u(exposure_minor, principal_minor, money_scale):
    assert exposure_minor >= 0 and principal_minor > 0
    e, p, M = exposure_minor, principal_minor, money_scale
    numerator = REP_SCALE * (5000 * M * p + 2 * e * p + p * p)
    return ceil_div(numerator, 25000 * M * M)

def maximum_new_principal_minor(E, available_rep_u, monetary_upper_bound, M):
    # The upper bound already applies lender, firm offer and mandate limits.
    lo, hi = 0, monetary_upper_bound
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if required_bond_u(E, mid, M) <= available_rep_u:
            lo = mid
        else:
            hi = mid - 1
    return lo
~~~

### Reserve both budgets

~~~python
def reserve_request(request, verified_inputs):
    # Outside transaction: verify evidence, lender offer, principal signature,
    # mandate permissions for loan AND REP spend, exact asset, term, fees and expiry.
    checked = verify_inputs_and_canonical_terms(request, verified_inputs)

    with db.serializable_transaction():
        old = db.request_by_idempotency_key(checked.principal, request.key)
        if old:
            assert old.terms_hash == checked.terms_hash
            return old  # Exact retry. No second reserve or nonce consumption.

        account = db.lock_reputation_account(checked.principal)
        facility = db.lock_facility(checked.facility)
        assert not account.suspended
        assert policy_version_is_fixed_for_open_obligations(account, checked.policy)
        assert nonce_unused(checked.principal, checked.mandate, checked.nonce)

        E = db.active_plus_reserved_principal(
            checked.principal, checked.network, checked.loan_asset
        )
        B = required_bond_u(E, checked.principal_minor, checked.money_scale)
        assert B <= account.available_rep_u
        assert B <= checked.mandate_max_rep_stake_u
        assert checked.principal_minor <= facility.available_headroom()
        assert one_use_mandate_allows_this_request(checked)

        account.available_rep_u -= B
        account.reserved_rep_u += B
        facility.reserved_minor += checked.principal_minor
        consume_nonce_once(checked)
        result = persist_request_and_quote(
            checked, exposure_before=E, original_bond_u=B,
            state="AWAITING_STAKE", exposure_version=db.current_version()
        )
        assert_rep_conservation(account)
        return result  # Pending request, NOT a final loan ALLOW.
~~~

### Redeem REP and originate

~~~python
def consume_stake_and_originate(request_id):
    # Durable single-executor claim with fencing. A second caller returns the
    # existing receipt. Recovery resumes immutable phase attempts, never fresh signing.
    guard = claim_single_request_executor_or_return_existing_receipt(request_id)
    if not guard.acquired:
        return guard.receipt

    try:
        return resume_origination_phases(request_id, guard)
    finally:
        release_executor_claim_if_still_owned(guard)

def resume_origination_phases(request_id, guard):
    request = load_reserved_request(request_id)
    if request.is_terminal:
        return existing_receipt(request_id)

    stake_attempt = load_phase_attempt(request_id, phase="STAKE")
    if stake_attempt is None:
        # Prepare outside the database transaction. The issuer is the destination.
        # Partial payment is forbidden. A unique (request_id, phase) record permits
        # exactly one signed attempt. A losing worker discards its prepared draft.
        stake_tx = exact_mpt_payment(
            sender=request.principal_wallet,
            destination=request.rep_issuer,
            issuance=request.rep_issuance,
            atomic_value=request.original_bond_u,
            request_commitment=request.stake_commitment,
            partial_payment=False
        )
        stake_attempt = claim_sign_and_persist_phase_once(
            request_id, "STAKE", stake_tx, guard
        )

    # Reconcile existing hash first. Submission uses the exact persisted blob.
    # Already validated phases return their saved outcome without another Payment.
    stake_outcome = submit_same_blob_or_reconcile_phase(stake_attempt)
    if stake_outcome.unknown:
        keep_reserved_and_return_reconciling(request_id)
        return
    if stake_outcome.conclusive_failure:
        release_never_burned_reservation_once(request_id)
        return

    proof = verify_exact_validated_redemption(stake_outcome, request)
    with db.serializable_transaction():
        allocate_stake_hash_once_for_same_request(proof.hash, request_id)
        mark_stake_validated_once(request_id, proof)
        # REP remains Q until origination succeeds.

    execution = load_phase_attempt(request_id, phase="LOAN")
    if execution is None:
        # Stake Payment can change borrower Sequence. Prepare LoanSet afterward.
        loan_tx = prepare_and_autofill_loanset(request.approved_terms)
        fields_hash = hash_all_non_signature_fields(loan_tx)

        with db.serializable_transaction():
            assert_executor_fence_still_valid(guard)
            assert reservation_still_live_and_bound(request_id)
            assert principal_not_suspended(request.principal)
            assert offer_mandate_evidence_and_stake_still_valid(request_id)
            assert loan_tx_matches_approved_commercial_terms(loan_tx, request)
            freeze_authorized_fields_hash_once(request_id, fields_hash)
            record_final_loan_allow_once(request_id)

        # The signer rechecks the same authorization. The phase has one immutable
        # signed blob/hash, persisted before any submission. Recovery reuses it.
        execution = claim_sign_and_persist_phase_once(
            request_id, "LOAN", loan_tx, guard, expected_fields_hash=fields_hash
        )

    outcome = submit_same_blob_or_reconcile_phase(execution)
    with db.serializable_transaction():
        if execution_event_already_applied(outcome):
            return existing_receipt(request_id)
        if outcome.unknown:
            mark_reconciling_and_keep_both_reservations(request_id)
        elif outcome.validated_success:
            move_facility_reserved_to_committed(request_id)
            move_rep_Q_to_K(request_id)
            bind_created_loan_id_and_mark_active(request_id, outcome)
        elif outcome.conclusive_failure_or_proven_noninclusion:
            release_facility_reservation(request_id)
            move_rep_Q_to_return_credit(request_id)
            queue_original_bond_refund_once(request_id)  # No reward.
        assert_all_accounting_invariants()

~~~

### Observe repayment or default

~~~python
def accrue_base_exposure(loan, verified_event_time):
    t = min(verified_event_time, loan.contractual_maturity)
    dt = max(0, t - loan.last_accrual_time)
    # Keep the numerator exact. Divide only on terminal reward calculation.
    loan.reward_area_num += REP_SCALE * loan.outstanding_minor * dt
    loan.last_accrual_time = max(loan.last_accrual_time, t)

def receive_loan_notification(event):
    proof = verify_native_event(event)
    # Event-ID uniqueness is insufficient. Backfill all relevant loan events from
    # the verified ledger range, ordered by (ledger_index, transaction_index).
    events, coverage = backfill_complete_loan_history_through(proof)
    if not coverage.complete:
        mark_loan_history_reconciling_without_return_or_reward(proof.loan_id)
        return
    for item in events.in_ledger_order():
        apply_verified_loan_event(item, coverage)

def apply_verified_loan_event(event, coverage):
    # The adapter verifies network, Loan ID, tx type/result, metadata and event time.
    proof = verify_native_event(event)
    with db.serializable_transaction():
        if event_id_already_applied(proof):
            return current_state()
        loan = db.lock_loan(proof.loan_id)
        # This is the next relevant event in a complete range, not an assumption
        # that every ledger/transaction index contains an event for this loan.
        assert coverage.proves_next_relevant_event(loan.applied_cursor, proof.cursor)
        account = db.lock_reputation_account(loan.principal)
        accrue_base_exposure(loan, proof.ledger_close_time)

        if proof.is_successful_loanpay and not loan.defaulted:
            p = verified_principal_reduction_only(proof, loan)
            record_repayment_and_reduce_active_exposure_and_facility(loan, p)
            loan.outstanding_minor -= p
            loan.clean = loan.clean and proof.payment_met_due_date

            if proof.full_contractual_obligation_repaid:
                assert coverage.complete_from_loan_origin_through(proof.cursor)
                raw = loan.reward_area_num // (
                    5 * loan.money_scale * 100 * REWARD_PERIOD
                )
                g = 0
                if loan.clean and not loan.ever_impaired:
                    g = min(
                        raw,
                        remaining_rolling_30_day_awarded_budget(account),
                        max(0, 1200 * REP_SCALE - surviving_rep_u(account))
                    )
                move_original_bond_K_to_return_credit(loan)
                award_growth_to_return_credit_once(loan, g)
                queue_combined_return_once(loan, loan.original_bond_u + g)
                mark_repaid_without_default(loan)

        elif proof.is_broker_default_transition_after_grace:
            # LoanManage impairment alone is not default.
            # Zero principal or deleted Loan alone is not repayment.
            move_original_bond_K_to_forfeited_once(loan)
            account.suspended = True
            record_defaulted_liability_and_native_writeoff(loan, proof)
            mark_default_without_return_or_growth(loan)

        elif proof.is_impairment:
            loan.ever_impaired = True

        else:
            record_nonqualifying_event_without_mint(proof)

        record_event_applied_once(proof)
        loan.applied_cursor = proof.cursor
        assert_rep_conservation(account)
~~~

### Reissue credits and reconcile unknown outcomes

~~~python
def issue_owed_rep(credit_id):
    # One active attempt per credit. Serialize issuer account sequence allocation.
    credit = claim_unpaid_credit_with_single_attempt_lock(credit_id)
    if credit.has_unresolved_signed_attempt:
        reconcile_that_attempt_only(credit)
        return

    tx = issuer_mpt_payment(
        destination=credit.principal_wallet,
        issuance=credit.rep_issuance,
        atomic_value=credit.amount_u,
        credit_commitment=credit.id
    )
    attempt = sign_and_persist_before_submission(tx, credit)
    outcome = submit_and_verify_or_mark_unknown(attempt)

    with db.serializable_transaction():
        if outcome.validated_success:
            verify_exact_issuer_payment_and_allocate_hash_once(outcome, credit)
            move_C_return_to_A_once(credit)
        elif outcome.unknown:
            retain_unspendable_credit_and_attempt(credit)
        elif outcome.conclusive_failure_or_proven_noninclusion:
            retain_credit_as_owed_and_close_failed_attempt(credit)
            # A replacement attempt needs reconciled failure and applicable authority.
        assert_rep_conservation(credit.account)

def reconcile_signed_attempt(attempt):
    result = query_transaction_on_expected_network(attempt.final_hash)
    if result.validated:
        apply_the_recorded_final_result_once(result)
    elif expiry_passed_and_complete_ledger_history_proves_noninclusion(attempt):
        apply_proven_failure_once(attempt)
    else:
        keep_reconciling_without_release_or_new_issuance(attempt)
~~~

## Acceptance checks for implementation

- Same 1,000-unit request at E = 0, 1,000 and 2,000 quotes 240, 320 and 400 REP.
- Sequential split quotes telescope, subject only to upward micro-REP rounding.
- Two concurrent requests cannot share the same available facility or REP budget.
- Return the actual historical bond after out-of-order repayment. Preserve excess bonds.
- Altered terms, issuance, amount, destination or reused stake proof produce no loan signature.
- Do not reuse the borrower Sequence consumed by stake Payment.
- Never reserve again when origination consumes an existing authorization.
- Duplicate origination calls resume one immutable stake/loan attempt per phase.
  Crash recovery cannot sign a second burn or LoanSet for an unresolved request.
- Process complete loan history in ledger/transaction order before terminal rewards.
  A delayed day-30 partial repayment must produce the 10 REP example, not 12 REP.
- Successful principal repayment does not release the fixed bond until full closure.
- 2,000 for 30 days earns 4 REP from base exposure, not 5.6 REP from the convex bond.
- Growth caps include credits awaiting issuance. Duplicate terminal events mint nothing twice.
- Default forfeits the original bond. It never restores credit through zero principal.
- Timeout or missing ledger history retains unresolved reservations or credits.
- Conservation holds through every transition, including refund and issuer-payment failure.
- Every native hash is queryable on the specified network. Simulated events stay labeled.

## Sources and evidence boundary

- [MPT properties and issuer redemption](https://xrpl.org/docs/concepts/tokens/fungible-tokens/multi-purpose-tokens)
- [MPT creation and immutable flags](https://xrpl.org/docs/references/protocol/transactions/types/mptokenissuancecreate)
- [MPT holder authorization](https://xrpl.org/docs/references/protocol/transactions/types/mptokenauthorize)
- [Lending specification](https://xls.xrpl.org/xls/XLS-0066-lending-protocol.html)
- [LoanPay](https://xrpl.org/docs/references/protocol/transactions/types/loanpay)
- [LoanManage](https://xrpl.org/docs/references/protocol/transactions/types/loanmanage)
- [rippled 3.4.1 Batch restrictions](https://github.com/XRPLF/rippled/blob/3.4.1/include/xrpl/tx/transactors/system/Batch.h)
- [Reliable transaction submission](https://xrpl.org/docs/concepts/transactions/reliable-transaction-submission)
- [Feature API](https://xrpl.org/docs/references/http-websocket-apis/public-api-methods/server-info-methods/feature)
- [SDK counterparty signer](https://js.xrpl.org/functions/signLoanSetByCounterparty.html)
- [xrpl 5.3.0 package metadata](https://registry.npmjs.org/xrpl/5.3.0)

The decision approves policy and documentation. No native loan round trip or application
acceptance is implied. Repository code, dependencies and on-chain state were not changed
by this documentation handoff.
