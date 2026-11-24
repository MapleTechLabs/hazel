import { describe, expect, test } from "vitest"
import {
	missingPermissions,
	policiesAreNamed,
	policyChecks,
	policyCovers,
	probeChecks,
	probePath,
	TOKEN_PERMISSIONS,
	type TokenPolicy,
} from "./token.ts"

const accountId = "0123456789abcdef0123456789abcdef"
const zoneId = "fedcba9876543210fedcba9876543210"
const ids = { accountId, zoneId }

const groups = (scope: "account" | "zone") =>
	TOKEN_PERMISSIONS.filter((p) => p.scope === scope).map((p) => ({ id: p.group, name: p.group }))

/** What Cloudflare returns for a token made from the guide: one account policy, one zone policy. */
const fullToken: ReadonlyArray<TokenPolicy> = [
	{
		effect: "allow",
		resources: { [`com.cloudflare.api.account.${accountId}`]: "*" },
		permission_groups: groups("account"),
	},
	{
		effect: "allow",
		resources: { [`com.cloudflare.api.account.zone.${zoneId}`]: "*" },
		permission_groups: groups("zone"),
	},
]

const names = (permissions: ReadonlyArray<{ group: string }>) => permissions.map((p) => p.group)

describe("policyCovers", () => {
	test("an account policy covers its account, or every account", () => {
		expect(policyCovers({ [`com.cloudflare.api.account.${accountId}`]: "*" }, "account", ids)).toBe(true)
		expect(policyCovers({ "com.cloudflare.api.account.*": "*" }, "account", ids)).toBe(true)
		expect(policyCovers({ "com.cloudflare.api.account.someoneelse": "*" }, "account", ids)).toBe(false)
	})

	test("a zone policy covers the zone directly, all zones, or all zones of the account", () => {
		expect(policyCovers({ [`com.cloudflare.api.account.zone.${zoneId}`]: "*" }, "zone", ids)).toBe(true)
		expect(policyCovers({ "com.cloudflare.api.account.zone.*": "*" }, "zone", ids)).toBe(true)
		expect(
			policyCovers(
				{ [`com.cloudflare.api.account.${accountId}`]: { "com.cloudflare.api.account.zone.*": "*" } },
				"zone",
				ids,
			),
		).toBe(true)
		expect(policyCovers({ "com.cloudflare.api.account.zone.other": "*" }, "zone", ids)).toBe(false)
	})

	test("without the zone's id only all zones count", () => {
		const noZone = { accountId }
		expect(policyCovers({ [`com.cloudflare.api.account.zone.${zoneId}`]: "*" }, "zone", noZone)).toBe(
			false,
		)
		expect(policyCovers({ "com.cloudflare.api.account.zone.*": "*" }, "zone", noZone)).toBe(true)
	})
})

describe("missingPermissions", () => {
	test("a token made from the guide lacks nothing", () => {
		expect(missingPermissions(fullToken, ids)).toEqual([])
	})

	test("names what a Workers-template token lacks", () => {
		const workersTemplate: ReadonlyArray<TokenPolicy> = [
			{
				effect: "allow",
				resources: { [`com.cloudflare.api.account.${accountId}`]: "*" },
				permission_groups: [
					{ name: "Workers Scripts Write" },
					{ name: "Workers KV Storage Write" },
					{ name: "Workers R2 Storage Write" },
					{ name: "Account Settings Read" },
				],
			},
			{
				effect: "allow",
				resources: { "com.cloudflare.api.account.zone.*": "*" },
				permission_groups: [{ name: "Workers Routes Write" }, { name: "Zone Read" }],
			},
		]
		expect(names(missingPermissions(workersTemplate, ids))).toEqual([
			"D1 Write",
			"Secrets Store Write",
			"Account API Tokens Write",
			"DNS Write",
			"SSL and Certificates Write",
		])
	})

	test("a Write group grants its Read", () => {
		const policies: ReadonlyArray<TokenPolicy> = [
			{
				resources: { "com.cloudflare.api.account.zone.*": "*" },
				permission_groups: [{ name: "Zone Write" }],
			},
		]
		const zoneRead = TOKEN_PERMISSIONS.filter((p) => p.group === "Zone Read")
		expect(missingPermissions(policies, ids, zoneRead)).toEqual([])
	})

	test("a group granted on another account or zone does not count", () => {
		const elsewhere: ReadonlyArray<TokenPolicy> = fullToken.map((policy) => ({
			...policy,
			resources: { "com.cloudflare.api.account.other": "*" },
		}))
		expect(missingPermissions(elsewhere, ids)).toHaveLength(TOKEN_PERMISSIONS.length)
	})

	test("a deny policy takes a group back", () => {
		const denied: ReadonlyArray<TokenPolicy> = [
			...fullToken,
			{
				effect: "deny",
				resources: { [`com.cloudflare.api.account.${accountId}`]: "*" },
				permission_groups: [{ name: "D1 Write" }],
			},
		]
		expect(names(missingPermissions(denied, ids))).toEqual(["D1 Write"])
	})
})

describe("policiesAreNamed", () => {
	test("a policy with a group that has only an id cannot be matched by name", () => {
		expect(policiesAreNamed(fullToken)).toBe(true)
		expect(policiesAreNamed([{ permission_groups: [{ id: "c8fed203ed3043cba015a93ad1616f1f" }] }])).toBe(
			false,
		)
	})
})

describe("checks", () => {
	test("a missing required permission fails, a recommended one warns", () => {
		const d1 = TOKEN_PERMISSIONS.filter((p) => p.group === "D1 Write")
		const ssl = TOKEN_PERMISSIONS.filter((p) => p.group === "SSL and Certificates Write")
		expect(policyChecks([]).map((c) => c.status)).toEqual(["ok"])
		expect(policyChecks(d1).map((c) => c.status)).toEqual(["fail"])
		expect(policyChecks(ssl).map((c) => c.status)).toEqual(["ok", "warn"])
	})

	test("probes: a 403 fails, all 2xx only warns that writes are unverified", () => {
		const ok = TOKEN_PERMISSIONS.map((permission) => ({ permission, status: 200 }))
		expect(probeChecks(ok).map((c) => c.status)).toEqual(["warn"])
		const noD1 = ok.map((r) => (r.permission.group === "D1 Write" ? { ...r, status: 403 } : r))
		const checks = probeChecks(noD1)
		expect(checks[0]?.status).toBe("fail")
		expect(checks[0]?.message).toContain("D1 Write")
	})

	test("probes: a denied permission still fails when a later probe got no answer", () => {
		const results = TOKEN_PERMISSIONS.map((permission) => ({
			permission,
			status:
				permission.group === "D1 Write"
					? 403
					: permission.group === "Workers R2 Storage Write"
						? 0
						: 200,
		}))
		const checks = probeChecks(results)
		expect(checks[0]).toMatchObject({ status: "fail" })
		expect(checks[0]?.message).toContain("D1 Write")
		expect(checks.at(-1)).toMatchObject({ status: "warn" })
		expect(checks.at(-1)?.message).toContain("Workers R2 Storage Write (no answer)")
	})

	test("probe paths fill the account and zone, and skip zone probes without a zone", () => {
		const dns = TOKEN_PERMISSIONS.find((p) => p.group === "DNS Write")!
		const d1 = TOKEN_PERMISSIONS.find((p) => p.group === "D1 Write")!
		expect(probePath(dns, ids)).toBe(`/zones/${zoneId}/dns_records`)
		expect(probePath(dns, { accountId })).toBeUndefined()
		expect(probePath(d1, { accountId })).toBe(`/accounts/${accountId}/d1/database`)
	})
})
