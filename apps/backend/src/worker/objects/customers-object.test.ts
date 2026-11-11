/**
 * The `CustomersObject` shell: it migrates its store, takes its members only from its own org,
 * and streams to members only.
 */
import type { OrganizationId, UserId } from "@hazel/schema"
import { makeFakeSocket } from "@hazel/sync-do/testing"
import { Effect, type Scope } from "effect"
import { describe, expect, it } from "vitest"
import { customersTarget } from "./kinds"
import { makeTestObjects, type TestObject } from "./testing"

const uuid = () => crypto.randomUUID()

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

const members = (object: TestObject) =>
	object.storage.db.prepare(`SELECT userId, role FROM customer_members ORDER BY role`).all() as Array<{
		userId: string
		role: string
	}>

const setMembers = (
	object: TestObject,
	orgId: string,
	sender: { readonly kind: "org"; readonly id: string },
	version: number,
	list: ReadonlyArray<{ userId: string; role: "owner" | "admin" | "member" }>,
) =>
	object.applyEffect({
		objectId: orgId,
		kind: "customers.setMembers",
		payload: { organizationId: orgId, members: list, version },
		key: uuid(),
		sender,
	})

describe("CustomersObject", () => {
	it("applies its own org's members, newest version only, and streams to members", () =>
		run(
			Effect.gen(function* () {
				const objects = yield* makeTestObjects
				const orgId = uuid() as OrganizationId
				const object = yield* objects.get(customersTarget(orgId))
				const [owner, member, stranger] = [uuid(), uuid(), uuid()] as Array<UserId>

				const refused = yield* setMembers(object, orgId, { kind: "org", id: uuid() }, 1, [
					{ userId: owner, role: "owner" },
				])
				expect(refused._tag).toBe("Rejected")

				const applied = yield* setMembers(object, orgId, { kind: "org", id: orgId }, 2, [
					{ userId: owner, role: "owner" },
					{ userId: member, role: "member" },
				])
				expect(applied._tag).toBe("Applied")
				yield* setMembers(object, orgId, { kind: "org", id: orgId }, 1, [])
				expect(members(object)).toEqual([
					{ userId: member, role: "member" },
					{ userId: owner, role: "owner" },
				])

				expect(yield* object.adopt(makeFakeSocket(), { userId: member, expiresAt: null })).toBe(
					"accepted",
				)
				expect(yield* object.adopt(makeFakeSocket(), { userId: stranger, expiresAt: null })).not.toBe(
					"accepted",
				)
			}),
		))
})
