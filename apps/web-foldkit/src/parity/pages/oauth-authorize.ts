import type { ComparePage } from "../compare-entry"

/** `/oauth/authorize`: an agent asking to read and write messages. */
export default {
	flag: "hazel:native:OAuthAuthorize",
	href: "/oauth/authorize?client_id=6f1c2a4e-0000-4000-8000-000000000001&redirect_uri=https%3A%2F%2Fraycast.com%2Fcallback&response_type=code&code_challenge=challenge&code_challenge_method=S256&scope=messages%3Aread%20messages%3Awrite&state=s",
	island: '[data-hz="screen"][data-surface="centered"]',
	wide: true,
	region: "viewport",
	steps: [],
} satisfies ComparePage
