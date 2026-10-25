/** Application commitments only. XRPL binary transaction signing has its own domain. */
export function canonicalJson(value: unknown): string {
    if (value === null || typeof value === "boolean" || typeof value === "string")
        return JSON.stringify(value);
    if (typeof value === "number") {
        if (!Number.isSafeInteger(value))
            throw new TypeError("Commitments require safe integers or atomic amount strings");
        return JSON.stringify(value);
    }
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(",")}]`;
    if (typeof value === "object") {
        if (Object.getPrototypeOf(value) !== Object.prototype)
            throw new TypeError("Commitments require plain JSON objects");
        return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
            .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
    }
    throw new TypeError("Unsupported commitment value");
}
export type ContentHasher = (value: unknown) => string;
export function withoutFields(value: object, keys: readonly string[]): Record<string, unknown> {
    return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
}
