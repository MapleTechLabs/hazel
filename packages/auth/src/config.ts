import { Context, Config, Effect, Layer } from "effect"

/**
 * Configuration for auth services (Clerk only).
 */
export interface AuthConfigShape {
	/** Clerk secret key (sk_live_* / sk_test_*). */
	readonly clerkSecretKey: string
	/** Clerk publishable key (pk_live_* / pk_test_*). */
	readonly clerkPublishableKey: string
}

export class AuthConfig extends Context.Service<AuthConfig>()("@hazel/auth/AuthConfig", {
	make: Effect.gen(function* () {
		const clerkSecretKey = yield* Config.String("CLERK_SECRET_KEY")
		const clerkPublishableKey = yield* Config.String("CLERK_PUBLISHABLE_KEY").pipe(Config.withDefault(""))

		return {
			clerkSecretKey,
			clerkPublishableKey,
		} satisfies AuthConfigShape
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)

	static Test = Layer.mock(this, {
		clerkSecretKey: "sk_test_clerk_123",
		clerkPublishableKey: "pk_test_clerk_123",
	})
}
