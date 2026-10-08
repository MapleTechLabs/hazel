import { createHash } from "node:crypto"

/**
 * Deterministic UUID derived from a readable key, so fixtures can reference each
 * other by name (`stableId("user:ada")`) and every run produces identical IDs.
 */
export const stableId = <A extends string = string>(key: string): A => {
	const hex = createHash("sha1").update(`hazel-parity:${key}`).digest("hex")
	const variant = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16)
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}` as A
}
