/**
 * Who may do what in a `CustomersObject` (`docs/customers/tech-design.md` §1): every member of the
 * org reads and works the queue; admins and owners change settings, rules, shared views and data
 * sources. Roles come from `customer_members`, the `OrgObject`'s projection (people only: bots are
 * not projected, and a bot token is refused here whatever its scopes; V1 grants bots no Customers
 * access).
 */
import { Database, SQLite, schema } from "@hazel/db"
import { CurrentUser, UnauthorizedError } from "@hazel/domain"
import { CurrentBotScopes } from "@hazel/domain/scopes"
import type { UserId } from "@hazel/schema"
import { Effect, Option } from "effect"

export interface CustomersActor {
	readonly userId: UserId
	readonly role: "owner" | "admin" | "member"
	readonly isAdmin: boolean
}

const refuse = (detail: string) =>
	new UnauthorizedError({ message: "You do not have access to this organization's customers", detail })

/** The caller, a member of the org (a person, not a bot). */
export const requireMember = Effect.gen(function* () {
	const user = yield* CurrentUser.Context
	if (Option.isSome(Option.flatten(yield* Effect.serviceOption(CurrentBotScopes)))) {
		return yield* refuse("Bots cannot access Customers")
	}
	const db = yield* Database.Database
	const member = yield* db.first(
		SQLite.from(schema.customerMembersTable)
			.select("role")
			.where(($) => [$.userId.eq(user.id)])
			.limit(1),
	)
	if (Option.isNone(member)) return yield* refuse("Not a member of the organization")
	const role = member.value.role
	return { userId: user.id, role, isAdmin: role !== "member" } satisfies CustomersActor
})

/** The caller, an admin or owner of the org. */
export const requireAdmin = Effect.gen(function* () {
	const actor = yield* requireMember
	if (!actor.isAdmin) return yield* refuse("Only admins and owners can change Customers settings")
	return actor
})
