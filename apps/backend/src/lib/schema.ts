import { Schema } from "effect"

export const RelativeUrl = Schema.String.check(
	Schema.isNonEmpty(),
	Schema.isStartingWith("/"),
	Schema.makeFilter((url: string) => !url.startsWith("//") || "Protocol-relative URLs are not allowed"),
)

export const AuthState = Schema.Struct({
	returnTo: RelativeUrl,
})

// Auth state for desktop OAuth flow with connection info
export const DesktopAuthState = Schema.Struct({
	returnTo: RelativeUrl,
	desktopPort: Schema.Number,
	desktopNonce: Schema.String,
})
