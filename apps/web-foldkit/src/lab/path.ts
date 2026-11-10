/** `/lab` → `index`, `/lab/customers/kit/badges` → `customers/kit/badges`, anything else → undefined. */
export const labPathOf = (pathname: string): string | undefined => {
	const match = /^\/lab(?:\/(.+?))?\/?$/.exec(pathname)
	return match === null ? undefined : (match[1] ?? "index")
}
