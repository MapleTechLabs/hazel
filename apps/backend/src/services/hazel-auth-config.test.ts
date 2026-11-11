import { ConfigProvider, Effect, Exit } from "effect"
import { expect, it } from "vitest"
import { HazelAuthInstance } from "./hazel-auth"

it("reports a malformed signing key without retaining its input", async () => {
	const config = ConfigProvider.layer(
		ConfigProvider.fromUnknown({
			API_BASE_URL: "https://api.hazel.test",
			FRONTEND_URL: "https://app.hazel.test",
			AUTH_GITHUB_CLIENT_ID: "test-client",
			AUTH_GITHUB_CLIENT_SECRET: "test-secret",
			AUTH_BINDING_KEY: "test-binding",
			AUTH_TRANSACTION_KEY: "test-transaction",
			AUTH_ACCESS_TOKEN_PRIVATE_JWK: "private-input-that-must-not-appear",
		}),
	)
	const exit = await Effect.runPromiseExit(
		Effect.service(HazelAuthInstance).pipe(
			Effect.provide(HazelAuthInstance.layer),
			Effect.provide(config),
		),
	)
	expect(Exit.isFailure(exit)).toBe(true)
	if (Exit.isFailure(exit)) {
		expect(
			exit.cause.reasons.map((reason) => ("error" in reason ? reason.error._tag : reason._tag)),
		).toEqual(["AccessTokenConfigurationError"])
	}
	expect(JSON.stringify(exit)).not.toContain("private-input-that-must-not-appear")
})
