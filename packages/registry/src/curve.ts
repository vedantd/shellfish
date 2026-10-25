/** Exact arithmetic for the approved REP-CURVE-v0.2 admission and growth policy. */
export const MODEL_VERSION = "REP-CURVE-v0.2" as const;
export const DEFAULT_MONEY_SCALE = 100n;
export const REP_POLICY = Object.freeze({
    modelVersion: MODEL_VERSION,
    repScale: 1000000n,
    seedRepU: 1000000000n,
    maxSurvivingRepU: 1200000000n,
    rollingRewardCapU: 20000000n,
    rewardPeriodSeconds: 2592000n,
    linearNumerator: 1n,
    linearDenominator: 5n,
    quadraticNumerator: 1n,
    quadraticDenominator: 25000n,
    growthRateNumerator: 1n,
    growthRateDenominator: 100n,
});
export interface PrincipalTimeInterval {
    readonly principalMinor: bigint;
    readonly elapsedSeconds: bigint;
}
export interface MaximumPrincipalInput {
    readonly exposureMinor: bigint;
    readonly availableRepU: bigint;
    readonly monetaryUpperBoundMinor: bigint;
    readonly moneyScale?: bigint;
}
export interface RepGrowthInput {
    /** Verified intervals, already clipped to the loan's contractual maturity. */
    readonly intervals: readonly PrincipalTimeInterval[];
    readonly moneyScale?: bigint;
    /** Caller verifies clean, on-time, full contractual repayment and complete history. */
    readonly eligible: boolean;
    /** Includes prior awards still waiting for their issuer return transaction. */
    readonly remainingRollingBudgetU: bigint;
    readonly survivingRepU: bigint;
}
function nonnegative(value: bigint, name: string): void {
    if (typeof value !== "bigint")
        throw new TypeError(`${name} must be a bigint`);
    if (value < 0n)
        throw new RangeError(`${name} must be nonnegative`);
}
function positive(value: bigint, name: string): void {
    nonnegative(value, name);
    if (value === 0n)
        throw new RangeError(`${name} must be positive`);
}
function ceilDivide(numerator: bigint, denominator: bigint): bigint {
    return (numerator + denominator - 1n) / denominator;
}
/**
 * Quote C(E + P) - C(E), rounding the full increment up once to micro-REP.
 * Exposure must include active principal and unresolved reserved principal.
 * moneyScale is the count of exact monetary minor units per one demo USD unit.
 */
export function quoteRepBondU(exposureMinor: bigint, principalMinor: bigint, moneyScale: bigint = DEFAULT_MONEY_SCALE): bigint {
    nonnegative(exposureMinor, "exposureMinor");
    positive(principalMinor, "principalMinor");
    positive(moneyScale, "moneyScale");
    const linear = (REP_POLICY.quadraticDenominator / REP_POLICY.linearDenominator)
        * moneyScale * principalMinor;
    const quadratic = 2n * exposureMinor * principalMinor + principalMinor * principalMinor;
    const numerator = REP_POLICY.repScale * (linear + quadratic);
    const denominator = REP_POLICY.quadraticDenominator * moneyScale * moneyScale;
    return ceilDivide(numerator, denominator);
}
/**
 * Largest affordable principal within an already-checked monetary bound.
 * Uses actual available REP, so historical excess bonds never inflate capacity.
 * This function does not grant borrowing permission or check lender/mandate policy.
 */
export function maximumPrincipalMinor(input: MaximumPrincipalInput): bigint {
    const { exposureMinor, availableRepU, monetaryUpperBoundMinor } = input;
    const moneyScale = input.moneyScale ?? DEFAULT_MONEY_SCALE;
    nonnegative(exposureMinor, "exposureMinor");
    nonnegative(availableRepU, "availableRepU");
    nonnegative(monetaryUpperBoundMinor, "monetaryUpperBoundMinor");
    positive(moneyScale, "moneyScale");
    let low = 0n;
    let high = monetaryUpperBoundMinor;
    while (low < high) {
        const middle = (low + high + 1n) / 2n;
        if (quoteRepBondU(exposureMinor, middle, moneyScale) <= availableRepU)
            low = middle;
        else
            high = middle - 1n;
    }
    return low;
}
/**
 * Unrounded accrual storage unit: monetary minor units multiplied by seconds.
 * Keep this sum intact across repayments. Round only the terminal reward.
 */
export function principalTimeMinorSeconds(intervals: readonly PrincipalTimeInterval[]): bigint {
    let total = 0n;
    for (const interval of intervals) {
        nonnegative(interval.principalMinor, "interval.principalMinor");
        nonnegative(interval.elapsedSeconds, "interval.elapsedSeconds");
        total += interval.principalMinor * interval.elapsedSeconds;
    }
    return total;
}
/**
 * Floor the base principal-time reward once, then apply both policy caps.
 * The convex origination bond never enters this calculation.
 * History verification, timing, eligibility and atomic award-once accounting belong
 * to the registry/outcome layer. This pure function does not establish those facts.
 */
export function calculateRepGrowthU(input: RepGrowthInput): bigint {
    return calculateRepGrowthFromAreaU({ ...input, principalTime: principalTimeMinorSeconds(input.intervals) });
}
/** Terminal reward from the registry's unrounded persisted principal-time area. */
export function calculateRepGrowthFromAreaU(input: Omit<RepGrowthInput, "intervals"> & {
    principalTime: bigint;
}): bigint {
    const moneyScale = input.moneyScale ?? DEFAULT_MONEY_SCALE;
    positive(moneyScale, "moneyScale");
    nonnegative(input.remainingRollingBudgetU, "remainingRollingBudgetU");
    nonnegative(input.survivingRepU, "survivingRepU");
    if (typeof input.eligible !== "boolean")
        throw new TypeError("eligible must be a boolean");
    if (input.remainingRollingBudgetU > REP_POLICY.rollingRewardCapU) {
        throw new RangeError("remainingRollingBudgetU exceeds the policy's rolling reward cap");
    }
    const principalTime = input.principalTime;
    nonnegative(principalTime, "principalTime");
    if (!input.eligible)
        return 0n;
    const numerator = principalTime * REP_POLICY.repScale * REP_POLICY.linearNumerator
        * REP_POLICY.growthRateNumerator;
    const denominator = moneyScale * REP_POLICY.linearDenominator
        * REP_POLICY.growthRateDenominator * REP_POLICY.rewardPeriodSeconds;
    const raw = numerator / denominator;
    const ceilingGap = input.survivingRepU < REP_POLICY.maxSurvivingRepU
        ? REP_POLICY.maxSurvivingRepU - input.survivingRepU : 0n;
    const budgetLimited = raw < input.remainingRollingBudgetU ? raw : input.remainingRollingBudgetU;
    return budgetLimited < ceilingGap ? budgetLimited : ceilingGap;
}
