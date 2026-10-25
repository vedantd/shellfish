import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  authorizeExactAction,
  verifyMandate,
} from "../packages/authorization/src/index.ts";
import { MANDATE_SIGNING_DOMAIN, createNativeMandateVerifier, signMandate, verifyMandateSignature } from "../services/api/src/mandate-signature.ts";
import {
  canonicalJson,
  withoutFields,
  type BorrowingMandate,
  type LenderFacilityOffer,
} from "../packages/schemas/src/index.ts";

const requireXrpl = createRequire(new URL("../packages/xrpl/package.json", import.meta.url));
const { Wallet } = requireXrpl("xrpl");
const root = resolve(import.meta.dirname, "..");
const load = <T>(name: string): T => JSON.parse(readFileSync(resolve(root, "fixtures", name), "utf8")) as T;
const fixture = load<BorrowingMandate>("mandate.json");
const fixtureOffer = load<LenderFacilityOffer>("offer-lender-a.json");
const now = new Date("2026-10-25T12:00:00Z");
const expiry = new Date(now.getTime() + 3600000).toISOString();
const wallet = Wallet.generate();
const other = Wallet.generate();
const hash = (value: unknown): string => `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;

function native(): BorrowingMandate {
  return {
    ...structuredClone(fixture),
    mode: "LIVE_DEVNET",
    principal_id: `devnet:${wallet.classicAddress}`,
    xrpl_borrower: wallet.classicAddress,
    asset: { mpt_issuance_id: "A".repeat(48) },
    expires_at: expiry,
    rep_consent: {
      ...fixture.rep_consent,
      rep_asset: { mpt_issuance_id: "B".repeat(48), issuer: other.classicAddress, asset_scale: 6 },
    },
    principal_signature: "unsigned",
  };
}
const verify = (mandate: BorrowingMandate, clock = now): boolean => verifyMandateSignature(mandate, {
  expectedPublicKey: wallet.publicKey,
  expectedBorrower: wallet.classicAddress,
  now: clock,
});

describe("native Ed25519 mandate authentication", () => {
  it("signs XRPL wallet keys as detached application data with the canonical C0 hash", () => {
    const signed = signMandate(native(), wallet);
    expect(signed.mandate_hash).toBe(hash(withoutFields(signed, ["principal_signature", "mandate_hash"])));
    expect(signed.principal_signature.startsWith("SFMANDATE1.")).toBe(true);
    const envelope = JSON.parse(Buffer.from(signed.principal_signature.slice("SFMANDATE1.".length), "base64url").toString("utf8"));
    expect(envelope.domain).toBe(MANDATE_SIGNING_DOMAIN);
    expect(verify(signed)).toBe(true);
    expect(native().principal_signature).toBe("unsigned");
  });

  it("requires the configured principal public key and account instead of trusting envelope identity", () => {
    const signed = signMandate(native(), wallet);
    expect(verifyMandateSignature(signed, { expectedPublicKey: other.publicKey, expectedBorrower: wallet.classicAddress, now })).toBe(false);
    expect(verifyMandateSignature(signed, { expectedPublicKey: wallet.publicKey, expectedBorrower: other.classicAddress, now })).toBe(false);
  });

  it.each([
    ["nonce", (m: BorrowingMandate) => { m.nonce = "replaced-nonce"; }],
    ["agent", (m: BorrowingMandate) => { m.agent_id = "agent:unapproved"; }],
    ["principal", (m: BorrowingMandate) => { m.principal_id = "devnet:unapproved"; }],
    ["borrower", (m: BorrowingMandate) => { m.xrpl_borrower = other.classicAddress; }],
    ["asset", (m: BorrowingMandate) => { m.asset = { mpt_issuance_id: "C".repeat(48) }; }],
    ["amount cap", (m: BorrowingMandate) => { m.max_principal = "99999.00"; }],
    ["REP consent", (m: BorrowingMandate) => { m.rep_consent.max_stake_u = "9999999999"; }],
    ["expiry", (m: BorrowingMandate) => { m.expires_at = new Date(now.getTime() + 86400000).toISOString(); }],
  ] as const)("rejects a changed %s even after an attacker recomputes the plain hash", (_name, mutate) => {
    const signed = signMandate(native(), wallet);
    mutate(signed);
    signed.mandate_hash = hash(withoutFields(signed, ["principal_signature", "mandate_hash"]));
    expect(verify(signed)).toBe(false);
  });

  it("rejects expired and wrong-network native mandates", () => {
    const signed = signMandate(native(), wallet);
    expect(verify(signed, new Date(expiry))).toBe(false);
    expect(verify(signed, new Date("invalid"))).toBe(false);
    expect(verify({ ...signed, network: "mainnet" })).toBe(false);
    expect(() => signMandate({ ...native(), network: "mainnet" }, wallet)).toThrow("MANDATE_NATIVE_DEVNET_REQUIRED");
  });

  it("rejects mismatched signing keys and unsupported key formats without exposing them", () => {
    expect(() => signMandate(native(), { publicKey: other.publicKey, privateKey: wallet.privateKey })).toThrow("MANDATE_KEYPAIR_MISMATCH");
    expect(() => signMandate(native(), { publicKey: "02" + "0".repeat(64), privateKey: "00" + "0".repeat(64) })).toThrow("MANDATE_ED25519_KEY_REQUIRED");
  });

  it("rejects domain, signature and envelope shape changes", () => {
    const signed = signMandate(native(), wallet);
    const original = JSON.parse(Buffer.from(signed.principal_signature.slice("SFMANDATE1.".length), "base64url").toString("utf8"));
    for (const change of [{ domain: "OTHER_APPLICATION" }, { algorithm: "other" }, { signature: "00".repeat(64) }, { extra: true }]) {
      const envelope = { ...original, ...change };
      expect(verify({ ...signed, principal_signature: "SFMANDATE1." + Buffer.from(JSON.stringify(envelope)).toString("base64url") })).toBe(false);
    }
    expect(verify({ ...signed, principal_signature: "SFMANDATE1.invalid" })).toBe(false);
    expect(verify({ ...signed, principal_signature: "SFMANDATE1." + "A".repeat(2000) })).toBe(false);
    expect(verify({ ...signed, principal_signature: "sig-live-principal-env" })).toBe(false);
  });

  it("keeps explicit fixture signatures in simulation only", () => {
    expect(verifyMandate(fixture)).toBe(true);
    expect(verifyMandate({ ...fixture, mode: "LIVE_DEVNET" })).toBe(false);
    expect(verifyMandate({ ...fixture, principal_signature: "arbitrary-nonempty-string" })).toBe(false);
    expect(verifyMandate({ ...fixture, principal_signature: "" })).toBe(false);
  });

  it("denies a native authorization before reserve without a trusted native verifier", () => {
    const signed = signMandate(native(), wallet);
    const reserve = vi.fn();
    const offer = { ...fixtureOffer, mode: "LIVE_DEVNET" as const, borrower_id: signed.principal_id, asset: signed.asset, expires_at: expiry };
    const input = { mandate: signed, offer, proposalHash: "unused", evidenceFresh: true, hashContent: hash,
      reservationRequest: {}, reserveRequest: reserve, now };
    expect(authorizeExactAction(input).reason_codes).toEqual(["DENY_SIGNATURE"]);
    expect(authorizeExactAction({ ...input, verifyNativeMandate: () => false }).reason_codes).toEqual(["DENY_SIGNATURE"]);
    expect(authorizeExactAction({ ...input, verifyNativeMandate: () => { throw new Error("test failure"); } }).reason_codes).toEqual(["DENY_SIGNATURE"]);
    expect(reserve).not.toHaveBeenCalled();
  });

  it("the trusted verifier factory verifies signed native mandates against its own clock", () => {
    const signed = signMandate(native(), wallet);
    const verifier = createNativeMandateVerifier({ expectedPublicKey: wallet.publicKey, expectedBorrower: wallet.classicAddress, now: () => now });
    expect(verifyMandate(signed, verifier)).toBe(true);
    const expired = createNativeMandateVerifier({ expectedPublicKey: wallet.publicKey, expectedBorrower: wallet.classicAddress, now: () => new Date(expiry) });
    expect(verifyMandate(signed, expired)).toBe(false);
  });

  it("a valid server-pinned native signature reaches reserve only with coherently bound approved inputs", () => {
    const signed = signMandate(native(), wallet);
    const offer = { ...structuredClone(fixtureOffer), mode: "LIVE_DEVNET" as const,
      borrower_id: signed.principal_id, asset: signed.asset, expires_at: expiry };
    const keys = ["lender_id", "borrower_id", "facility_id", "offer_id", "asset", "principal", "apr_bps", "rate_kind", "term_days", "fees", "purpose", "expires_at", "schedule", "network"];
    offer.commercial_terms_hash = hash(Object.fromEntries(Object.entries(offer).filter(([key]) => keys.includes(key))));
    offer.offer_hash = hash(withoutFields(offer, ["lender_signature", "offer_hash"]));
    const fixtureRequest = load<{ request: Record<string, unknown> }>("reservation.json").request;
    const request = { ...fixtureRequest, mode: "LIVE_DEVNET" as const, principal_id: signed.principal_id,
      asset: signed.asset, rep_asset: signed.rep_consent.rep_asset, expires_at: expiry,
      mandate_id: signed.mandate_id, nonce: signed.nonce, mandate_hash: signed.mandate_hash,
      commercial_terms_hash: offer.commercial_terms_hash };
    const reserve = vi.fn().mockReturnValue({ reservationId: "res:native-unit", requestId: request.request_id,
      originalBondU: "720000000", payloadHash: hash(request) });
    const nativeVerifier = createNativeMandateVerifier({ expectedPublicKey: wallet.publicKey, expectedBorrower: wallet.classicAddress, now: () => now });
    const input = { mandate: signed, offer, proposalHash: hash(request), evidenceFresh: true, hashContent: hash,
      reservationRequest: request, reserveRequest: reserve, verifyNativeMandate: nativeVerifier, now };
    const receipt = authorizeExactAction(input);
    expect(receipt.decision).toBe("ALLOW");
    expect(receipt.native_signing_permitted).toBe(false);
    expect(reserve).toHaveBeenCalledTimes(1);
    reserve.mockClear();
    const wrongRequest = { ...request, nonce: "unapproved-new-nonce" };
    const denied = authorizeExactAction({ ...input, reservationRequest: wrongRequest, proposalHash: hash(wrongRequest) });
    expect(denied.reason_codes).toContain("DENY_TRANSACTION_MISMATCH");
    expect(reserve).not.toHaveBeenCalled();
  });
});
