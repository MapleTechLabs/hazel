import { Option } from "effect"
import { describe, expect, test } from "vitest"
import {
	brokerRegistryEntry,
	checkCustomerEnv,
	type CustomerInput,
	type GeneratedSecrets,
	generateBrokerPrivateKey,
	hasSignInProvider,
	oauthCallbackUrls,
	parseEnv,
	renderCustomerEnv,
} from "./install.ts"

const input: CustomerInput = {
	name: "acme",
	zone: "Chat.Acme.com.",
	cloudflareAccountId: "0123456789abcdef0123456789abcdef",
	cloudflareApiToken: "cf-token",
	github: { clientId: "gh-id", clientSecret: "gh-secret" },
	allowedEmailDomains: "acme.com",
	instanceAdminEmails: "ops@acme.com",
	orgCreation: "admins",
}

const secrets: GeneratedSecrets = {
	INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
	AUTH_BINDING_KEY: Buffer.alloc(32, 2).toString("base64url"),
	AUTH_TRANSACTION_KEY: Buffer.alloc(32, 3).toString("base64url"),
	AUTH_ACCESS_TOKEN_KID: "2026-11-23",
	AUTH_ACCESS_TOKEN_PRIVATE_JWK: JSON.stringify({ kty: "EC", crv: "P-256", x: "x", y: "y", d: "d" }),
}

const failures = (env: Record<string, string | undefined>) =>
	checkCustomerEnv("acme", env)
		.filter((check) => check.status === "fail")
		.map((check) => check.name)

describe("customer env file", () => {
	test("round-trips through the parser, normalizing the zone and quoting the JWK", () => {
		const content = renderCustomerEnv(input, secrets, {}, "2026-11-23")
		expect(content).toContain(`AUTH_ACCESS_TOKEN_PRIVATE_JWK='{"kty":"EC"`)
		const env = parseEnv(content)
		expect(env.HAZEL_ZONE).toBe("chat.acme.com")
		expect(env.COOKIE_DOMAIN).toBe(".chat.acme.com")
		expect(env.AUTH_ACCESS_TOKEN_PRIVATE_JWK).toBe(secrets.AUTH_ACCESS_TOKEN_PRIVATE_JWK)
		expect(env.AUTH_GOOGLE_CLIENT_ID).toBeUndefined()
		expect(failures(env)).toEqual([])
	})

	test("a Google-only install writes Google and leaves GitHub commented out", () => {
		const content = renderCustomerEnv(
			{ ...input, github: undefined, google: { clientId: "g-id", clientSecret: "g-secret" } },
			secrets,
		)
		expect(content).toContain("# AUTH_GITHUB_CLIENT_ID=")
		const env = parseEnv(content)
		expect(env.AUTH_GITHUB_CLIENT_ID).toBeUndefined()
		expect(env.AUTH_GOOGLE_CLIENT_ID).toBe("g-id")
		expect(failures(env)).toEqual([])
	})

	test("writes the operator token, and keeps the one already there", () => {
		const env = parseEnv(renderCustomerEnv({ ...input, operatorToken: "op-token" }, secrets))
		expect(env.OPERATOR_TOKEN).toBe("op-token")
		// A hand-added copy never shadows the managed key.
		const again = parseEnv(
			renderCustomerEnv({ ...input, operatorToken: "op-token" }, secrets, { OPERATOR_TOKEN: "old" }),
		)
		expect(again.OPERATOR_TOKEN).toBe("op-token")
		expect(parseEnv(renderCustomerEnv(input, secrets)).OPERATOR_TOKEN).toBeUndefined()
	})

	test("keeps keys added by hand", () => {
		const env = parseEnv(
			renderCustomerEnv(input, secrets, { SLACK_CLIENT_ID: "123", HAZEL_ZONE: "old.example" }),
		)
		expect(env.SLACK_CLIENT_ID).toBe("123")
		expect(env.HAZEL_ZONE).toBe("chat.acme.com")
	})

	test("callback URLs are on the api host", () => {
		expect(oauthCallbackUrls("chat.acme.com")).toEqual({
			github: "https://api.chat.acme.com/auth/github/callback",
			google: "https://api.chat.acme.com/auth/google/callback",
		})
	})
})

