import { describe, expect, it } from "vitest";
import {
  aprBpsToXrplInterestRate,
  xrplInterestRateToAprBps,
} from "../packages/xrpl/src/index.ts";

/**
 * Placeholder invariant suite (PRD §9.2).
 * Real DENY_AMOUNT / DENY_RATE / DENY_REPLAY / race tests land with authorization + registry.
 */
describe("unit conversion invariants", () => {
  it("converts 550 bps ↔ XRPL InterestRate 5500 (tenths of a bps)", () => {
    expect(aprBpsToXrplInterestRate(550)).toBe(5500);
    expect(xrplInterestRateToAprBps(5500)).toBe(550);
  });
});

describe("security acceptance placeholders", () => {
  it.todo("ALLOW: valid 2,000 @ 5.5% / 90 days");
  it.todo("DENY_AMOUNT: borrow 3,000 against max 2,500");
  it.todo("DENY_RATE: offer 9% against max 6%");
  it.todo("DENY_REPLAY: same nonce + proposal");
  it.todo("DENY_CAPACITY: race two 2,500 against 4,000 headroom");
  it.todo("RECONCILING: timeout after signature does not mark active");
});
