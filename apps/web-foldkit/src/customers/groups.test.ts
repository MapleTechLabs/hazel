import { CustomerAccountId } from "@hazel/schema"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import { environmentCounts, groupOf, groupRows, linkedTo, madePrimary, nestedIdsOf, unlinked } from "./groups"

const id = (n: number) =>
	Schema.decodeSync(CustomerAccountId)(`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`)
const row = (n: number, name: string, primary: number | null = null) => ({
	id: id(n),
	name,
	primaryAccountId: primary === null ? null : id(primary),
})

// Acme US (primary) with EU and APAC; Beta alone; Gamma's EU with a deleted primary (99).
const acmeUs = row(1, "Acme US")
const acmeEu = row(2, "Acme EU", 1)
const acmeApac = row(3, "Acme APAC", 1)
const beta = row(4, "Beta")
const gammaEu = row(5, "Gamma EU", 99)
const all = [acmeUs, acmeEu, acmeApac, beta, gammaEu]
const liveIds = new Set(all.map((account) => account.id))
const names = (rows: ReadonlyArray<{ name: string }>) => rows.map((account) => account.name)

describe("customer groups", () => {
	it("keeps a group together where its first row sorts, primary first", () => {
		// Sorted by something that scatters the group: EU first, Beta between.
		expect(names(groupRows([acmeEu, beta, acmeApac, acmeUs, gammaEu], liveIds))).toEqual([
			"Acme US",
			"Acme EU",
			"Acme APAC",
			"Beta",
			"Gamma EU",
		])
	})

	it("keeps the environments in their sorted order", () => {
		expect(names(groupRows([beta, acmeApac, acmeEu, acmeUs], liveIds))).toEqual([
			"Beta",
			"Acme US",
			"Acme APAC",
			"Acme EU",
		])
	})

	it("leaves rows without groups as they are", () => {
		expect(groupRows([beta, acmeUs], liveIds)).toEqual([beta, acmeUs])
	})

	it("keeps a filtered-out primary's environments together, not nested", () => {
		const rows = groupRows([acmeApac, beta, acmeEu], liveIds)
		expect(names(rows)).toEqual(["Acme APAC", "Acme EU", "Beta"])
		expect(nestedIdsOf(rows).size).toBe(0)
		expect(nestedIdsOf(groupRows([acmeEu, acmeUs], liveIds))).toEqual(new Set([acmeEu.id]))
	})

	it("treats an environment whose primary is gone as standalone", () => {
		expect(groupOf(all, gammaEu.id)).toEqual([])
		expect(environmentCounts(all).has(id(99))).toBe(false)
	})

	it("lists an account's group, primary first, from any member", () => {
		expect(names(groupOf(all, acmeApac.id))).toEqual(["Acme US", "Acme EU", "Acme APAC"])
		expect(groupOf(all, beta.id)).toEqual([])
		expect(environmentCounts(all)).toEqual(new Map([[acmeUs.id, 2]]))
	})

	it("applies link, unlink and make primary like the store", () => {
		// Linking a primary moves its environments along.
		const linked = linkedTo(all, acmeUs.id, beta.id)
		expect(names(groupOf(linked, beta.id))).toEqual(["Beta", "Acme US", "Acme EU", "Acme APAC"])
		expect(groupOf(unlinked(all, acmeEu.id), acmeEu.id)).toEqual([])
		const promoted = madePrimary(all, acmeEu.id)
		expect(names(groupOf(promoted, acmeUs.id))).toEqual(["Acme EU", "Acme US", "Acme APAC"])
		expect(madePrimary(all, acmeUs.id)).toBe(all)
	})
})
