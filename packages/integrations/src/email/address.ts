export interface EmailAddress {
	/** Lower-cased and trimmed. */
	readonly address: string
	readonly name: string | null
}

/** The bare address of `"Name <a@b>"` or `"a@b"`, lower-cased and trimmed. */
export const bareAddress = (address: string): string => {
	const bracketed = /<([^<>]*)>/.exec(address)
	return (bracketed ? (bracketed[1] ?? "") : address).trim().toLowerCase()
}

/** The domain of an address (`"Jane <jane@Example.com>"` → `"example.com"`), or `null` without one. */
export const domainOf = (address: string): string | null => {
	const bare = bareAddress(address)
	const at = bare.lastIndexOf("@")
	if (at <= 0) return null
	const domain = bare.slice(at + 1).replace(/\.+$/, "")
	return domain === "" ? null : domain
}

/** The local part of an address (before the last `@`), lower-cased. */
export const localPartOf = (address: string): string => {
	const bare = bareAddress(address)
	const at = bare.lastIndexOf("@")
	return at < 0 ? bare : bare.slice(0, at)
}
