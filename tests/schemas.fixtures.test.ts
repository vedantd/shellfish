import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AuthorizationReceipt,
  BorrowingMandate,
  EvidencePassport,
  LenderEvaluateResult,
  LenderFacilityOffer,
} from "../packages/schemas/src/index.ts";

const fixtures = resolve(import.meta.dirname, "../fixtures");

function loadJson(name: string): unknown {
  return JSON.parse(readFileSync(resolve(fixtures, name), "utf8"));
}

describe("PRD fixture schemas", () => {
  it("parses evidence passport", () => {
    const parsed = EvidencePassport.parse(loadJson("evidence-passport.json"));
    expect(parsed.subject_id).toBe("business:harbor-supply-demo");
    expect(parsed.known_exposure.coverage).toBe("participating_sources_only");
  });

  it("parses borrowing mandate", () => {
    const parsed = BorrowingMandate.parse(loadJson("mandate.json"));
    expect(parsed.max_principal).toBe("2500.00");
    expect(parsed.max_apr_bps).toBe(600);
  });

  it("parses lender A offer", () => {
    const parsed = LenderFacilityOffer.parse(loadJson("offer-lender-a.json"));
    expect(parsed.principal).toBe("2000.00");
    expect(parsed.apr_bps).toBe(550);
  });

  it("parses lender B decline", () => {
    const parsed = LenderEvaluateResult.parse(loadJson("lender-b-decline.json"));
    expect(parsed.decision).toBe("DECLINE");
  });

  it("parses ALLOW receipt", () => {
    const parsed = AuthorizationReceipt.parse(
      loadJson("authorization-receipt-allow.json"),
    );
    expect(parsed.decision).toBe("ALLOW");
    expect(parsed.tx_hash).toBeNull();
  });
});
