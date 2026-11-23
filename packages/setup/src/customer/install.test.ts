import { describe, expect, test } from "vitest"
import {
	checkCustomerEnv,
	type CustomerInput,
	type GeneratedSecrets,
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

	test("requires GitHub sign-in and a complete Google pair", () => {
		expect(failures({ ...good, AUTH_GITHUB_CLIENT_ID: "", AUTH_GOOGLE_CLIENT_ID: "g" })).toEqual([
			"GitHub sign-in",
			"Google sign-in",
		])
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
