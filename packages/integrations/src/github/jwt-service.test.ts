import { describe, expect, it } from "@effect/vitest"
import { ConfigProvider, Effect, Exit, Layer } from "effect"
import { GitHubAppJWTService } from "./jwt-service"

const withEnv = (env: Record<string, string>) =>
	GitHubAppJWTService.layer.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))))

describe("GitHubAppJWTService", () => {
	it.effect("builds without a GitHub App and fails its calls with GitHubAppJWTError", () =>
		Effect.gen(function* () {
			const service = yield* GitHubAppJWTService
			expect(service.isConfigured).toBe(false)
			const url = yield* Effect.flip(service.buildInstallationUrl("state"))
			expect(url._tag).toBe("GitHubAppJWTError")
			const token = yield* Effect.flip(service.getInstallationToken("1"))
			expect(token._tag).toBe("GitHubAppJWTError")
		}).pipe(Effect.provide(withEnv({}))),
	)

	it.effect("builds the installation URL from the app slug", () =>
		Effect.gen(function* () {
			const service = yield* GitHubAppJWTService
			expect(service.isConfigured).toBe(true)
			const url = yield* service.buildInstallationUrl("abc")
			expect(url.toString()).toBe(
				"https://github.com/apps/hazel-test/installations/select_target?state=abc",
			)
		}).pipe(
			Effect.provide(
				withEnv({
					GITHUB_APP_ID: "1",
					GITHUB_APP_SLUG: "hazel-test",
					GITHUB_APP_PRIVATE_KEY: btoa("pem"),
				}),
			),
		),
	)

	it.effect("dies on a partial GitHub App config", () =>
		Effect.gen(function* () {
			for (const env of [
				{ GITHUB_APP_ID: "1" },
				{ GITHUB_APP_SLUG: "hazel", GITHUB_APP_PRIVATE_KEY: "a2V5" },
			]) {
				const exit = yield* Effect.exit(
					Effect.provide(Effect.service(GitHubAppJWTService), withEnv(env)),
				)
				expect(Exit.hasDies(exit)).toBe(true)
			}
		}),
	)
})
