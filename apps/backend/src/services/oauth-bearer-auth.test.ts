import { UserRepo } from "@hazel/backend-core"
import { ConfigProvider, Effect, Layer } from "effect"
import { describe, expect, it } from "vitest"
import { type LoadClerk, makeOAuthBearerAuth, OAuthBearerAuth } from "./oauth-bearer-auth"

/** The service's first token, with Clerk's SDK loaded by `loadClerk`; its failure. */
const failureOf = (loadClerk: LoadClerk) =>
	Effect.gen(function* () {
		const auth = yield* OAuthBearerAuth
		return yield* auth.authenticate("token")
	}).pipe(
		Effect.provide(
			Layer.effect(OAuthBearerAuth, makeOAuthBearerAuth(loadClerk)).pipe(
				Layer.provide(Layer.mock(UserRepo, {})),
				Layer.provide(
					ConfigProvider.layer(ConfigProvider.fromUnknown({ CLERK_SECRET_KEY: "sk_test" })),
				),
			),
		),
		Effect.flip,
		Effect.runPromise,
	)

/** Clerk, loaded, refusing every token as its introspection does an unknown one. */
const refusingClerk = {
	idPOAuthAccessToken: { verify: () => Promise.reject(new Error("token not found")) },
}

describe("OAuthBearerAuth", () => {
	it("answers a token Clerk refuses as unauthorized", async () => {
		expect(await failureOf(async () => ({ createClerkClient: () => refusingClerk }))).toMatchObject({
			_tag: "UnauthorizedError",
		})
	})

	it("answers an SDK that fails to load as its own failure, not an invalid token", async () => {
		expect(await failureOf(() => Promise.reject(new Error("chunk failed to load")))).toMatchObject({
			_tag: "SessionLoadError",
		})
	})
})