describe("checkCustomerEnv", () => {
	const good = parseEnv(renderCustomerEnv(input, secrets))

	test("flags missing and malformed secrets", () => {
		expect(
			failures({
				...good,
				INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(16).toString("base64"),
				AUTH_BINDING_KEY: "",
				AUTH_ACCESS_TOKEN_PRIVATE_JWK: "{not json",
			}),
		).toEqual(["INTEGRATION_ENCRYPTION_KEY", "AUTH_BINDING_KEY", "AUTH_ACCESS_TOKEN_PRIVATE_JWK"])
	})

	test("needs at least one sign-in provider, each with its id and secret", () => {
		const noGitHub = { ...good, AUTH_GITHUB_CLIENT_ID: "", AUTH_GITHUB_CLIENT_SECRET: "" }
		expect(failures(noGitHub)).toEqual(["Sign-in"])
		expect(
			failures({ ...noGitHub, AUTH_GOOGLE_CLIENT_ID: "g", AUTH_GOOGLE_CLIENT_SECRET: "gs" }),
		).toEqual([])
		expect(failures({ ...good, AUTH_GITHUB_CLIENT_ID: "", AUTH_GOOGLE_CLIENT_ID: "g" })).toEqual([
			"GitHub sign-in",
			"Google sign-in",
			"Sign-in",
		])
		expect(failures({ ...good, AUTH_GOOGLE_CLIENT_ID: "g" })).toEqual(["Google sign-in"])
	})

	test("hasSignInProvider wants a complete GitHub or Google app", () => {
		const app = { clientId: "id", clientSecret: "secret" }
		expect(hasSignInProvider({ github: app })).toBe(true)
		expect(hasSignInProvider({ google: app })).toBe(true)
		expect(hasSignInProvider({ github: app, google: app })).toBe(true)
		expect(hasSignInProvider({})).toBe(false)
		expect(hasSignInProvider({ github: { clientId: "id", clientSecret: "" } })).toBe(false)
	})

	test("org creation by admins needs admins", () => {
		expect(failures({ ...good, INSTANCE_ADMIN_EMAILS: "" })).toEqual(["ORG_CREATION"])
		expect(failures({ ...good, ORG_CREATION: "everyone" })).toEqual(["ORG_CREATION"])
	})

	test("rejects a bad zone, account id or email list", () => {
		expect(
			failures({
				...good,
				HAZEL_ZONE: "not a zone",
				CLOUDFLARE_ACCOUNT_ID: "abc",
				ALLOWED_EMAIL_DOMAINS: "acme.com, @bad",
				INSTANCE_ADMIN_EMAILS: "ops@acme.com, nope",
			}),
		).toEqual(["HAZEL_ZONE", "CLOUDFLARE_ACCOUNT_ID", "ALLOWED_EMAIL_DOMAINS", "INSTANCE_ADMIN_EMAILS"])
	})
})

describe("OAuth broker keys", () => {
	test("are written with the install, and the registry entry carries only public keys", async () => {
		const privateKey = await generateBrokerPrivateKey()
		const env = parseEnv(
			renderCustomerEnv({ ...input, broker: { instanceId: "acme", privateKey } }, secrets),
		)
		expect(env.OAUTH_BROKER_INSTANCE_ID).toBe("acme")
		expect(env.OAUTH_BROKER_PRIVATE_KEY).toBe(privateKey)
		expect(env.OAUTH_BROKER_URL).toBeUndefined()

		const entry = JSON.parse(
			Option.getOrThrow(brokerRegistryEntry(input.zone, { instanceId: "acme", privateKey })),
		)
		expect(entry.id).toBe("acme")
		expect(entry.apiUrl).toBe("https://api.chat.acme.com")
		expect(entry.publicKey.enc.d).toBeUndefined()
		expect(entry.publicKey.sig.d).toBeUndefined()
		expect(entry.publicKey.enc.x).toBe(JSON.parse(privateKey).enc.x)
	})

	test("the broker client is off until its URL is set, then needs every key", async () => {
		const privateKey = await generateBrokerPrivateKey()
		const env = parseEnv(
			renderCustomerEnv({ ...input, broker: { instanceId: "acme", privateKey } }, secrets),
		)
		expect(failures(env)).toEqual([])
		expect(failures({ ...env, OAUTH_BROKER_URL: "https://api.hazel.sh" })).toEqual(["OAuth broker"])
		const publicKey = JSON.stringify({ kty: "EC", crv: "P-256", x: "x", y: "y" })
		expect(
			failures({
				...env,
				OAUTH_BROKER_URL: "https://api.hazel.sh",
				OAUTH_BROKER_PUBLIC_KEY: publicKey,
			}),
		).toEqual([])
	})
})
