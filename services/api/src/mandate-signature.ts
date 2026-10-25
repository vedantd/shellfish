import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as signBytes,
  verify as verifyBytes,
} from "node:crypto";
import {
  BorrowingMandate as MandateSchema,
  canonicalJson,
  withoutFields,
  type BorrowingMandate,
} from "@shellfish/schemas";

/** Detached application data. These bytes are never an XRPL transaction or submission blob. */
export const MANDATE_SIGNING_DOMAIN = "XRPL_SHELLFISH_MANDATE_V1" as const;
const ENVELOPE_PREFIX = "SFMANDATE1.";
const ED_KEY = /^ED[A-Fa-f0-9]{64}$/;
const SIGNATURE = /^[A-Fa-f0-9]{128}$/;
const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export interface MandateSigner {
  /** XRPL Ed25519 wallet hex keys, including their ED prefix. Never log this object. */
  readonly publicKey: string;
  readonly privateKey: string;
}

export interface NativeMandateVerification {
  /** Both values come from the trusted configured borrower wallet, never the request body. */
  readonly expectedPublicKey: string;
  readonly expectedBorrower: string;
  readonly now?: Date;
}

interface SignatureEnvelope {
  domain: typeof MANDATE_SIGNING_DOMAIN;
  algorithm: "Ed25519";
  public_key: string;
  signature: string;
}

function bodyOf(mandate: BorrowingMandate): Record<string, unknown> {
  return withoutFields(mandate, ["principal_signature", "mandate_hash"]);
}

function hashBody(body: Record<string, unknown>): string {
  return `sha256:${createHash("sha256").update(canonicalJson(body), "utf8").digest("hex")}`;
}

function payload(body: Record<string, unknown>, mandateHash: string): Buffer {
  return Buffer.from(canonicalJson({
    domain: MANDATE_SIGNING_DOMAIN,
    mandate_hash: mandateHash,
    mandate: body,
  }), "utf8");
}

function publicKeyObject(key: string) {
  if (!ED_KEY.test(key)) throw new Error("MANDATE_ED25519_KEY_REQUIRED");
  return createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(key.slice(2), "hex")]), format: "der", type: "spki" });
}

/** Issue the fixed native demo's mandate using the configured principal's Ed25519 key. */
export function signMandate(raw: BorrowingMandate, signer: MandateSigner): BorrowingMandate {
  const mandate = MandateSchema.parse(raw);
  if (mandate.mode !== "LIVE_DEVNET" || mandate.network !== "devnet") throw new Error("MANDATE_NATIVE_DEVNET_REQUIRED");
  if (!ED_KEY.test(signer.privateKey) || !ED_KEY.test(signer.publicKey)) throw new Error("MANDATE_ED25519_KEY_REQUIRED");
  const key = createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from(signer.privateKey.slice(2), "hex")]), format: "der", type: "pkcs8" });
  const derived = createPublicKey(key).export({ format: "der", type: "spki" }) as Buffer;
  if (!derived.subarray(-32).equals(Buffer.from(signer.publicKey.slice(2), "hex"))) throw new Error("MANDATE_KEYPAIR_MISMATCH");
  const body = bodyOf(mandate);
  const mandateHash = hashBody(body);
  const envelope: SignatureEnvelope = {
    domain: MANDATE_SIGNING_DOMAIN,
    algorithm: "Ed25519",
    public_key: signer.publicKey.toUpperCase(),
    signature: signBytes(null, payload(body, mandateHash), key).toString("hex").toUpperCase(),
  };
  return MandateSchema.parse({
    ...mandate,
    mandate_hash: mandateHash,
    principal_signature: ENVELOPE_PREFIX + Buffer.from(canonicalJson(envelope), "utf8").toString("base64url"),
  });
}

/** Verify native permission against a server-pinned principal key and exact canonical mandate. */
export function verifyMandateSignature(raw: BorrowingMandate, options: NativeMandateVerification): boolean {
  try {
    const parsed = MandateSchema.safeParse(raw);
    if (!parsed.success) return false;
    const mandate = parsed.data;
    if (mandate.mode !== "LIVE_DEVNET" || mandate.network !== "devnet" ||
        mandate.xrpl_borrower !== options.expectedBorrower || !ED_KEY.test(options.expectedPublicKey) ||
        !mandate.mandate_id || !mandate.principal_id || !mandate.agent_id || !mandate.nonce ||
        !mandate.rep_consent.authorized) return false;
    const now = options.now ?? new Date();
    if (!Number.isFinite(now.getTime()) || Date.parse(mandate.expires_at) <= now.getTime()) return false;
    const encoded = mandate.principal_signature;
    if (!encoded.startsWith(ENVELOPE_PREFIX) || encoded.length > 1024) return false;
    const rawEnvelope: unknown = JSON.parse(Buffer.from(encoded.slice(ENVELOPE_PREFIX.length), "base64url").toString("utf8"));
    if (!rawEnvelope || typeof rawEnvelope !== "object" || Array.isArray(rawEnvelope)) return false;
    const envelope = rawEnvelope as Record<string, unknown>;
    if (Object.keys(envelope).sort().join(",") !== "algorithm,domain,public_key,signature" ||
        envelope.domain !== MANDATE_SIGNING_DOMAIN || envelope.algorithm !== "Ed25519" ||
        typeof envelope.public_key !== "string" || envelope.public_key !== options.expectedPublicKey.toUpperCase() ||
        typeof envelope.signature !== "string" || !SIGNATURE.test(envelope.signature)) return false;
    const body = bodyOf(mandate);
    if (hashBody(body) !== mandate.mandate_hash) return false;
    return verifyBytes(null, payload(body, mandate.mandate_hash), publicKeyObject(options.expectedPublicKey), Buffer.from(envelope.signature, "hex"));
  } catch {
    return false;
  }
}

export function createNativeMandateVerifier(options: Omit<NativeMandateVerification, "now"> & { now?: () => Date }): (mandate: BorrowingMandate) => boolean {
  return mandate => verifyMandateSignature(mandate, { ...options, now: options.now?.() ?? new Date() });
}
