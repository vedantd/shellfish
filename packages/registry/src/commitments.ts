import { createHash } from "node:crypto";
import { canonicalJson } from "@shellfish/schemas";
export function contentHash(value: unknown): string {
    return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}
