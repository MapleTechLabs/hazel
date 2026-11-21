import * as Customers from "@hazel/domain/customers"
import { Channel, Message, Organization, User } from "@hazel/domain/models"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import { cacheVersionOf } from "./collections"

describe("cacheVersionOf", () => {
	it("is a stable non-negative integer for a synced model", () => {
		for (const schema of [
			Customers.Account.Schema,
			Channel.Schema,
			Message.Schema,
			Organization.Schema,
		]) {
			const version = cacheVersionOf(schema)
			expect(Number.isInteger(version) && version >= 0).toBe(true)
			expect(cacheVersionOf(schema)).toBe(version)
		}
	})

	it("differs between models", () => {
		expect(cacheVersionOf(User.Schema)).not.toBe(cacheVersionOf(Channel.Schema))
	})

	// The customers list hung on rows cached before `companyCheckedAt` existed (#608).
	it("changes when a model gains a field", () => {
		const before = Schema.Struct({ id: Schema.String, name: Schema.String })
		const after = Schema.Struct({
			id: Schema.String,
			name: Schema.String,
			companyCheckedAt: Schema.NullOr(Schema.String),
		})
		expect(cacheVersionOf(after)).not.toBe(cacheVersionOf(before))
	})
})
