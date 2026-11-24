/**
 * Which providers `HazelAuthInstance` configures from the env: GitHub, Google, both, or only the
 * dev sign-in; and none at all leaves sign-in off.
 */
import { enabledProviders } from "@hazel/auth/server"
import { ConfigProvider, Effect, Option } from "effect"
import { Base64Url } from "effect/encoding"
import { describe, expect, it } from "vitest"
import { HazelAuthInstance } from "./hazel-auth"

const key = Base64Url.encode(new Uint8Array(32).fill(7))
const base = { API_BASE_URL: "http://localhost:3003", FRONTEND_URL: "http://localhost:3000" }
const keys = { AUTH_BINDING_KEY: key, AUTH_TRANSACTION_KEY: key }
const github = { AUTH_GITHUB_CLIENT_ID: "Iv1.test", AUTH_GITHUB_CLIENT_SECRET: "secret" }
const google = { AUTH_GOOGLE_CLIENT_ID: "google.test", AUTH_GOOGLE_CLIENT_SECRET: "secret" }

const instanceUnder = (env: Record<string, string>) =>
	Effect.runPromise(
		HazelAuthInstance.make.pipe(
			Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ ...base, ...env }))),
		),
	)

const providersUnder = async (env: Record<string, string>) =>
	Option.map(await instanceUnder(env), ({ config }) => enabledProviders(config).providers)

describe("HazelAuthInstance providers", () => {
	it("enables GitHub only", async () => {
		expect(await providersUnder({ ...keys, ...github })).toEqual(Option.some(["github"]))
	})

	it("enables Google only, without a GitHub app", async () => {
		const instance = await instanceUnder({ ...keys, ...google })
		expect(Option.isSome(instance)).toBe(true)
		const config = Option.getOrThrow(instance).config
		expect(config.github).toBeUndefined()
		expect(config.google?.clientId).toBe("google.test")
		expect(enabledProviders(config)).toEqual({ providers: ["google"], passkeys: true })
	})

	it("enables both", async () => {
		expect(await providersUnder({ ...keys, ...github, ...google })).toEqual(
			Option.some(["github", "google"]),
		)
	})

	it("is off with neither, outside a dev stage", async () => {
		expect(Option.isNone(await instanceUnder(keys))).toBe(true)
	})

	it("runs on the dev sign-in alone on a dev stage, offering no OAuth provider", async () => {
		const instance = await instanceUnder({ DEV_SIGNIN_SECRET: "dev-secret", HAZEL_STAGE: "dev" })
		expect(Option.map(instance, ({ config }) => enabledProviders(config).providers)).toEqual(
			Option.some([]),
		)
		expect(Option.isSome(Option.getOrThrow(instance).devSignInSecret)).toBe(true)
	})

	it("ignores the dev sign-in on prd, so neither provider leaves sign-in off", async () => {
		expect(
			Option.isNone(await instanceUnder({ DEV_SIGNIN_SECRET: "dev-secret", HAZEL_STAGE: "prd" })),
		).toBe(true)
	})

	it("needs a Google client secret alongside its id", async () => {
		await expect(instanceUnder({ ...keys, AUTH_GOOGLE_CLIENT_ID: "google.test" })).rejects.toThrow()
	})
})
