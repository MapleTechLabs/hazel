import { ConfigProvider, Effect } from "effect"
import { describe, expect, it } from "vitest"

import {
	domainRestrictionMessage,
	emailDomain,
	InstanceAccessConfig,
	isEmailDomainAllowed,
	isInstanceAdmin,
	parseInstanceAccess,
	parseOrgCreation,
} from "./instance-access.ts"

describe("parseInstanceAccess", () => {
	it("allows anyone when nothing is set", () => {
		expect(parseInstanceAccess({})).toEqual({
			allowedEmailDomains: [],
			instanceAdminEmails: [],
			orgCreation: "anyone",
		})
	})

	it("treats blank values and blank entries as unset", () => {
		expect(
			parseInstanceAccess({
				ALLOWED_EMAIL_DOMAINS: "  ",
				INSTANCE_ADMIN_EMAILS: " , ,",
				ORG_CREATION: " ",
			}),
		).toEqual({ allowedEmailDomains: [], instanceAdminEmails: [], orgCreation: "anyone" })
	})

	it("trims, lowercases, drops blanks, duplicates and a leading @", () => {
		const access = parseInstanceAccess({
			ALLOWED_EMAIL_DOMAINS: " Acme.COM, ,@eng.acme.com,acme.com,",
			INSTANCE_ADMIN_EMAILS: " Ada@Acme.com ,bob@acme.com,,",
		})
		expect(access.allowedEmailDomains).toEqual(["acme.com", "eng.acme.com"])
		expect(access.instanceAdminEmails).toEqual(["ada@acme.com", "bob@acme.com"])
	})
})

describe("parseOrgCreation", () => {
	it("is admins only for `admins`, in any case", () => {
		expect(parseOrgCreation("admins")).toBe("admins")
		expect(parseOrgCreation(" Admins ")).toBe("admins")
	})

	it("defaults to anyone for unset, blank and unknown values", () => {
		for (const value of [undefined, "", "  ", "anyone", "admin", "nobody", "true"]) {
			expect(parseOrgCreation(value)).toBe("anyone")
		}
	})
})

describe("isEmailDomainAllowed", () => {
	const allowed = parseInstanceAccess({ ALLOWED_EMAIL_DOMAINS: "acme.com, Partner.io" }).allowedEmailDomains

	it("allows every email when no domain is listed", () => {
		expect(isEmailDomainAllowed([], "anyone@example.com")).toBe(true)
	})

	it("matches listed domains case-insensitively", () => {
		expect(isEmailDomainAllowed(allowed, "ada@acme.com")).toBe(true)
		expect(isEmailDomainAllowed(allowed, " Ada@ACME.com ")).toBe(true)
		expect(isEmailDomainAllowed(allowed, "x@partner.IO")).toBe(true)
	})

	it("refuses other domains, lookalikes and subdomains that are not listed", () => {
		expect(isEmailDomainAllowed(allowed, "ada@example.com")).toBe(false)
		expect(isEmailDomainAllowed(allowed, "ada@eng.acme.com")).toBe(false)
		expect(isEmailDomainAllowed(allowed, "ada@notacme.com")).toBe(false)
		expect(isEmailDomainAllowed(allowed, "ada@acme.com.evil.io")).toBe(false)
	})

	it("matches a subdomain when it is listed itself", () => {
		expect(isEmailDomainAllowed(["eng.acme.com"], "ada@eng.acme.com")).toBe(true)
		expect(isEmailDomainAllowed(["eng.acme.com"], "ada@acme.com")).toBe(false)
	})

	it("refuses addresses without a domain", () => {
		expect(isEmailDomainAllowed(allowed, "acme.com")).toBe(false)
		expect(isEmailDomainAllowed(allowed, "ada@")).toBe(false)
		expect(emailDomain("@acme.com")).toBeUndefined()
	})
})

describe("isInstanceAdmin", () => {
	it("compares emails case-insensitively", () => {
		const admins = parseInstanceAccess({ INSTANCE_ADMIN_EMAILS: "Ada@Acme.com" }).instanceAdminEmails
		expect(isInstanceAdmin(admins, "ada@acme.COM")).toBe(true)
		expect(isInstanceAdmin(admins, "bob@acme.com")).toBe(false)
		expect(isInstanceAdmin([], "ada@acme.com")).toBe(false)
	})
})

describe("domainRestrictionMessage", () => {
	it("names the allowed domains", () => {
		expect(domainRestrictionMessage(["acme.com"])).toBe(
			"This Hazel instance only allows sign-in with an @acme.com address",
		)
		expect(domainRestrictionMessage(["acme.com", "a.io", "b.io"])).toBe(
			"This Hazel instance only allows sign-in with an @acme.com, @a.io or @b.io address",
		)
	})
})

describe("InstanceAccessConfig", () => {
	const read = (env: Record<string, string>) =>
		Effect.runSync(
			Effect.provide(
				Effect.gen(function* () {
					return yield* InstanceAccessConfig
				}),
				ConfigProvider.layer(ConfigProvider.fromUnknown(env)),
			),
		)

	it("reads the env, defaulting what is unset", () => {
		expect(read({})).toEqual(parseInstanceAccess({}))
		expect(read({ ALLOWED_EMAIL_DOMAINS: "acme.com", ORG_CREATION: "admins" })).toEqual({
			allowedEmailDomains: ["acme.com"],
			instanceAdminEmails: [],
			orgCreation: "admins",
		})
	})
})
